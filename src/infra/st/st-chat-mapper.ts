import crypto from "node:crypto";
import type { ChatMessage, HistorySyncRecord, LatestDialogueRecord } from "../../core/models/index";

export function normalizeChatFileName(fileId: string): string {
  return fileId.endsWith(".jsonl") ? fileId : `${fileId}.jsonl`;
}

export function compactText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function formatPreviewText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function resolveDialogueContext(
  avatarOrMessages: string | ChatMessage[],
  chatFileOrUndefined?: string,
  messagesOrUndefined?: ChatMessage[],
): { avatar: string; chatFile: string; messages: ChatMessage[] } {
  if (Array.isArray(avatarOrMessages)) {
    return {
      avatar: "",
      chatFile: "",
      messages: avatarOrMessages,
    };
  }

  return {
    avatar: avatarOrMessages,
    chatFile: chatFileOrUndefined ?? "",
    messages: messagesOrUndefined ?? [],
  };
}

function getDialogueTurnId(messages: ChatMessage[], index: number): string {
  let turnOrdinal = 0;
  let latestUserTurnOrdinal = 0;

  for (let cursor = 0; cursor <= index; cursor += 1) {
    const current = messages[cursor];
    if (!current || current.is_system || typeof current.mes !== "string" || !current.mes.trim()) {
      continue;
    }

    if (current.is_user) {
      turnOrdinal += 1;
      latestUserTurnOrdinal = turnOrdinal;
    }
  }

  return `turn-${Math.max(latestUserTurnOrdinal, 1)}`;
}

function buildDialogueMessageId(avatar: string, chatFile: string, index: number, message: ChatMessage, turnId: string): string {
  const raw = [
    avatar,
    normalizeChatFileName(chatFile),
    String(index),
    turnId,
    message.is_user ? "user" : "assistant",
    typeof message.name === "string" ? message.name : "",
    typeof message.send_date === "string" ? message.send_date : "",
    typeof message.extra?.display_text === "string" ? message.extra.display_text : "",
    typeof message.mes === "string" ? message.mes : "",
  ].join("::");

  return crypto.createHash("sha1").update(raw).digest("hex");
}

export function toDialogueRecord(
  avatar: string,
  chatFile: string,
  message: ChatMessage | null | undefined,
  index: number,
  messages: ChatMessage[],
): LatestDialogueRecord | null {
  if (!message || typeof message.mes !== "string" || !message.mes.trim()) {
    return null;
  }

  if (message.is_system) {
    return null;
  }

  const turnId = getDialogueTurnId(messages, index);

  return {
    messageId: buildDialogueMessageId(avatar, chatFile, index, message, turnId),
    turnId,
    speaker: typeof message.name === "string" && message.name.trim() ? message.name.trim() : (message.is_user ? "User" : "Character"),
    text: formatPreviewText(typeof message.extra?.display_text === "string" && message.extra.display_text.trim()
      ? message.extra.display_text
      : message.mes),
    sendDate: typeof message.send_date === "string" ? message.send_date : null,
    isUser: Boolean(message.is_user),
  };
}

export function listDialogueRecords(avatar: string, chatFile: string, messages: ChatMessage[]): LatestDialogueRecord[];
export function listDialogueRecords(messages: ChatMessage[]): LatestDialogueRecord[];
export function listDialogueRecords(
  avatarOrMessages: string | ChatMessage[],
  chatFileOrUndefined?: string,
  messagesOrUndefined?: ChatMessage[],
): LatestDialogueRecord[] {
  const { avatar, chatFile, messages } = resolveDialogueContext(avatarOrMessages, chatFileOrUndefined, messagesOrUndefined);
  return messages
    .map((message, index) => toDialogueRecord(avatar, chatFile, message, index, messages))
    .filter((record): record is LatestDialogueRecord => record !== null);
}

export function listHistorySyncRecords(avatar: string, chatFile: string, messages: ChatMessage[]): HistorySyncRecord[] {
  return messages
    .map((message, index) => {
      const record = toDialogueRecord(avatar, chatFile, message, index, messages);
      return record ? { ...record, sortIndex: index } : null;
    })
    .filter((record): record is HistorySyncRecord => record !== null);
}

export function pickLatestDialogueRecord(avatar: string, chatFile: string, messages: ChatMessage[]): LatestDialogueRecord | null;
export function pickLatestDialogueRecord(messages: ChatMessage[]): LatestDialogueRecord | null;
export function pickLatestDialogueRecord(
  avatarOrMessages: string | ChatMessage[],
  chatFileOrUndefined?: string,
  messagesOrUndefined?: ChatMessage[],
): LatestDialogueRecord | null {
  const { avatar, chatFile, messages } = resolveDialogueContext(avatarOrMessages, chatFileOrUndefined, messagesOrUndefined);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const record = toDialogueRecord(avatar, chatFile, messages[index], index, messages);
    if (record) {
      return record;
    }
  }

  return null;
}

export function timestampToMillis(value: string | number | null): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return asNumber;
    }

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return 0;
}
