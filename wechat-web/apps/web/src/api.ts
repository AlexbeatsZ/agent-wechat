import type { ChatDto, MessageDto, SendResponse, ServerFileDto, SessionDto, StatusDto } from "@wechat-web/shared";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.error || response.statusText);
  }
  return data as T;
}

export const api = {
  session: () => request<SessionDto>("/api/session"),
  login: (password: string) => request<SessionDto>("/api/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request<SessionDto>("/api/logout", { method: "POST" }),
  status: () => request<StatusDto>("/api/status"),
  diagnostics: () => request<{ checkedAt: string; events: unknown[] }>("/api/diagnostics"),
  chats: () => request<ChatDto[]>("/api/chats?limit=80&offset=0"),
  openChat: (chatId: string, clearUnreads = true) => request<unknown>(`/api/chats/${encodeURIComponent(chatId)}/open?clearUnreads=${clearUnreads ? "true" : "false"}`, { method: "POST" }),
  messages: (chatId: string) => request<MessageDto[]>(`/api/chats/${encodeURIComponent(chatId)}/messages?limit=80&offset=0`),
  files: () => request<ServerFileDto[]>("/api/files?limit=100&offset=0&type=all"),
  fileDownloadUrl: (id: string) => `/api/files/${encodeURIComponent(id)}/download`,
  deleteFile: (id: string) => request<{ ok: boolean; error?: string }>(`/api/files?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  sendText: (chatId: string, text: string) => request<SendResponse>(`/api/chats/${encodeURIComponent(chatId)}/send`, { method: "POST", body: JSON.stringify({ text }) }),
  sendImage: (chatId: string, data: string, mimeType: string) => request<SendResponse>(`/api/chats/${encodeURIComponent(chatId)}/send`, { method: "POST", body: JSON.stringify({ image: { data, mimeType } }) }),
  sendFile: (chatId: string, data: string, filename: string) => request<SendResponse>(`/api/chats/${encodeURIComponent(chatId)}/send`, { method: "POST", body: JSON.stringify({ file: { data, filename } }) }),
  wechatLoginEventsUrl: (newAccount = false) => `/api/wechat-login/events?newAccount=${newAccount ? "true" : "false"}&timeoutMs=300000`,
  mediaUrl: (chatId: string, localId: string) => `/api/chats/${encodeURIComponent(chatId)}/media/${encodeURIComponent(localId)}`
};
