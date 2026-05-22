export interface AgentChat {
  id: string;
  username?: string;
  name?: string;
  remark?: string;
  lastMessagePreview?: string;
  lastMessageSender?: string;
  lastActivityAt?: string;
  unreadCount?: number;
  isGroup?: boolean;
  lastMsgLocalId?: number;
}

export interface AgentMessage {
  localId: number;
  serverId?: number;
  chatId: string;
  sender?: string;
  senderName?: string;
  type: number;
  content: string;
  timestamp: string;
  isMentioned?: boolean;
  isSelf?: boolean;
  reply?: unknown;
}

export interface AgentMedia {
  type: string;
  data?: string;
  url?: string;
  format?: string;
  filename?: string;
}

export interface AgentSendResult {
  success: boolean;
  error?: string;
}

export interface AgentClient {
  authStatus(): Promise<unknown>;
  listChats(limit: number, offset: number): Promise<AgentChat[]>;
  listMessages(chatId: string, limit: number, offset: number): Promise<AgentMessage[]>;
  getMedia(chatId: string, localId: string): Promise<AgentMedia>;
  sendMessage(chatId: string, text: string): Promise<AgentSendResult>;
  screenshot(): Promise<unknown>;
  a11y(): Promise<unknown>;
}

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code = "HTTP_ERROR"
  ) {
    super(message);
  }
}
