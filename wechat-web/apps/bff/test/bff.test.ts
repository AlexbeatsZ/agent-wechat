import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { HttpError, type AgentClient } from "../src/types.js";
import type { AppConfig } from "../src/config.js";

const config: AppConfig = {
  agentBaseUrl: "http://127.0.0.1:6174",
  tokenFile: "token",
  mock: false,
  debugApi: false,
  cookieSecret: "test-secret",
  host: "127.0.0.1",
  port: 0
};

function agent(overrides: Partial<AgentClient> = {}): AgentClient {
  return {
    authStatus: async () => ({ status: "logged_in", loggedInUser: "Tester" }),
    listChats: async () => [{ id: "a", username: "a", name: "Alice", lastMessagePreview: "hi", unreadCount: 1, isGroup: false }],
    listMessages: async () => [{ localId: 1, serverId: 2, chatId: "a", sender: "a", senderName: "Alice", type: 1, content: "hi", timestamp: "2026-01-01T00:00:00.000Z", isSelf: false }],
    getMedia: async () => ({ type: "image", format: "image/png", filename: "a.png", data: Buffer.from("png").toString("base64") }),
    sendMessage: async () => ({ success: true }),
    screenshot: async () => ({}),
    a11y: async () => ({}),
    ...overrides
  };
}

describe("BFF", () => {
  it("returns status", async () => {
    const app = await buildApp({ config, agent: agent() });
    const res = await app.inject({ method: "GET", url: "/api/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ agentReachable: true, loggedIn: true, loggedInUser: "Tester" });
  });

  it("normalizes chats and messages", async () => {
    const app = await buildApp({
      config,
      agent: agent({
        listMessages: async () => [
          { localId: 1, serverId: 2, chatId: "a", sender: "a", senderName: "Alice", type: 1, content: "hi", timestamp: "2026-01-01T00:00:00.000Z", isSelf: false },
          { localId: 2, serverId: 3, chatId: "a", type: 10000, content: "system notice", timestamp: "2026-01-01T00:00:00.000Z" }
        ]
      })
    });
    expect((await app.inject({ method: "GET", url: "/api/chats" })).json()[0]).toMatchObject({ id: "a", displayName: "Alice", unreadCount: 1 });
    const messages = (await app.inject({ method: "GET", url: "/api/chats/a/messages" })).json();
    expect(messages[0]).toMatchObject({ type: "text", direction: "in", text: "hi" });
    expect(messages[1]).toMatchObject({ type: "system", text: "system notice" });
  });

  it("filters official account chats and maps simple type 49 files", async () => {
    const app = await buildApp({
      config,
      agent: agent({
        listChats: async () => [
          { id: "gh_demo", username: "gh_demo", name: "Official" },
          { id: "brandsessionholder", username: "brandsessionholder", name: "Subscriptions" },
          { id: "filehelper", username: "filehelper", name: "文件传输助手" }
        ],
        listMessages: async () => [{ localId: 1, chatId: "filehelper", sender: "me", senderName: "Me", type: 49, content: "第22  气相色谱法.pdf", timestamp: "2026-01-01T00:00:00.000Z", isSelf: true }]
      })
    });
    const chats = (await app.inject({ method: "GET", url: "/api/chats" })).json();
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ id: "filehelper" });
    expect((await app.inject({ method: "GET", url: "/api/chats/filehelper/messages" })).json()[0]).toMatchObject({ type: "file", fileName: "第22  气相色谱法.pdf" });
  });

  it("converts media to bytes", async () => {
    const app = await buildApp({ config, agent: agent() });
    const res = await app.inject({ method: "GET", url: "/api/chats/a/media/1" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.body).toBe("png");
  });

  it("reports uncertain send when latest message does not confirm text", async () => {
    const app = await buildApp({ config, agent: agent() });
    const res = await app.inject({ method: "POST", url: "/api/chats/a/send", payload: { text: "new text" } });
    expect(res.json()).toMatchObject({ ok: false, status: "uncertain" });
  });

  it("confirms send when latest message contains outgoing text", async () => {
    const app = await buildApp({
      config,
      agent: agent({
        listMessages: async () => [{ localId: 2, serverId: 3, chatId: "a", sender: "me", senderName: "Me", type: 1, content: "new text", timestamp: "2026-01-01T00:00:00.000Z", isSelf: true }]
      })
    });
    const res = await app.inject({ method: "POST", url: "/api/chats/a/send", payload: { text: "new text" } });
    expect(res.json()).toMatchObject({ ok: true, status: "sent" });
  });

  it("returns hidden debug API by default", async () => {
    const app = await buildApp({ config, agent: agent() });
    const res = await app.inject({ method: "GET", url: "/api/a11y" });
    expect(res.statusCode).toBe(404);
  });

  it("maps token and agent failures to visible status errors", async () => {
    const app = await buildApp({ config, agent: agent({ authStatus: async () => { throw new HttpError(500, "agent-wechat token file is missing or unreadable", "TOKEN_MISSING"); } }) });
    const res = await app.inject({ method: "GET", url: "/api/status" });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toContain("token file");
  });
});
