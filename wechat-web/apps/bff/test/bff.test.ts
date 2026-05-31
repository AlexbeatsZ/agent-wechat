import { describe, expect, it } from "vitest";
import path from "node:path";
import { buildApp } from "../src/app.js";
import { HttpError, type AgentClient } from "../src/types.js";
import { loadConfig, type AppConfig } from "../src/config.js";

const config: AppConfig = {
  agentBaseUrl: "http://127.0.0.1:6174",
  tokenFile: "token",
  mock: false,
  debugApi: false,
  cookieSecret: "test-secret",
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent"
};

function agent(overrides: Partial<AgentClient> = {}): AgentClient {
  return {
    authStatus: async () => ({ status: "logged_in", loggedInUser: "Tester" }),
    loginEvents: async function* () {
      yield { type: "status", message: "login" };
      yield { type: "login_success", userId: "Tester" };
    },
    listChats: async () => [{ id: "a", username: "a", name: "Alice", lastMessagePreview: "hi", unreadCount: 1, isGroup: false }],
    openChat: async () => ({ ok: true }),
    listMessages: async () => [{ localId: 1, serverId: 2, chatId: "a", sender: "a", senderName: "Alice", type: 1, content: "hi", timestamp: "2026-01-01T00:00:00.000Z", isSelf: false }],
    getMedia: async () => ({ type: "image", format: "image/png", filename: "a.png", data: Buffer.from("png").toString("base64") }),
    sendMessage: async () => ({ success: true }),
    listFiles: async () => [{ id: "f1", filename: "报告.pdf", size: 3, modifiedAt: "2026-01-01T00:00:00.000Z", sourcePathHint: "msg/file/报告.pdf", contentType: "application/pdf" }],
    downloadFile: async () => ({ file: { id: "f1", filename: "报告.pdf", size: 3, modifiedAt: "2026-01-01T00:00:00.000Z", sourcePathHint: "msg/file/报告.pdf", contentType: "application/pdf" }, data: Buffer.from("pdf").toString("base64") }),
    deleteFile: async () => ({ ok: true }),
    screenshot: async () => ({}),
    a11y: async () => ({}),
    ...overrides
  };
}

describe("BFF", () => {
  it("finds the project-local wx token from the bff workspace", () => {
    const oldCwd = process.cwd();
    const oldTokenFile = process.env.AGENT_WECHAT_TOKEN_FILE;
    try {
      delete process.env.AGENT_WECHAT_TOKEN_FILE;
      process.chdir(path.resolve(oldCwd, "..", "..", "apps", "bff"));
      expect(loadConfig().tokenFile).toContain(".agent-wechat-home");
      expect(loadConfig().tokenFile).toContain("token");
    } finally {
      process.chdir(oldCwd);
      if (oldTokenFile === undefined) delete process.env.AGENT_WECHAT_TOKEN_FILE;
      else process.env.AGENT_WECHAT_TOKEN_FILE = oldTokenFile;
    }
  });

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
    expect((await app.inject({ method: "GET", url: "/api/chats" })).json()[0]).toMatchObject({ id: "a", displayName: "Alice", unreadCount: 1, kind: "individual" });
    const messages = (await app.inject({ method: "GET", url: "/api/chats/a/messages" })).json();
    expect(messages[0]).toMatchObject({ type: "text", direction: "in", text: "hi" });
    expect(messages[1]).toMatchObject({ type: "system", text: "system notice" });
  });

  it("keeps official account chats and maps simple type 49 files", async () => {
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
    expect(chats).toHaveLength(2);
    expect(chats[0]).toMatchObject({ id: "gh_demo", kind: "official" });
    expect(chats[1]).toMatchObject({ id: "filehelper" });
    expect((await app.inject({ method: "GET", url: "/api/chats/filehelper/messages" })).json()[0]).toMatchObject({ type: "file", fileName: "第22  气相色谱法.pdf" });
  });

  it("falls back to session summary when service account message tables are unavailable", async () => {
    const app = await buildApp({
      config,
      agent: agent({
        listChats: async () => [{ id: "ww_notice@qy_u", username: "ww_notice@qy_u", name: "ww_notice@qy_u", lastMessagePreview: "【评教提醒】", lastActivityAt: "2026-01-01T00:00:00.000Z" }],
        listMessages: async () => []
      })
    });
    const messages = (await app.inject({ method: "GET", url: "/api/chats/ww_notice%40qy_u/messages" })).json();
    expect(messages[0]).toMatchObject({ type: "text", text: "【评教提醒】" });
  });

  it("converts media to bytes", async () => {
    const app = await buildApp({ config, agent: agent() });
    const res = await app.inject({ method: "GET", url: "/api/chats/a/media/1" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.headers["content-disposition"]).toContain("inline");
    expect(res.body).toBe("png");
  });

  it("returns file media as an attachment with utf-8 filename", async () => {
    const app = await buildApp({
      config,
      agent: agent({
        getMedia: async () => ({ type: "file", format: "pdf", filename: "报告.pdf", data: Buffer.from("pdf").toString("base64") })
      })
    });
    const res = await app.inject({ method: "GET", url: "/api/chats/a/media/1" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain("filename*=UTF-8''");
    expect(res.body).toBe("pdf");
  });

  it("maps pending media to an explicit retryable response", async () => {
    const app = await buildApp({
      config,
      agent: agent({
        getMedia: async () => ({ type: "pending", format: "", filename: "" })
      })
    });
    const res = await app.inject({ method: "GET", url: "/api/chats/a/media/1" });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ code: "MEDIA_PENDING" });
  });

  it("lists cached server files and downloads by safe id", async () => {
    const app = await buildApp({ config, agent: agent() });
    const list = await app.inject({ method: "GET", url: "/api/files?type=all" });
    expect(list.statusCode).toBe(200);
    expect(list.json()[0]).toMatchObject({ id: "f1", filename: "报告.pdf" });

    const download = await app.inject({ method: "GET", url: "/api/files/download?id=f1" });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("application/pdf");
    expect(download.headers["content-disposition"]).toContain("filename*=UTF-8''");
    expect(download.body).toBe("pdf");

    const pathDownload = await app.inject({ method: "GET", url: `/api/files/${encodeURIComponent("f1")}/download` });
    expect(pathDownload.statusCode).toBe(200);
    expect(pathDownload.headers["content-type"]).toContain("application/pdf");
  });

  it("deletes cached server files by id", async () => {
    const app = await buildApp({ config, agent: agent() });
    const res = await app.inject({ method: "DELETE", url: "/api/files?id=f1" });
    expect(res.json()).toMatchObject({ ok: true });
  });

  it("passes image and file payloads through send", async () => {
    const seen: unknown[] = [];
    const app = await buildApp({
      config,
      agent: agent({
        sendMessage: async (_chatId, payload) => {
          seen.push(payload);
          return { success: true };
        }
      })
    });
    expect((await app.inject({ method: "POST", url: "/api/chats/a/send", payload: { image: { data: "aGVsbG8=", mimeType: "image/png" } } })).json()).toMatchObject({ ok: true, status: "sent" });
    expect((await app.inject({ method: "POST", url: "/api/chats/a/send", payload: { file: { data: "aGVsbG8=", filename: "a.txt" } } })).json()).toMatchObject({ ok: true, status: "sent" });
    expect(seen).toEqual([{ image: { data: "aGVsbG8=", mimeType: "image/png" } }, { file: { data: "aGVsbG8=", filename: "a.txt" } }]);
  });

  it("rejects sending to official and service conversations with a readable error", async () => {
    const app = await buildApp({
      config,
      agent: agent({
        listChats: async () => [{ id: "gh_demo", username: "gh_demo", name: "Official" }]
      })
    });
    const res = await app.inject({ method: "POST", url: "/api/chats/gh_demo/send", payload: { text: "hello" } });
    expect(res.json()).toMatchObject({ ok: false, status: "failed", error: "当前会话不支持发送" });
  });

  it("reports uncertain send when latest message does not confirm text", async () => {
    const app = await buildApp({ config, agent: agent() });
    const res = await app.inject({ method: "POST", url: "/api/chats/a/send", payload: { text: "new text" } });
    expect(res.json()).toMatchObject({ ok: true, status: "sent" });
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

  it("streams wechat login events without exposing the agent token", async () => {
    const app = await buildApp({ config, agent: agent() });
    const res = await app.inject({ method: "GET", url: "/api/wechat-login/events?timeoutMs=10000" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain('"type":"status"');
    expect(res.body).toContain('"type":"login_success"');
  });
});
