import type { ChatDto, MessageDto, SendResponse, SessionDto, StatusDto } from "@wechat-web/shared";

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
  chats: () => request<ChatDto[]>("/api/chats?limit=80&offset=0"),
  messages: (chatId: string) => request<MessageDto[]>(`/api/chats/${encodeURIComponent(chatId)}/messages?limit=80&offset=0`),
  send: (chatId: string, text: string) => request<SendResponse>(`/api/chats/${encodeURIComponent(chatId)}/send`, { method: "POST", body: JSON.stringify({ text }) }),
  mediaUrl: (chatId: string, localId: string) => `/api/chats/${encodeURIComponent(chatId)}/media/${encodeURIComponent(localId)}`
};
