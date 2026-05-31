export interface AgentChat {
  id: string;
  username?: string;
  name?: string;
  remark?: string;
  kind?: string;
  lastMessagePreview?: string;
  lastMessageSender?: string;
  lastActivityAt?: string;
  unreadCount?: number;
  isGroup?: boolean;
  localType?: number;
  sessionType?: number;
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

export type AgentSendPayload =
  | { text: string; image?: never; file?: never }
  | { text?: never; image: { data: string; mimeType: string }; file?: never }
  | { text?: never; image?: never; file: { data: string; filename: string } };

export interface AgentServerFile {
  id: string;
  filename: string;
  size: number;
  modifiedAt: string;
  sourcePathHint: string;
  contentType: string;
}

export interface AgentFileDownload {
  file: AgentServerFile;
  data: string;
}

export interface AgentLoginOptions {
  newAccount: boolean;
  timeoutMs: number;
}

export interface AgentClient {
  authStatus(): Promise<unknown>;
  loginEvents(options: AgentLoginOptions): AsyncIterable<unknown>;
  listChats(limit: number, offset: number): Promise<AgentChat[]>;
  openChat(chatId: string, clearUnreads: boolean): Promise<unknown>;
  listMessages(chatId: string, limit: number, offset: number): Promise<AgentMessage[]>;
  getMedia(chatId: string, localId: string): Promise<AgentMedia>;
  sendMessage(chatId: string, payload: AgentSendPayload): Promise<AgentSendResult>;
  listFiles(limit: number, offset: number, type: string): Promise<AgentServerFile[]>;
  downloadFile(id: string): Promise<AgentFileDownload>;
  deleteFile(id: string): Promise<{ ok: boolean; error?: string }>;
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
