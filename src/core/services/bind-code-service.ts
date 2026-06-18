import { randomInt } from "node:crypto";
import type { BindCodeRepository } from "../ports/repositories";
import type { AccountConfigService } from "./account-config-service";

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_SOFT_FAIL_PER_WINDOW = 5;
const RATE_HARD_LOCK_FAILS = 10;
const RATE_HARD_LOCK_MS = 60 * 60 * 1000;

export type RedeemOutcome = "ok" | "invalid" | "expired" | "rate_limited";

export interface BindCodeServiceOptions {
  ttlMs?: number;
  now?: () => number;
}

interface RateEntry {
  failures: number;
  windowStart: number;
  lockedUntil: number;
}

export class BindCodeService {
  private readonly repo: BindCodeRepository;
  private readonly configService: AccountConfigService;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly rateLimits = new Map<string, RateEntry>();

  public constructor(
    repo: BindCodeRepository,
    configService: AccountConfigService,
    options: BindCodeServiceOptions = {},
  ) {
    this.repo = repo;
    this.configService = configService;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  public generate(accountId: string): { code: string; expiresAt: string; ttlMs: number } {
    this.configService.ensure(accountId);
    const code = generateCode();
    const expiresAtMs = this.now() + this.ttlMs;
    const expiresAt = new Date(expiresAtMs).toISOString();
    this.repo.upsert(accountId, code, expiresAt);
    return { code, expiresAt, ttlMs: this.ttlMs };
  }

  public getActive(accountId: string): { code: string; expiresAt: string; remainingMs: number } | null {
    const record = this.repo.getByAccount(accountId);
    if (!record) return null;
    const remainingMs = new Date(record.expiresAt).getTime() - this.now();
    if (remainingMs <= 0) {
      this.repo.deleteByAccount(accountId);
      return null;
    }
    return { code: record.code, expiresAt: record.expiresAt, remainingMs };
  }

  public revoke(accountId: string): void {
    this.repo.deleteByAccount(accountId);
  }

  public redeem(accountId: string, rawCode: string, telegramUserId: string): RedeemOutcome {
    const code = rawCode.trim().toUpperCase();
    const rateKey = `${accountId}:${telegramUserId}`;
    if (this.isRateLocked(rateKey)) {
      return "rate_limited";
    }
    if (!code) {
      this.recordFailure(rateKey);
      return "invalid";
    }

    const record = this.repo.getByAccount(accountId);
    if (!record || record.code !== code) {
      this.recordFailure(rateKey);
      return "invalid";
    }

    const nowMs = this.now();
    if (new Date(record.expiresAt).getTime() <= nowMs) {
      this.repo.deleteByAccount(accountId);
      this.recordFailure(rateKey);
      return "expired";
    }

    const consumed = this.repo.consume(accountId, code, new Date(nowMs).toISOString());
    if (!consumed) {
      this.recordFailure(rateKey);
      return "invalid";
    }

    this.configService.addAllowedUser(accountId, telegramUserId);
    this.configService.linkTelegramIdentity(accountId, telegramUserId);
    this.rateLimits.delete(rateKey);
    return "ok";
  }

  public sweepExpired(): void {
    this.repo.deleteExpired(new Date(this.now()).toISOString());
  }

  private isRateLocked(rateKey: string): boolean {
    const entry = this.rateLimits.get(rateKey);
    if (!entry) return false;
    if (entry.lockedUntil > this.now()) return true;
    if (entry.lockedUntil !== 0 && entry.lockedUntil <= this.now()) {
      this.rateLimits.delete(rateKey);
    }
    return false;
  }

  private recordFailure(rateKey: string): void {
    const nowMs = this.now();
    const entry = this.rateLimits.get(rateKey);
    if (!entry || nowMs - entry.windowStart > RATE_WINDOW_MS) {
      this.rateLimits.set(rateKey, { failures: 1, windowStart: nowMs, lockedUntil: 0 });
      return;
    }
    entry.failures += 1;
    if (entry.failures >= RATE_HARD_LOCK_FAILS) {
      entry.lockedUntil = nowMs + RATE_HARD_LOCK_MS;
    }
  }
}

function generateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return out;
}

export const __INTERNALS_FOR_TEST__ = {
  RATE_WINDOW_MS,
  RATE_SOFT_FAIL_PER_WINDOW,
  RATE_HARD_LOCK_FAILS,
  RATE_HARD_LOCK_MS,
  CODE_ALPHABET,
  CODE_LENGTH,
};
