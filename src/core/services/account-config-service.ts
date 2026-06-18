import type { AccountConfigRepository, AccountConfigRecord, AccountConfigPatch, AccountRepository } from "../ports/repositories";
import { AppError } from "../../shared/errors/app-error";

export class AccountConfigService {
  private readonly accountRepo: AccountRepository;
  private readonly configRepo: AccountConfigRepository;

  public constructor(accountRepo: AccountRepository, configRepo: AccountConfigRepository) {
    this.accountRepo = accountRepo;
    this.configRepo = configRepo;
  }

  public ensure(accountId: string): AccountConfigRecord {
    if (!this.accountRepo.getAccount(accountId)) {
      throw new AppError("ACCOUNT_NOT_FOUND", "账号不存在", 404);
    }
    return this.configRepo.ensure(accountId);
  }

  public get(accountId: string): AccountConfigRecord | null {
    return this.configRepo.get(accountId);
  }

  public update(accountId: string, patch: AccountConfigPatch): AccountConfigRecord {
    this.ensure(accountId);
    return this.configRepo.upsert(accountId, patch);
  }

  public setBotToken(accountId: string, token: string): AccountConfigRecord {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new AppError("BOT_TOKEN_EMPTY", "bot token 不能为空", 400);
    }
    return this.update(accountId, { telegramBotToken: trimmed });
  }

  public clearBotToken(accountId: string): AccountConfigRecord {
    return this.update(accountId, { telegramBotToken: null, botEnabled: false });
  }

  public setAllowedUsers(accountId: string, userIds: string[]): AccountConfigRecord {
    const cleaned = Array.from(new Set(userIds.map((id) => String(id).trim()).filter(Boolean)));
    return this.update(accountId, { telegramAllowedUserIds: cleaned });
  }

  public isTelegramUserAllowed(accountId: string, telegramUserId: string): boolean {
    const cfg = this.configRepo.get(accountId);
    if (!cfg) return false;
    if (cfg.telegramAllowedUserIds.length === 0) return false;
    return cfg.telegramAllowedUserIds.includes(String(telegramUserId));
  }

  public linkTelegramIdentity(accountId: string, telegramUserId: string): void {
    this.accountRepo.linkExternalIdentity(accountId, "telegram", String(telegramUserId));
  }
}
