import type { IdentityChannel } from "./account";

export type TurnOperation =
  | "telegram_send_stream"
  | "telegram_undo"
  | "telegram_revoke"
  | "telegram_redo_stream"
  | "telegram_compress"
  | "http_send"
  | "http_undo"
  | "http_send_stream"
  | "http_redo_stream"
  | "http_compress";

export type TurnStatus = "started" | "completed" | "failed";

export interface TurnRecord {
  id: number;
  accountId: string;
  channel: IdentityChannel;
  sessionKey: string;
  clientTurnId: string | null;
  requestId: string | null;
  traceId: string | null;
  operation: TurnOperation | null;
  status: TurnStatus;
  errorMessage: string | null;
  externalRefs: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}
