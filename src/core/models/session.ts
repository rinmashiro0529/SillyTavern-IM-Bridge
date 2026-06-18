export interface ActiveSession {
  accountId: string;
  activeCharacterAvatar: string | null;
  activeCharacterName: string | null;
  activeChatFile: string | null;
  activeModelOverride: string | null;
  compressionModelOverride: string | null;
  currentModel: string | null;
  updatedAt: string;
}

export interface RecentSession {
  accountId: string;
  characterAvatar: string;
  characterName: string;
  chatFile: string;
  activeModelOverride: string | null;
  lastUsedAt: string;
}
