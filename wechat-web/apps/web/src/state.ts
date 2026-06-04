import type { ChatDto, ServerFileDto, StatusDto, MessageDto, ChatKind } from "./types.js";

export const MAX_UPLOAD_BYTES = 35 * 1024 * 1024;
const SELECTED_CHAT_STORAGE_KEY = "agent-wechat:selected-chat-id";

function readStoredSelectedChatId(): string {
  try {
    return window.localStorage.getItem(SELECTED_CHAT_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function storeSelectedChatId(chatId: string): void {
  try {
    if (chatId) window.localStorage.setItem(SELECTED_CHAT_STORAGE_KEY, chatId);
    else window.localStorage.removeItem(SELECTED_CHAT_STORAGE_KEY);
  } catch {
    // localStorage may be blocked in private or embedded contexts.
  }
}

export const state: {
  status: StatusDto | null;
  chats: ChatDto[];
  selectedChatId: string;
  messages: MessageDto[];
  error: string;
  sending: boolean;
  uploadStatus: string;
  filesOpen: boolean;
  attachMenuOpen: boolean;
  serverFiles: ServerFileDto[];
  loginQrDataUrl: string;
  loginMessage: string;
  loginQrFailed: boolean;
  previewImageUrl: string;
  newMessageCount: number;
  showBottomButton: boolean;
  composing: boolean;
  serviceFolderOpen: boolean;
} = {
  status: null,
  chats: [],
  selectedChatId: readStoredSelectedChatId(),
  messages: [],
  error: "",
  sending: false,
  uploadStatus: "",
  filesOpen: false,
  attachMenuOpen: false,
  serverFiles: [],
  loginQrDataUrl: "",
  loginMessage: "",
  loginQrFailed: false,
  previewImageUrl: "",
  newMessageCount: 0,
  showBottomButton: false,
  composing: false,
  serviceFolderOpen: false,
};

export function selectedChat(): ChatDto | undefined {
  return state.chats.find((chat) => chat.id === state.selectedChatId);
}

export function labelForKind(kind: ChatKind): string {
  return {
    individual: "好友",
    group: "群聊",
    official: "公众号",
    service: "服务通知",
    system: "系统",
    openim: "OpenIM",
    filehelper: "文件助手",
  }[kind] || kind;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch] || ch));
}

export function formatBytes(size?: number): string {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
