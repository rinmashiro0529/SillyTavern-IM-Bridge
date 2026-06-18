import { Bot } from "grammy";
import type { AccountConfigRecord, AccountConfigRepository } from "../ports/repositories";
import { AppError } from "../../shared/errors/app-error";
import { nowIso } from "../../shared/utils/time";
import {
  BOT_COMMANDS,
  BOT_DESCRIPTION,
  BOT_SHORT_DESCRIPTION,
} from "../../delivery/telegram/commands";
import {
  registerHandlers,
  type BotInstanceContext,
  type BotRuntimeConfig,
} from "../../delivery/telegram/handlers";
import {
  TelegramSender,
} from "../../delivery/telegram/telegram-sender";
import {
  TelegramChatQueue,
  type TelegramChatQueueOptions,
} from "../../delivery/telegram/telegram-chat-queue";

export type BotStatus = "starting" | "running" | "stopping" | "stopped" | "error";

export interface BotEntry {
  accountId: string;
  handle: string | null;
  bot: Bot;
  sender: TelegramSender;
  queue: TelegramChatQueue;
  startedAt: string;
  username: string | null;
  lastError: string | null;
  status: BotStatus;
}

export interface BotManagerDependencies {
  configRepo: AccountConfigRepository;
  resolveHandle: (accountId: string) => string | null;
  buildRuntimeConfig: (cfg: AccountConfigRecord) => BotRuntimeConfig;
  buildQueueOptions: (cfg: AccountConfigRecord) => TelegramChatQueueOptions;
  registerBot: (
    bot: Bot,
    botCtx: BotInstanceContext,
    sender: TelegramSender,
    queue: TelegramChatQueue,
  ) => void;
}

export class BotManager {
  private readonly entries = new Map<string, BotEntry>();
  private readonly deps: BotManagerDependencies;

  public constructor(deps: BotManagerDependencies) {
    this.deps = deps;
  }

  public list(): BotEntry[] {
    return [...this.entries.values()];
  }

  public get(accountId: string): BotEntry | null {
    return this.entries.get(accountId) ?? null;
  }

  public async startBot(accountId: string): Promise<BotEntry> {
    if (this.entries.has(accountId)) {
      throw new AppError("BOT_ALREADY_RUNNING", "Bot 已在运行", 409);
    }
    const cfg = this.deps.configRepo.get(accountId);
    if (!cfg) {
      throw new AppError("ACCOUNT_CONFIG_MISSING", "账号配置缺失", 404);
    }
    if (!cfg.telegramBotToken) {
      throw new AppError("BOT_TOKEN_MISSING", "请先配置 bot token", 400);
    }
    const queue = new TelegramChatQueue(this.deps.buildQueueOptions(cfg));
    const sender = new TelegramSender(queue, { enableOutboundLogs: true });
    const bot = new Bot(cfg.telegramBotToken);
    const handle = this.deps.resolveHandle(accountId);
    const entry: BotEntry = {
      accountId,
      handle,
      bot,
      sender,
      queue,
      startedAt: nowIso(),
      username: null,
      lastError: null,
      status: "starting",
    };
    this.entries.set(accountId, entry);

    bot.catch((err) => {
      entry.lastError = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ scope: "bot_manager", accountId, event: "bot_error", message: entry.lastError }));
    });

    try {
      await bot.api.setMyCommands(BOT_COMMANDS);
      await bot.api.setMyDescription(BOT_DESCRIPTION);
      await bot.api.setMyShortDescription(BOT_SHORT_DESCRIPTION);
    } catch (error) {
      entry.lastError = error instanceof Error ? error.message : String(error);
      entry.status = "error";
      this.entries.delete(accountId);
      this.deps.configRepo.upsert(accountId, { botEnabled: false });
      throw new AppError("BOT_INIT_FAILED", `Bot 初始化失败: ${entry.lastError}`, 502);
    }

    const botCtx: BotInstanceContext = {
      accountId,
      config: this.deps.buildRuntimeConfig(cfg),
      sender,
    };

    this.deps.registerBot(bot, botCtx, sender, queue);

    void bot
      .start({
        onStart: ({ username }) => {
          entry.username = username;
          entry.status = "running";
        },
      })
      .catch((error) => {
        entry.lastError = error instanceof Error ? error.message : String(error);
        entry.status = "error";
        console.error(JSON.stringify({ scope: "bot_manager", accountId, event: "bot_start_failed", message: entry.lastError }));
      });

    this.deps.configRepo.upsert(accountId, { botEnabled: true });
    return entry;
  }

  public async stopBot(accountId: string): Promise<void> {
    const entry = this.entries.get(accountId);
    if (!entry) return;
    entry.status = "stopping";
    try {
      await entry.bot.stop();
    } catch (error) {
      entry.lastError = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ scope: "bot_manager", accountId, event: "bot_stop_failed", message: entry.lastError }));
    } finally {
      this.entries.delete(accountId);
      try { this.deps.configRepo.upsert(accountId, { botEnabled: false }); }
      catch (e) { console.error(JSON.stringify({ scope: "bot_manager", accountId, event: "config_disable_failed", message: e instanceof Error ? e.message : String(e) })); }
    }
  }

  public async restartBot(accountId: string): Promise<BotEntry> {
    await this.stopBot(accountId);
    return this.startBot(accountId);
  }

  public async autostartAll(): Promise<void> {
    const cfgs = this.deps.configRepo.listEnabledWithToken();
    await Promise.allSettled(cfgs.map((cfg) => this.startBot(cfg.accountId)));
  }

  public async stopAll(): Promise<void> {
    const ids = [...this.entries.keys()];
    await Promise.allSettled(ids.map((id) => this.stopBot(id)));
  }
}
