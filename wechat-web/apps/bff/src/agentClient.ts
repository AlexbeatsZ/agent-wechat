import { readTokenFile, type AppConfig } from "./config.js";
import { HttpError, type AgentChat, type AgentClient, type AgentMedia, type AgentMessage, type AgentSendResult } from "./types.js";

export class RealAgentClient implements AgentClient {
  constructor(private config: AppConfig) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let token: string;
    try {
      token = readTokenFile(this.config.tokenFile);
    } catch {
      throw new HttpError(500, "agent-wechat token file is missing or unreadable", "TOKEN_MISSING");
    }

    let response: Response;
    try {
      response = await fetch(`${this.config.agentBaseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(init?.headers || {})
        }
      });
    } catch {
      throw new HttpError(502, "agent-wechat is unreachable", "AGENT_UNREACHABLE");
    }

    if (response.status === 401) {
      throw new HttpError(401, "agent-wechat rejected the token", "AGENT_UNAUTHORIZED");
    }
    if (!response.ok) {
      const text = await response.text();
      throw new HttpError(response.status, text || response.statusText, "AGENT_ERROR");
    }
    return response.json() as Promise<T>;
  }

  authStatus(): Promise<unknown> {
    return this.request("/api/status/auth");
  }

  listChats(limit: number, offset: number): Promise<AgentChat[]> {
    return this.request(`/api/chats?limit=${limit}&offset=${offset}`);
  }

  listMessages(chatId: string, limit: number, offset: number): Promise<AgentMessage[]> {
    return this.request(`/api/messages/${encodeURIComponent(chatId)}?limit=${limit}&offset=${offset}`);
  }

  getMedia(chatId: string, localId: string): Promise<AgentMedia> {
    return this.request(`/api/messages/${encodeURIComponent(chatId)}/media/${encodeURIComponent(localId)}`);
  }

  sendMessage(chatId: string, text: string): Promise<AgentSendResult> {
    return this.request("/api/messages/send", {
      method: "POST",
      body: JSON.stringify({ chatId, text })
    });
  }

  screenshot(): Promise<unknown> {
    return this.request("/api/debug/screenshot");
  }

  a11y(): Promise<unknown> {
    return this.request("/api/debug/a11y");
  }
}
