import { readTokenFile, type AppConfig } from "./config.js";
import { randomBytes } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { HttpError, type AgentChat, type AgentClient, type AgentFileDownload, type AgentLoginOptions, type AgentMedia, type AgentMessage, type AgentSendPayload, type AgentSendResult, type AgentServerFile } from "./types.js";

type QueueItem = { value?: unknown; error?: Error; done?: boolean };

function websocketPath(path: string, baseUrl: string): URL {
  return new URL(path, baseUrl);
}

function parseWebSocketFrames(buffer: Buffer): { messages: string[]; rest: Buffer; closed: boolean } {
  const messages: string[] = [];
  let offset = 0;
  let closed = false;

  while (buffer.length - offset >= 2) {
    const byte1 = buffer[offset]!;
    const byte2 = buffer[offset + 1]!;
    const opcode = byte1 & 0x0f;
    const masked = (byte2 & 0x80) !== 0;
    let length = byte2 & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) break;
      const high = buffer.readUInt32BE(offset + 2);
      const low = buffer.readUInt32BE(offset + 6);
      if (high !== 0) throw new Error("websocket frame is too large");
      length = low;
      headerLength = 10;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (buffer.length - offset < frameLength) break;

    let payload = Buffer.from(buffer.subarray(offset + headerLength + maskLength, offset + frameLength));
    if (masked) {
      const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
      payload = payload.map((byte, index) => byte ^ mask[index % 4]!);
    }

    if (opcode === 1) messages.push(payload.toString("utf8"));
    if (opcode === 8) closed = true;
    offset += frameLength;
  }

  return { messages, rest: buffer.subarray(offset), closed };
}

async function* connectLoginWebSocket(url: URL, token: string): AsyncIterable<unknown> {
  const queue: QueueItem[] = [];
  let wake: (() => void) | undefined;
  let socket: import("node:net").Socket | undefined;
  let frameBuffer = Buffer.alloc(0);

  function push(item: QueueItem) {
    queue.push(item);
    wake?.();
    wake = undefined;
  }

  const transport = url.protocol === "https:" ? https : http;
  const key = randomBytes(16).toString("base64");
  const request = transport.request({
    method: "GET",
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    headers: {
      Authorization: `Bearer ${token}`,
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Key": key,
      "Sec-WebSocket-Version": "13"
    }
  });

  request.on("upgrade", (response, upgradedSocket) => {
    if (response.statusCode !== 101) {
      upgradedSocket.destroy();
      push({ error: new Error(`agent login websocket rejected upgrade (${response.statusCode})`) });
      return;
    }
    socket = upgradedSocket;
    socket.on("data", (chunk) => {
      try {
        frameBuffer = Buffer.concat([frameBuffer, chunk]);
        const parsed = parseWebSocketFrames(frameBuffer);
        frameBuffer = parsed.rest;
        for (const message of parsed.messages) {
          push({ value: JSON.parse(message) });
        }
        if (parsed.closed) push({ done: true });
      } catch (error) {
        push({ error: error instanceof Error ? error : new Error(String(error)) });
      }
    });
    socket.on("error", (error) => push({ error }));
    socket.on("close", () => push({ done: true }));
  });
  request.on("response", (response) => {
    push({ error: new Error(`agent login websocket failed (${response.statusCode})`) });
    response.resume();
  });
  request.on("error", (error) => push({ error }));
  request.end();

  try {
    while (true) {
      if (!queue.length) await new Promise<void>((resolve) => { wake = resolve; });
      const item = queue.shift();
      if (!item) continue;
      if (item.error) throw item.error;
      if (item.done) break;
      yield item.value;
    }
  } finally {
    request.destroy();
    socket?.destroy();
  }
}

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

  loginEvents(options: AgentLoginOptions): AsyncIterable<unknown> {
    let token: string;
    try {
      token = readTokenFile(this.config.tokenFile);
    } catch {
      throw new HttpError(500, "agent-wechat token file is missing or unreadable", "TOKEN_MISSING");
    }

    const params = new URLSearchParams({
      timeoutMs: String(options.timeoutMs),
      newAccount: options.newAccount ? "true" : "false"
    });
    const url = websocketPath(`/api/ws/login?${params.toString()}`, this.config.agentBaseUrl);
    return connectLoginWebSocket(url, token);
  }

  listChats(limit: number, offset: number): Promise<AgentChat[]> {
    return this.request(`/api/chats?limit=${limit}&offset=${offset}`);
  }

  openChat(chatId: string, clearUnreads: boolean): Promise<unknown> {
    return this.request(`/api/chats/${encodeURIComponent(chatId)}/open?clearUnreads=${clearUnreads ? "true" : "false"}`, {
      method: "POST"
    });
  }

  listMessages(chatId: string, limit: number, offset: number): Promise<AgentMessage[]> {
    return this.request(`/api/messages/${encodeURIComponent(chatId)}?limit=${limit}&offset=${offset}`);
  }

  getMedia(chatId: string, localId: string): Promise<AgentMedia> {
    return this.request(`/api/messages/${encodeURIComponent(chatId)}/media/${encodeURIComponent(localId)}`);
  }

  sendMessage(chatId: string, payload: AgentSendPayload): Promise<AgentSendResult> {
    return this.request("/api/messages/send", {
      method: "POST",
      body: JSON.stringify({ chatId, ...payload })
    });
  }

  listFiles(limit: number, offset: number, type: string): Promise<AgentServerFile[]> {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset), type });
    return this.request(`/api/files?${params.toString()}`);
  }

  downloadFile(id: string): Promise<AgentFileDownload> {
    return this.request(`/api/files/download?id=${encodeURIComponent(id)}`);
  }

  deleteFile(id: string): Promise<{ ok: boolean; error?: string }> {
    return this.request(`/api/files/delete?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  screenshot(): Promise<unknown> {
    return this.request("/api/debug/screenshot");
  }

  a11y(): Promise<unknown> {
    return this.request("/api/debug/a11y");
  }
}
