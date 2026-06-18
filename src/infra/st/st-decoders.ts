import type {
  CharacterCardDetails,
  CharacterSummary,
  ChatMessage,
  ChatSearchResult,
  ModelSummary,
  StGenerationSettings,
} from "../../core/models/index";
import { timestampToMillis, normalizeChatFileName } from "./st-chat-mapper";
import { createStPayloadError } from "./st-errors";

export function decodeCharacterSummaries(payload: unknown): CharacterSummary[] {
  const items = Array.isArray(payload) ? payload : [];

  return items
    .map((item: any) => ({
      avatar: typeof item.avatar === "string" ? item.avatar : "",
      name: typeof item.name === "string" ? item.name : (typeof item.data?.name === "string" ? item.data.name : "Unknown"),
      dateLastChat: Number.isFinite(Number(item.date_last_chat)) ? Number(item.date_last_chat) : null,
      chatSize: Number.isFinite(Number(item.chat_size)) ? Number(item.chat_size) : null,
      dataSize: Number.isFinite(Number(item.data_size)) ? Number(item.data_size) : null,
    }))
    .filter((item) => item.avatar)
    .sort((left, right) => {
      const timeDiff = (right.dateLastChat ?? 0) - (left.dateLastChat ?? 0);
      if (timeDiff !== 0) {
        return timeDiff;
      }

      return left.name.localeCompare(right.name, "zh-Hans-CN");
    });
}

export function decodeCharacterCard(payload: unknown, avatar: string): CharacterCardDetails {
  const items = Array.isArray(payload) ? payload : [];
  const item = items.find((entry: any) => entry?.avatar === avatar);

  if (!item) {
    throw createStPayloadError("CHARACTER_NOT_FOUND", `Character not found: ${avatar}`);
  }

  return {
    avatar: String(item.avatar),
    name: typeof item.name === "string" ? item.name : "",
    description: typeof item.description === "string" ? item.description : "",
    personality: typeof item.personality === "string" ? item.personality : "",
    scenario: typeof item.scenario === "string" ? item.scenario : "",
    firstMes: typeof item.first_mes === "string" ? item.first_mes : "",
    mesExample: typeof item.mes_example === "string" ? item.mes_example : "",
  };
}

export function decodeChatSearchResults(payload: unknown): ChatSearchResult[] {
  const items = Array.isArray(payload) ? payload : [];

  return items
    .map((item: any) => ({
      fileId: typeof item.file_name === "string" ? item.file_name : "",
      fileName: normalizeChatFileName(typeof item.file_name === "string" ? item.file_name : ""),
      fileSize: typeof item.file_size === "string" ? item.file_size : "Unknown",
      messageCount: Number.isFinite(Number(item.message_count)) ? Number(item.message_count) : 0,
      lastMessageAt: item.last_mes ?? null,
      previewMessage: typeof item.preview_message === "string" ? item.preview_message.trim() : "",
    }))
    .filter((item) => item.fileId)
    .sort((left, right) => timestampToMillis(right.lastMessageAt) - timestampToMillis(left.lastMessageAt));
}

export function decodeChatMessages(payload: unknown): ChatMessage[] {
  if (!Array.isArray(payload)) {
    throw createStPayloadError(
      "ST_CHAT_PAYLOAD_INVALID",
      `ST /api/chats/get returned non-array payload (${typeof payload}). Refusing to treat as empty chat.`,
    );
  }
  return payload as ChatMessage[];
}

export function decodeGenerationSettings(payload: any): StGenerationSettings {
  const settingsText = typeof payload?.settings === "string" ? payload.settings : "";
  if (!settingsText) {
    throw createStPayloadError("ST_SETTINGS_MISSING", "ST settings payload missing");
  }

  let settings: any;
  try {
    settings = JSON.parse(settingsText);
  } catch {
    throw createStPayloadError("ST_SETTINGS_INVALID", "ST settings payload is not valid JSON");
  }

  const oai = settings.oai_settings ?? {};
  const source = typeof oai.chat_completion_source === "string" ? oai.chat_completion_source : "custom";
  const customUrl = typeof oai.custom_url === "string" ? oai.custom_url : "";
  const customModel = typeof oai.custom_model === "string" && oai.custom_model.trim() ? oai.custom_model.trim() : "";
  const openaiModel = typeof oai.openai_model === "string" && oai.openai_model.trim() ? oai.openai_model.trim() : "";
  const model = customModel || openaiModel;

  if (!model) {
    throw createStPayloadError("ST_MODEL_MISSING", "ST current model is missing");
  }

  return {
    username: typeof settings.username === "string" && settings.username.trim() ? settings.username.trim() : "User",
    chatCompletionSource: source,
    model,
    customUrl,
    customPromptPostProcessing: typeof oai.custom_prompt_post_processing === "string" ? oai.custom_prompt_post_processing : "",
    temperature: Number.isFinite(Number(oai.temp_openai)) ? Number(oai.temp_openai) : 1,
    topP: Number.isFinite(Number(oai.top_p_openai)) ? Number(oai.top_p_openai) : 1,
    maxTokens: Number.isFinite(Number(oai.openai_max_tokens)) ? Number(oai.openai_max_tokens) : 1024,
  };
}

export function decodeModelSummaries(payload: any): ModelSummary[] {
  const data = Array.isArray(payload?.data) ? payload.data : [];

  return data
    .map((item: any) => ({
      id: typeof item?.id === "string" ? item.id : "",
      ownedBy: typeof item?.owned_by === "string" ? item.owned_by : null,
      description: typeof item?.description === "string" ? item.description : null,
    }))
    .filter((item: ModelSummary) => item.id);
}
