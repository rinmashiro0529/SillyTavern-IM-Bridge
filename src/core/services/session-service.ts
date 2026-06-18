import type { ActiveSession, RecentSession } from "../models/index";
import type { SessionRepository } from "../ports/repositories";
import { AppError } from "../../shared/errors/app-error";

export class SessionService {
  private readonly sessionRepository: SessionRepository;

  public constructor(sessionRepository: SessionRepository) {
    this.sessionRepository = sessionRepository;
  }

  public getActiveSession(accountId: string): ActiveSession | null {
    return this.sessionRepository.getActiveSession(accountId);
  }

  public requireActiveSession(accountId: string): ActiveSession {
    const session = this.getActiveSession(accountId);
    if (!session?.activeCharacterAvatar || !session.activeCharacterName || !session.activeChatFile) {
      throw new AppError("SESSION_NOT_SELECTED", "当前没有绑定角色和会话。", 400);
    }

    return session;
  }

  public setActiveCharacter(accountId: string, avatar: string, name: string): void {
    this.sessionRepository.setActiveCharacter(accountId, avatar, name);
  }

  public setActiveSession(accountId: string, avatar: string, name: string, chatFile: string): void {
    this.sessionRepository.setActiveSession(accountId, avatar, name, chatFile);
  }

  public listRecentSessions(accountId: string, limit?: number): RecentSession[] {
    return this.sessionRepository.listRecentSessions(accountId, limit);
  }

  public setModelOverride(accountId: string, modelId: string): void {
    this.sessionRepository.setActiveModelOverride(accountId, modelId);
  }

  public clearModelOverride(accountId: string): void {
    this.sessionRepository.clearActiveModelOverride(accountId);
  }

  public setCurrentModel(accountId: string, modelId: string | null): void {
    this.sessionRepository.setCurrentModel(accountId, modelId);
  }
}
