import type { StGenerationSettings } from "../../core/models/index";
import { AppError } from "../../shared/errors/app-error";
import { StClient } from "../st/st-client";

const COMPRESSION_SYSTEM_PROMPT = [
  "你是一个文本压缩助手，专门为角色扮演/叙事类对话压缩 AI 回复。",
  "",
  "压缩规则：",
  "1. 保留：关键情节推进、角色行为动作、情感变化、重要对话内容、剧情转折点。",
  "2. 删除：重复的环境描写、冗余的内心独白、过渡性文字、重复的形容词堆砌。",
  "3. 目标长度：原文的 30%-50%。",
  "4. 保持原文的人物视角和叙事风格（第一人称保持第一人称，第三人称保持第三人称）。",
  "5. 保留原文中的关键引语（带引号的对话）的核心内容，可以缩短但不要删除。",
  "",
  "输出要求：",
  "- 直接输出压缩后的文本，不要添加任何前缀、标记、解释、JSON 包装。",
  "- 不要回答用户的问题或继续对话，只是压缩给定的文本。",
  "- 不要使用 \"【压缩版】\"、\"摘要：\" 等任何说明性前缀。",
].join("\n");

export interface CompressionItem {
  index: number;
  originalText: string;
  characterName: string;
  prevUserText: string | null;
}

export interface CompressionResult {
  index: number;
  originalText: string;
  compressedText: string | null;
  errorMessage: string | null;
}

export interface CompressionClientOptions {
  timeoutMs: number;
  batchSize: number;
  retryCount: number;
  retryDelayMs: number;
}

export class CompressionClient {
  private readonly stClient: StClient;
  private readonly defaults: CompressionClientOptions;

  public constructor(stClient: StClient, defaults: CompressionClientOptions) {
    this.stClient = stClient;
    this.defaults = defaults;
  }

  public async compressOne(
    item: CompressionItem,
    settings: StGenerationSettings,
    options?: Partial<CompressionClientOptions>,
  ): Promise<CompressionResult> {
    const opts = { ...this.defaults, ...(options ?? {}) };
    const userPayload = item.prevUserText
      ? [
          `角色名：${item.characterName}`,
          `（仅供参考的上文用户消息）：${item.prevUserText.slice(0, 800)}`,
          "",
          "需要压缩的 AI 回复原文：",
          item.originalText,
        ].join("\n")
      : [
          `角色名：${item.characterName}`,
          "",
          "需要压缩的 AI 回复原文：",
          item.originalText,
        ].join("\n");

    const maxAttempts = Math.max(1, opts.retryCount + 1);
    let lastErrorMessage = "";
    let lastRawPreview = "";

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (attempt > 0) {
        const baseDelay = Math.max(0, opts.retryDelayMs);
        const jitter = Math.floor(Math.random() * 400);
        await new Promise((resolve) => setTimeout(resolve, baseDelay * Math.pow(2, attempt - 1) + jitter));
      }

      try {
        const response = await this.stClient.generateChatReply({
          settings,
          messages: [
            { role: "system", content: COMPRESSION_SYSTEM_PROMPT },
            { role: "user", content: userPayload },
          ],
        });

        const compressed = this.extractText(response);
        const sanitized = this.sanitize(compressed);

        if (!sanitized) {
          lastErrorMessage = "compression returned empty text";
          lastRawPreview = typeof compressed === "string" ? compressed.slice(0, 200) : "";
          continue;
        }

        if (sanitized.length >= item.originalText.length) {
          console.error(JSON.stringify({
            scope: "compression_client",
            event: "result_not_shorter",
            index: item.index,
            originalLength: item.originalText.length,
            compressedLength: sanitized.length,
          }));
          return { index: item.index, originalText: item.originalText, compressedText: null, errorMessage: "compression result not shorter than original" };
        }

        return { index: item.index, originalText: item.originalText, compressedText: sanitized, errorMessage: null };
      } catch (error) {
        lastErrorMessage = error instanceof Error ? error.message : String(error);
        if (!/Bad Gateway|502|503|504|timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND/i.test(lastErrorMessage)) {
          break;
        }
      }
    }

    console.error(JSON.stringify({
      scope: "compression_client",
      event: "compress_one_failed",
      index: item.index,
      attempts: maxAttempts,
      message: lastErrorMessage,
      rawPreview: lastRawPreview,
    }));
    return { index: item.index, originalText: item.originalText, compressedText: null, errorMessage: lastErrorMessage };
  }

  public async compressBatch(
    items: CompressionItem[],
    settings: StGenerationSettings,
    optionsOrCallback?: Partial<CompressionClientOptions> | ((completedCount: number, totalCount: number) => Promise<void> | void),
    onBatchDone?: (completedCount: number, totalCount: number) => Promise<void> | void,
  ): Promise<CompressionResult[]> {
    if (items.length === 0) {
      return [];
    }
    const options = typeof optionsOrCallback === "function" ? undefined : optionsOrCallback;
    const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : onBatchDone;
    const opts = { ...this.defaults, ...(options ?? {}) };

    const results: CompressionResult[] = [];
    const batchSize = Math.max(1, opts.batchSize);

    for (let offset = 0; offset < items.length; offset += batchSize) {
      const batch = items.slice(offset, offset + batchSize);
      const batchResults = await Promise.all(batch.map((item) => this.compressOne(item, settings, opts)));
      results.push(...batchResults);
      await callback?.(results.length, items.length);
    }

    return results;
  }

  private extractText(response: any): string {
    if (typeof response?.error?.message === "string" && response.error.message.trim()) {
      throw new AppError("COMPRESS_GENERATE_FAILED", `压缩调用失败: ${response.error.message.trim()}`, 502);
    }

    const message = response?.choices?.[0]?.message?.content;
    if (typeof message === "string") {
      return message;
    }

    if (Array.isArray(message)) {
      return message.map((item) => (typeof item?.text === "string" ? item.text : "")).join("");
    }

    return "";
  }

  private sanitize(text: string): string {
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```[\w-]*\n?/g, "").replace(/```\s*$/g, "");
    cleaned = cleaned.replace(/^(?:【?(?:压缩版|压缩后|摘要|Summary|Compressed)】?[:：]?\s*)/i, "");
    cleaned = cleaned.trim();
    return cleaned;
  }
}
