import type { IdentityChannel } from "../../core/models/index";
import crypto from "node:crypto";

export function buildTelegramAccountId(telegramUserId: string): string {
  return `tg:${telegramUserId}`;
}

export function buildSessionKey(avatar: string, chatFile: string): string {
  return `${avatar}::${chatFile}`;
}

export function buildSessionMutationKey(accountId: string, avatar: string, chatFile: string): string {
  return `${accountId}::${avatar}::${chatFile}`;
}

export function buildIdentityKey(channel: IdentityChannel, externalUserId: string): string {
  return `${channel}:${externalUserId}`;
}

export function createRequestId(): string {
  return crypto.randomUUID();
}
