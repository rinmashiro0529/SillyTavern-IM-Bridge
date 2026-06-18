import type { ModelSummary } from "../models/index";
import type { SessionRepository } from "../ports/repositories";
import { StClient } from "../../infra/st/st-client";

export class ModelService {
  private readonly stClient: StClient;
  private readonly sessionRepository: SessionRepository;

  public constructor(stClient: StClient, sessionRepository: SessionRepository) {
    this.stClient = stClient;
    this.sessionRepository = sessionRepository;
  }

  public async listAvailableModels(accountId: string): Promise<{
    currentModel: string;
    overrideModel: string | null;
    items: ModelSummary[];
  }> {
    const settings = await this.stClient.getGenerationSettings();
    this.sessionRepository.setCurrentModel(accountId, settings.model);
    const items = await this.stClient.listAvailableModels(settings);
    const activeSession = this.sessionRepository.getActiveSession(accountId);

    return {
      currentModel: settings.model,
      overrideModel: activeSession?.activeModelOverride ?? null,
      items,
    };
  }

  public async listCompressionModels(accountId: string): Promise<{
    currentModel: string;
    overrideModel: string | null;
    items: ModelSummary[];
  }> {
    const settings = await this.stClient.getGenerationSettings();
    this.sessionRepository.setCurrentModel(accountId, settings.model);
    const items = await this.stClient.listAvailableModels(settings);
    const activeSession = this.sessionRepository.getActiveSession(accountId);

    return {
      currentModel: settings.model,
      overrideModel: activeSession?.compressionModelOverride ?? null,
      items,
    };
  }

  public selectModel(accountId: string, modelId: string): void {
    this.sessionRepository.setActiveModelOverride(accountId, modelId);
  }

  public clearModelSelection(accountId: string): void {
    this.sessionRepository.clearActiveModelOverride(accountId);
  }

  public selectCompressionModel(accountId: string, modelId: string): void {
    this.sessionRepository.setCompressionModelOverride(accountId, modelId);
  }

  public clearCompressionModelSelection(accountId: string): void {
    this.sessionRepository.clearCompressionModelOverride(accountId);
  }
}
