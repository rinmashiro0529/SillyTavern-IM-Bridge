export interface UserState {
  telegramUserId: string;
  activeCharacterAvatar: string | null;
  activeCharacterName: string | null;
  activeChatFile: string | null;
  activeModelOverride: string | null;
  updatedAt: string;
}

export interface MessageLink {
  id: number;
  telegramUserId: string;
  chatId: string;
  userMessageId: number;
  botMessageIds: number[];
  characterAvatar: string;
  characterName: string;
  chatFile: string;
  createdAt: string;
  revokedAt: string | null;
}
