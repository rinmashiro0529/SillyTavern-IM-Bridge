function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TelegramChatQueueOptions {
  interMessageDelayMs?: number;
  degradeRecentOpsThreshold?: number;
  degradeRecentOpsWindowMs?: number;
  degradeRecent429WindowMs?: number;
  postRoundQuietMs?: number;
  cooldownJitterMinMs?: number;
  cooldownJitterMaxMs?: number;
  cooldownPenaltyMultiplier?: number;
  cooldownPenaltyExtraMs?: number;
}

interface ChatState {
  tail: Promise<void>;
  releaseTail: (() => void) | null;
  cooldownUntil: number;
  recentOpTimestamps: number[];
  recent429Timestamps: number[];
  lastRoundCompletedAt: number;
}

export interface TelegramChatQueueSnapshot {
  cooldownUntil: number;
  recentOpsCount: number;
  recent429Count: number;
  lastRoundCompletedAt: number;
  isDegraded: boolean;
}

export class TelegramChatQueue {
  private readonly states = new Map<string, ChatState>();
  private readonly interMessageDelayMs: number;
  private readonly degradeRecentOpsThreshold: number;
  private readonly degradeRecentOpsWindowMs: number;
  private readonly degradeRecent429WindowMs: number;
  private readonly postRoundQuietMs: number;
  private readonly cooldownJitterMinMs: number;
  private readonly cooldownJitterMaxMs: number;
  private readonly cooldownPenaltyMultiplier: number;
  private readonly cooldownPenaltyExtraMs: number;

  public constructor(options: TelegramChatQueueOptions = {}) {
    this.interMessageDelayMs = options.interMessageDelayMs ?? 1400;
    this.degradeRecentOpsThreshold = options.degradeRecentOpsThreshold ?? 8;
    this.degradeRecentOpsWindowMs = options.degradeRecentOpsWindowMs ?? 60_000;
    this.degradeRecent429WindowMs = options.degradeRecent429WindowMs ?? 180_000;
    this.postRoundQuietMs = options.postRoundQuietMs ?? 15_000;
    this.cooldownJitterMinMs = options.cooldownJitterMinMs ?? 300;
    this.cooldownJitterMaxMs = options.cooldownJitterMaxMs ?? 1200;
    this.cooldownPenaltyMultiplier = options.cooldownPenaltyMultiplier ?? 1.5;
    this.cooldownPenaltyExtraMs = options.cooldownPenaltyExtraMs ?? 5000;
  }

  public async runExclusive<T>(chatId: string | number, task: () => Promise<T>): Promise<T> {
    const key = String(chatId);
    const state = this.getOrCreateState(key);
    const previous = state.tail;

    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    state.tail = previous.catch(() => undefined).then(() => current);
    state.releaseTail = releaseCurrent;

    await previous.catch(() => undefined);
    await this.waitForCooldown(state);

    try {
      this.recordOperation(state);
      return await task();
    } finally {
      await sleep(this.interMessageDelayMs);
      releaseCurrent();
      this.cleanupIfIdle(key, state, current);
    }
  }

  public setCooldown(chatId: string | number, retryAfterSeconds: number): void {
    const state = this.getOrCreateState(String(chatId));
    const now = Date.now();
    this.pruneState(state, now);

    const jitterSpan = Math.max(0, this.cooldownJitterMaxMs - this.cooldownJitterMinMs);
    const jitterMs = this.cooldownJitterMinMs + Math.floor(Math.random() * (jitterSpan + 1));
    const retryAfterMs = Math.max(0, retryAfterSeconds) * 1000;
    const multiplier = state.recent429Timestamps.length > 0
      ? this.cooldownPenaltyMultiplier + 0.25
      : this.cooldownPenaltyMultiplier;
    const until = now + Math.round(retryAfterMs * multiplier) + this.cooldownPenaltyExtraMs + jitterMs;

    state.cooldownUntil = Math.max(state.cooldownUntil, until);
    state.recent429Timestamps.push(now);
    this.pruneState(state, now);
  }

  public isDegraded(chatId: string | number): boolean {
    const state = this.getOrCreateState(String(chatId));
    return this.isDegradedState(state, Date.now());
  }

  public markRoundCompleted(chatId: string | number): void {
    const state = this.getOrCreateState(String(chatId));
    state.lastRoundCompletedAt = Date.now();
  }

  public getSnapshot(chatId: string | number): TelegramChatQueueSnapshot {
    const state = this.getOrCreateState(String(chatId));
    const now = Date.now();
    this.pruneState(state, now);
    return {
      cooldownUntil: state.cooldownUntil,
      recentOpsCount: state.recentOpTimestamps.length,
      recent429Count: state.recent429Timestamps.length,
      lastRoundCompletedAt: state.lastRoundCompletedAt,
      isDegraded: this.isDegradedState(state, now),
    };
  }

  private getOrCreateState(key: string): ChatState {
    const existing = this.states.get(key);
    if (existing) {
      return existing;
    }

    const initialTail = Promise.resolve();
    const state: ChatState = {
      tail: initialTail,
      releaseTail: null,
      cooldownUntil: 0,
      recentOpTimestamps: [],
      recent429Timestamps: [],
      lastRoundCompletedAt: 0,
    };
    this.states.set(key, state);
    return state;
  }

  private async waitForCooldown(state: ChatState): Promise<void> {
    const now = Date.now();
    if (state.cooldownUntil > now) {
      await sleep(state.cooldownUntil - now);
    }
  }

  private recordOperation(state: ChatState): void {
    const now = Date.now();
    state.recentOpTimestamps.push(now);
    this.pruneState(state, now);
  }

  private pruneState(state: ChatState, now: number): void {
    state.recentOpTimestamps = state.recentOpTimestamps.filter((ts) => ts >= now - this.degradeRecentOpsWindowMs);
    state.recent429Timestamps = state.recent429Timestamps.filter((ts) => ts >= now - this.degradeRecent429WindowMs);
  }

  private isDegradedState(state: ChatState, now: number): boolean {
    this.pruneState(state, now);

    if (state.cooldownUntil > now) {
      return true;
    }

    if (state.recent429Timestamps.length > 0) {
      return true;
    }

    if (state.recentOpTimestamps.length >= this.degradeRecentOpsThreshold) {
      return true;
    }

    if (state.lastRoundCompletedAt && now - state.lastRoundCompletedAt <= this.postRoundQuietMs) {
      return true;
    }

    return false;
  }

  private cleanupIfIdle(key: string, state: ChatState, current: Promise<void>): void {
    if (state.tail === current) {
      this.states.delete(key);
    }
  }
}
