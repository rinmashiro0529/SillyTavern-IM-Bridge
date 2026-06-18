import type {
  ChatMessage,
  StGenerationSettings,
} from "../models/index";
import type { AccountConfigRepository, HistorySyncRepository } from "../ports/repositories";
import { AppError } from "../../shared/errors/app-error";
import { buildSessionMutationKey, buildSessionKey } from "../../shared/utils/ids";
import { StClient } from "../../infra/st/st-client";
import {
  CompressionClient,
  type CompressionItem,
  type CompressionResult,
} from "../../infra/llm/compression-client";
import {
  formatPreviewText,
  listHistorySyncRecords,
  normalizeChatFileName,
} from "../../infra/st/st-chat-mapper";
import { assertChatIntact } from "./conversation-service";
import { SessionTaskQueue } from "./session-task-queue";

export type CompressProgressEvent =
  | { type: "started"; totalMessages: number; sessionKey: string }
  | { type: "batch_done"; completedMessages: number; totalMessages: number }
  | {
      type: "done";
      compressedCount: number;
      skippedCount: number;
      originalBytes: number;
      compressedBytes: number;
      backupFile: string;
    }
  | { type: "error"; message: string };

export interface CompressChatParams {
  accountId: string;
  avatar: string;
  characterName: string;
  chatFile: string;
  modelOverride?: string | null;
  onProgress?: (event: CompressProgressEvent) => Promise<void> | void;
}

export interface CompressChatResult {
  compressedCount: number;
  skippedCount: number;
  originalBytes: number;
  compressedBytes: number;
  backupFile: string;
  errors: Array<{ index: number; message: string }>;
}

export interface CompressionServiceOptions {
  keepRecent: number;
  batchSize: number;
  timeoutMs: number;
  retryCount: number;
  retryDelayMs: number;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function buildBackupFileName(originalChatFile: string): string {
  const normalized = normalizeChatFileName(originalChatFile);
  const stem = normalized.endsWith(".jsonl") ? normalized.slice(0, -".jsonl".length) : normalized;
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}_${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}`;
  return `${stem}.pre_compress_${stamp}`;
}

function chatBytes(chat: ChatMessage[]): number {
  let total = 0;
  for (const message of chat) {
    total += Buffer.byteLength(JSON.stringify(message), "utf8") + 1;
  }
  return total;
}

function isCompressibleAssistant(message: ChatMessage | undefined): boolean {
  if (!message) {
    return false;
  }
  if (message.is_user || message.is_system) {
    return false;
  }
  if (typeof message.mes !== "string" || !message.mes.trim()) {
    return false;
  }
  if ((message as { extra?: { compressed?: unknown } }).extra?.compressed === true) {
    return false;
  }
  if (message.mes.startsWith("[CompressionDigest]")) {
    return false;
  }
  return true;
}

function findPrevUserText(chat: ChatMessage[], index: number): string | null {
  for (let cursor = index - 1; cursor > 0; cursor -= 1) {
    const message = chat[cursor];
    if (message?.is_user && typeof message.mes === "string" && message.mes.trim()) {
      return message.mes.trim();
    }
  }
  return null;
}

export class CompressionService {
  private readonly stClient: StClient;
  private readonly compressionClient: CompressionClient;
  private readonly sessionTaskQueue: SessionTaskQueue;
  private readonly historySyncRepository: HistorySyncRepository;
  private readonly accountConfigRepository: AccountConfigRepository;
  private readonly defaults: CompressionServiceOptions;

  public constructor(
    stClient: StClient,
    compressionClient: CompressionClient,
    sessionTaskQueue: SessionTaskQueue,
    historySyncRepository: HistorySyncRepository,
    accountConfigRepository: AccountConfigRepository,
    defaults: CompressionServiceOptions,
  ) {
    this.stClient = stClient;
    this.compressionClient = compressionClient;
    this.sessionTaskQueue = sessionTaskQueue;
    this.historySyncRepository = historySyncRepository;
    this.accountConfigRepository = accountConfigRepository;
    this.defaults = defaults;
  }

  private resolveOptions(accountId: string): CompressionServiceOptions {
    const cfg = this.accountConfigRepository.get(accountId);
    if (!cfg) return this.defaults;
    return {
      keepRecent: cfg.compress.keepRecent ?? this.defaults.keepRecent,
      batchSize: cfg.compress.batchSize ?? this.defaults.batchSize,
      timeoutMs: cfg.compress.timeoutMs ?? this.defaults.timeoutMs,
      retryCount: cfg.compress.retryCount ?? this.defaults.retryCount,
      retryDelayMs: cfg.compress.retryDelayMs ?? this.defaults.retryDelayMs,
    };
  }

  public async compressChat(params: CompressChatParams): Promise<CompressChatResult> {
    return this.sessionTaskQueue.runExclusive(
      buildSessionMutationKey(params.accountId, params.avatar, params.chatFile),
      () => this.compressWithinLock(params),
    );
  }

  private async compressWithinLock(params: CompressChatParams): Promise<CompressChatResult> {
    const sessionKey = buildSessionKey(params.avatar, params.chatFile);
    const opts = this.resolveOptions(params.accountId);

    try {
      const [settings, chat] = await Promise.all([
        this.stClient.getGenerationSettings(),
        this.stClient.getChatMessages(params.avatar, params.chatFile),
      ]);

      assertChatIntact(params.avatar, params.chatFile, chat);

      const effectiveSettings: StGenerationSettings = { ...settings };
      if (params.modelOverride && params.modelOverride.trim()) {
        effectiveSettings.model = params.modelOverride.trim();
      }

      const keepRecent = Math.max(0, opts.keepRecent);
      const lastDialogueIndices: number[] = [];
      for (let cursor = chat.length - 1; cursor >= 1; cursor -= 1) {
        const message = chat[cursor];
        if (!message || message.is_system) {
          continue;
        }
        if (typeof message.mes !== "string" || !message.mes.trim()) {
          continue;
        }
        lastDialogueIndices.push(cursor);
        if (lastDialogueIndices.length >= keepRecent) {
          break;
        }
      }
      const protectedFromIndex = lastDialogueIndices.length > 0 ? Math.min(...lastDialogueIndices) : chat.length;

      const items: CompressionItem[] = [];
      for (let index = 1; index < protectedFromIndex; index += 1) {
        const message = chat[index];
        if (!isCompressibleAssistant(message)) {
          continue;
        }
        items.push({
          index,
          originalText: message!.mes as string,
          characterName: typeof message!.name === "string" && message!.name!.trim() ? message!.name!.trim() : params.characterName,
          prevUserText: findPrevUserText(chat, index),
        });
      }

      await params.onProgress?.({ type: "started", totalMessages: items.length, sessionKey });

      if (items.length === 0) {
        const originalBytes = chatBytes(chat);
        await params.onProgress?.({
          type: "done",
          compressedCount: 0,
          skippedCount: 0,
          originalBytes,
          compressedBytes: originalBytes,
          backupFile: "",
        });
        return {
          compressedCount: 0,
          skippedCount: 0,
          originalBytes,
          compressedBytes: originalBytes,
          backupFile: "",
          errors: [],
        };
      }

      const originalBytes = chatBytes(chat);
      const backupFile = buildBackupFileName(params.chatFile);
      await this.stClient.saveChat({
        avatar: params.avatar,
        characterName: params.characterName,
        chatFile: backupFile,
        chat,
      });

      const results = await this.compressionClient.compressBatch(
        items,
        effectiveSettings,
        {
          batchSize: opts.batchSize,
          retryCount: opts.retryCount,
          retryDelayMs: opts.retryDelayMs,
          timeoutMs: opts.timeoutMs,
        },
        async (completed, total) => {
          await params.onProgress?.({ type: "batch_done", completedMessages: completed, totalMessages: total });
        },
      );

      const updatedChat: ChatMessage[] = chat.map((message, index) => {
        const result = results.find((entry) => entry.index === index);
        if (!result || !result.compressedText) {
          return message;
        }

        const prevExtra = (message as { extra?: Record<string, unknown> }).extra ?? {};
        const nextExtra: Record<string, unknown> = { ...prevExtra };
        delete nextExtra["original_text"];
        nextExtra["display_text"] = result.compressedText;
        nextExtra["compressed"] = true;
        nextExtra["compressed_at"] = new Date().toISOString();
        nextExtra["compression_model"] = effectiveSettings.model;
        return {
          ...message,
          mes: result.compressedText,
          extra: nextExtra,
        };
      });

      await this.stClient.saveChat({
        avatar: params.avatar,
        characterName: params.characterName,
        chatFile: params.chatFile,
        chat: updatedChat,
      });

      try {
        const records = listHistorySyncRecords(params.avatar, params.chatFile, updatedChat);
        const lastRecord = records.at(-1);
        const previewMessage = formatPreviewText(lastRecord?.text ?? "");
        this.historySyncRepository.replaceSnapshot({
          sessionKey,
          avatar: params.avatar,
          chatFile: params.chatFile,
          messageCount: updatedChat.length - 1,
          lastMessageAt: lastRecord?.sendDate ?? null,
          previewMessage,
          items: records,
          incrementRevision: true,
        });
      } catch (snapshotError) {
        console.error(JSON.stringify({
          scope: "compression_service",
          event: "history_snapshot_update_failed",
          message: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
        }));
      }

      const compressedCount = results.filter((entry) => entry.compressedText !== null).length;
      const skippedCount = results.length - compressedCount;
      const compressedBytes = chatBytes(updatedChat);
      const errors = results
        .filter((entry: CompressionResult) => entry.errorMessage !== null)
        .map((entry) => ({ index: entry.index, message: entry.errorMessage as string }));

      await params.onProgress?.({
        type: "done",
        compressedCount,
        skippedCount,
        originalBytes,
        compressedBytes,
        backupFile,
      });

      return { compressedCount, skippedCount, originalBytes, compressedBytes, backupFile, errors };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await params.onProgress?.({ type: "error", message });
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError("COMPRESS_FAILED", message, 500);
    }
  }
}
