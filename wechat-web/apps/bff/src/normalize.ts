import type { AgentChat, AgentMessage } from "./types.js";

type MessageType = "text" | "image" | "file" | "voice" | "video" | "system" | "unknown";
type ChatKind = "individual" | "group" | "official" | "service" | "openim" | "system";

export function classifyChat(chat: AgentChat): ChatKind {
  const id = chat.username || chat.id;
  const name = `${chat.remark || ""} ${chat.name || ""}`.toLowerCase();
  if (chat.kind && ["individual", "group", "official", "service", "openim", "system"].includes(chat.kind)) return chat.kind as ChatKind;
  if (id.endsWith("@chatroom")) return "group";
  if (id.includes("@openim")) return "openim";
  if (chat.localType === 0) return "service";
  if (id.startsWith("gh_")) return "official";
  if (
    id.startsWith("ww_") ||
    id.endsWith("@qy_u") ||
    id.endsWith("@app") ||
    [
      "exmail_tool",
      "fmessage",
      "floatbottle",
      "medianote",
      "mphelper",
      "newsapp",
      "notifymessage",
      "qqmail",
      "qqsync",
      "weixin",
      "weixingongzhong"
    ].includes(id)
  ) return "service";
  if (
    name.includes("服务通知") ||
    name.includes("服务号") ||
    name.includes("企业微信") ||
    name.includes("腾讯企业邮箱") ||
    name.includes("微信支付") ||
    name.includes("图文") ||
    name.includes("| 图文") ||
    name.includes("|图文")
  ) return "service";
  return "individual";
}

export function normalizeChat(chat: AgentChat) {
  const id = chat.username || chat.id;
  return {
    id,
    displayName: chat.remark || chat.name || id,
    avatarUrl: null,
    kind: classifyChat(chat),
    lastMessagePreview: chat.lastMessagePreview,
    lastMessageTime: chat.lastActivityAt,
    lastMsgLocalId: chat.lastMsgLocalId,
    unreadCount: Number(chat.unreadCount || 0),
    isGroup: Boolean(chat.isGroup),
    raw: chat
  };
}

export function isRegularChat(chat: AgentChat): boolean {
  const id = chat.username || chat.id;
  return Boolean(id) && id !== "brandsessionholder";
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

function cleanSystemText(content: string): string {
  const revoke = content.match(/<revokemsg>[\s\S]*?<content>([\s\S]*?)<\/content>[\s\S]*?<\/revokemsg>/)?.[1];
  if (revoke) return revoke;
  const sys = content.match(/<sysmsg[\s\S]*?<content>([\s\S]*?)<\/content>[\s\S]*?<\/sysmsg>/)?.[1];
  return sys || content;
}

export function normalizeMessage(message: AgentMessage) {
  const type = mapMessageWithContent(message);
  const id = String(message.serverId || message.localId);
  const inferredSelf = message.isSelf ?? (message.senderName === "我" || message.sender === "me" ? true : undefined);
  return {
    id,
    localId: message.localId,
    chatId: message.chatId,
    senderName: message.senderName,
    senderId: message.sender,
    direction: inferredSelf === true ? "out" : inferredSelf === false ? "in" : "unknown",
    type,
    text: type === "system" ? cleanSystemText(message.content) : type === "text" || type === "unknown" ? message.content : undefined,
    timestamp: message.timestamp,
    mediaLocalId: type === "image" || type === "file" || type === "voice" || type === "video" ? String(message.localId) : undefined,
    fileName: type === "file" ? extractFileName(message.content) : undefined,
    fileSize: type === "file" ? extractFileSize(message.content) : undefined,
    raw: message
  };
}
