export type ChatKind = "individual" | "group" | "official" | "service" | "system" | "openim" | "filehelper";

export type ChatDto = {
  id: string;
  displayName: string;
  lastMessagePreview?: string;
  lastMessageTime?: string;
  unreadCount: number;
  isGroup: boolean;
  kind: ChatKind;
  canSend: boolean;
};

export type MessageDto = {
  id: string;
  localId: number;
  chatId: string;
  senderName?: string;
  senderId?: string;
  direction: "in" | "out" | "unknown";
  type: "text" | "image" | "file" | "voice" | "video" | "system" | "unknown";
  text?: string;
  timestamp: string;
  mediaLocalId?: string;
  fileName?: string;
  fileSize?: number;
  optimistic?: boolean;
  failed?: boolean;
  pending?: boolean;
};

export type ServerFileDto = {
  id: string;
  filename: string;
  size: number;
  modifiedAt: string;
  sourcePathHint: string;
  contentType: string;
};

export type StatusDto = {
  agentReachable: boolean;
  loggedIn: boolean;
  status: string;
  loggedInUser?: string;
  error?: string;
};

export type MediaVariant = "thumb" | "preview" | "original";

export type RefreshReason = "initial" | "switch-chat" | "poll" | "send";
