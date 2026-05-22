import type { AgentChat, AgentMessage } from "./types.js";

type MessageType = "text" | "image" | "file" | "voice" | "video" | "system" | "unknown";

export function normalizeChat(chat: AgentChat) {
  const id = chat.username || chat.id;
  return {
    id,
    displayName: chat.remark || chat.name || id,
    avatarUrl: null,
    lastMessagePreview: chat.lastMessagePreview,
    lastMessageTime: chat.lastActivityAt,
    unreadCount: Number(chat.unreadCount || 0),
    isGroup: Boolean(chat.isGroup),
    raw: chat
  };
}

export function isRegularChat(chat: AgentChat): boolean {
  const id = chat.username || chat.id;
  return Boolean(id) && !id.startsWith("gh_") && id !== "brandsessionholder";
}

export function mapMessageType(type: number): MessageType {
  const base = type >>> 0;
  if (base === 10000 || base === 10002) return "system";
  if (base === 1) return "text";
  if (base === 3 || base === 47) return "image";
  if (base === 34) return "voice";
  if (base === 43) return "video";
  if (base === 49) {
    const sub = Math.floor(type / 0x100000000);
    if (sub === 6) return "file";
    if (sub === 4 || sub === 43) return "video";
    if (sub === 3 || sub === 5 || sub === 57) return "text";
  }
  return "unknown";
}

function mapMessageWithContent(message: AgentMessage): MessageType {
  const mapped = mapMessageType(message.type);
  if (mapped !== "unknown") return mapped;
  if (message.type !== 49) return mapped;

  const content = message.content || "";
  if (/<appattach\b/i.test(content) || /<type>\s*6\s*<\/type>/i.test(content)) return "file";
  if (/\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|txt|csv)$/i.test(content.trim())) return "file";
  if (/<type>\s*(3|5|57)\s*<\/type>/i.test(content)) return "text";
  return "text";
}

function extractFileName(content: string): string | undefined {
  const title = content.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1];
  const xmlTitle = title || content.match(/<title>(.*?)<\/title>/)?.[1];
  if (xmlTitle) return xmlTitle;
  const plain = content.trim();
  return plain && !plain.startsWith("<") ? plain : undefined;
}

function extractFileSize(content: string): number | undefined {
  const match = content.match(/<totallen>(\d+)<\/totallen>/);
  return match ? Number(match[1]) : undefined;
}

export function normalizeMessage(message: AgentMessage) {
  const type = mapMessageWithContent(message);
  const id = String(message.serverId || message.localId);
  return {
    id,
    localId: message.localId,
    chatId: message.chatId,
    senderName: message.senderName,
    senderId: message.sender,
    direction: message.isSelf === true ? "out" : message.isSelf === false ? "in" : "unknown",
    type,
    text: type === "text" || type === "system" || type === "unknown" ? message.content : undefined,
    timestamp: message.timestamp,
    mediaLocalId: type === "image" || type === "file" || type === "voice" || type === "video" ? String(message.localId) : undefined,
    fileName: type === "file" ? extractFileName(message.content) : undefined,
    fileSize: type === "file" ? extractFileSize(message.content) : undefined,
    raw: message
  };
}
