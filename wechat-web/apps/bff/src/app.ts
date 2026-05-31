import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import { classifyChat, isRegularChat, normalizeChat, normalizeMessage } from "./normalize.js";
import { RealAgentClient } from "./agentClient.js";
import { MockAgentClient } from "./mockClient.js";
import { HttpError, type AgentClient } from "./types.js";
import type { AppConfig } from "./config.js";

const SESSION_COOKIE = "wechat_web_sid";
const sendRequestSchema = z.object({
  text: z.string().trim().min(1).max(5000).optional(),
  image: z.object({
    data: z.string().min(1),
    mimeType: z.string().min(1)
  }).optional(),
  file: z.object({
    data: z.string().min(1),
    filename: z.string().min(1)
  }).optional()
}).refine((value) => Boolean(value.text || value.image || value.file));
const filesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  type: z.enum(["file", "image", "video", "all"]).optional()
});
const loginQuerySchema = z.object({
  newAccount: z.enum(["true", "false"]).optional(),
  timeoutMs: z.coerce.number().int().min(10_000).max(300_000).optional()
});

export interface BuildAppOptions {
  config: AppConfig;
  agent?: AgentClient;
}

type DiagnosticEvent = {
  id: string;
  at: string;
  operation: string;
  ok: boolean;
  detail?: unknown;
};

function publicError(error: unknown): { statusCode: number; body: { error: string; code: string } } {
  if (error instanceof HttpError) {
    return { statusCode: error.statusCode, body: { error: error.message, code: error.code } };
  }
  return { statusCode: 500, body: { error: "internal server error", code: "INTERNAL_ERROR" } };
}

function filenameContentType(filename: string | undefined): string | undefined {
  const lower = filename?.toLowerCase() || "";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  if (lower.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".zip")) return "application/zip";
  return undefined;
}

function mediaContentType(mediaType: string | undefined, format: string | undefined, filename?: string): string {
  if (format?.includes("/")) return format;
  const byFilename = filenameContentType(filename);
  if (byFilename) return byFilename;
  if (mediaType === "file") return "application/octet-stream";
  if (mediaType === "image") return format ? `image/${format}` : "image/png";
  if (mediaType === "voice") return "audio/mpeg";
  if (mediaType === "video") return "video/mp4";
  return "application/octet-stream";
}

function contentDisposition(filename: string, disposition: "inline" | "attachment"): string {
  const fallback = filename
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/[\\"]/g, "_")
    .trim() || "download";
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function readableSendError(error: string): string {
  if (error.includes("Unknown state")) return "微信窗口暂不可操作，请稍后重试";
  if (error === "NOT_LOGGED_IN") return "微信未登录";
  if (error.includes("No action selected")) return "未找到可执行的发送动作";
  return error;
}

function messageSortValue(timestamp: string | undefined): number {
  const parsed = Date.parse(timestamp || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const config = options.config;
  const app = Fastify({ logger: config.logLevel === "silent" ? false : { level: config.logLevel } });
  const sessions = new Set<string>();
  const agent = options.agent || (config.mock ? new MockAgentClient() : new RealAgentClient(config));
  const diagnostics: DiagnosticEvent[] = [];

  function recordDiagnostic(operation: string, ok: boolean, detail?: unknown) {
    const event = { id: nanoid(10), at: new Date().toISOString(), operation, ok, detail };
    diagnostics.push(event);
    if (diagnostics.length > 100) diagnostics.splice(0, diagnostics.length - 100);
    const logPayload = { operation, ok, detail };
    if (ok) app.log.info(logPayload, "wechat-web operation");
    else app.log.warn(logPayload, "wechat-web operation failed");
  }

  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie, { secret: config.cookieSecret });

  function isAuthenticated(request: FastifyRequest): boolean {
    if (!config.simplePassword) return true;
    const sid = request.cookies[SESSION_COOKIE];
    return Boolean(sid && sessions.has(sid));
  }

  async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!isAuthenticated(request)) {
      await reply.code(401).send({ error: "password required", code: "PASSWORD_REQUIRED" });
    }
  }

  app.get("/api/session", async (request) => ({
    passwordEnabled: Boolean(config.simplePassword),
    authenticated: isAuthenticated(request)
  }));

  app.post("/api/login", async (request, reply) => {
    if (!config.simplePassword) {
      return { passwordEnabled: false, authenticated: true };
    }
    const body = request.body as { password?: string } | undefined;
    if (body?.password !== config.simplePassword) {
      return reply.code(401).send({ error: "invalid password", code: "INVALID_PASSWORD" });
    }
    const sid = nanoid(32);
    sessions.add(sid);
    reply.setCookie(SESSION_COOKIE, sid, { httpOnly: true, sameSite: "lax", path: "/" });
    return { passwordEnabled: true, authenticated: true };
  });

  app.post("/api/logout", async (request, reply) => {
    const sid = request.cookies[SESSION_COOKIE];
    if (sid) sessions.delete(sid);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { passwordEnabled: Boolean(config.simplePassword), authenticated: false };
  });

  app.addHook("preHandler", async (request, reply) => {
    if (request.url.startsWith("/api/") && !["/api/session", "/api/login", "/api/logout"].includes(request.url.split("?")[0] || "")) {
      await requireAuth(request, reply);
    }
  });

  app.get("/api/status", async (_request, reply) => {
    const checkedAt = new Date().toISOString();
    try {
      const raw = (await agent.authStatus()) as { status?: string; loggedInUser?: string; automationReady?: boolean; error?: string };
      const status = raw.status || "unknown";
      recordDiagnostic("status", true, { status, automationReady: raw.automationReady });
      return {
        agentReachable: true,
        loggedIn: status === "logged_in" || status === "ui_unavailable",
        status,
        loggedInUser: status === "logged_in" || status === "ui_unavailable" ? raw.loggedInUser : undefined,
        automationReady: raw.automationReady,
        checkedAt,
        error: status === "ui_unavailable" ? "微信窗口暂不可操作，自动化发送暂不可用" : raw.error
      };
    } catch (error) {
      const mapped = publicError(error);
      recordDiagnostic("status", false, mapped.body);
      reply.code(mapped.statusCode);
      return {
        agentReachable: mapped.body.code !== "AGENT_UNREACHABLE" ? false : false,
        loggedIn: false,
        status: "unknown",
        checkedAt,
        error: mapped.body.error
      };
    }
  });

  app.get("/api/diagnostics", async () => ({
    checkedAt: new Date().toISOString(),
    events: diagnostics.slice().reverse()
  }));

  app.get("/api/wechat-login/events", async (request, reply) => {
    const parsed = loginQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid login options", code: "INVALID_LOGIN_OPTIONS" });
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    reply.raw.write("\n");

    const writeEvent = (event: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      for await (const event of agent.loginEvents({
        newAccount: parsed.data.newAccount === "true",
        timeoutMs: parsed.data.timeoutMs || 300_000
      })) {
        writeEvent(event);
      }
      writeEvent({ type: "done" });
    } catch (error) {
      writeEvent({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      reply.raw.end();
    }
  });

  app.get("/api/chats", async (request, reply) => {
    try {
      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(Number(query.limit || 50), 200);
      const offset = Math.max(Number(query.offset || 0), 0);
      const chats = await agent.listChats(limit, offset);
      const normalized = chats.filter(isRegularChat).map(normalizeChat);
      recordDiagnostic("list_chats", true, { count: normalized.length, limit, offset });
      return normalized;
    } catch (error) {
      const mapped = publicError(error);
      recordDiagnostic("list_chats", false, mapped.body);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  app.get("/api/chats/:chatId/messages", async (request, reply) => {
    try {
      const params = request.params as { chatId: string };
      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(Number(query.limit || 50), 200);
      const offset = Math.max(Number(query.offset || 0), 0);
      const messages = await agent.listMessages(params.chatId, limit, offset);
      if (messages.length > 0) {
        const normalized = messages
          .map(normalizeMessage)
          .sort((a, b) => messageSortValue(a.timestamp) - messageSortValue(b.timestamp) || Number(a.localId || 0) - Number(b.localId || 0));
        recordDiagnostic("list_messages", true, { chatId: params.chatId, count: normalized.length, first: normalized[0]?.localId, last: normalized[normalized.length - 1]?.localId });
        return normalized;
      }

      const chats = await agent.listChats(200, 0);
      const chat = chats.find((item) => (item.username || item.id) === params.chatId);
      if (chat?.lastMessagePreview) {
        const fallback = [
          normalizeMessage({
            localId: chat.lastMsgLocalId || 0,
            serverId: 0,
            chatId: params.chatId,
            type: 1,
            content: chat.lastMessagePreview,
            timestamp: chat.lastActivityAt || new Date().toISOString(),
            isSelf: false
          })
        ];
        recordDiagnostic("list_messages", true, { chatId: params.chatId, count: fallback.length, fallback: "session_summary" });
        return fallback;
      }
      recordDiagnostic("list_messages", true, { chatId: params.chatId, count: 0 });
      return [];
    } catch (error) {
      const mapped = publicError(error);
      recordDiagnostic("list_messages", false, { chatId: (request.params as { chatId?: string }).chatId, ...mapped.body });
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  app.post("/api/chats/:chatId/open", async (request, reply) => {
    try {
      const params = request.params as { chatId: string };
      const query = request.query as { clearUnreads?: string } | undefined;
      const result = await agent.openChat(params.chatId, query?.clearUnreads !== "false");
      recordDiagnostic("open_chat", true, { chatId: params.chatId, clearUnreads: query?.clearUnreads !== "false", result });
      return result;
    } catch (error) {
      const mapped = publicError(error);
      recordDiagnostic("open_chat", false, { chatId: (request.params as { chatId?: string }).chatId, ...mapped.body });
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  app.get("/api/chats/:chatId/media/:localId", async (request, reply) => {
    try {
      const params = request.params as { chatId: string; localId: string };
      const message = (await agent.listMessages(params.chatId, 200, 0))
        .find((item) => String(item.localId) === params.localId);
      if (message) {
        const normalized = normalizeMessage(message);
        if (normalized.type === "file" && normalized.fileName) {
          const files = await agent.listFiles(200, 0, "file");
          const cached = files.find((file) =>
            file.filename === normalized.fileName && (!normalized.fileSize || file.size === normalized.fileSize)
          );
          if (cached) {
            request.log.info({ chatId: params.chatId, localId: params.localId, fileId: cached.id }, "serving media from cached server file");
            const download = await agent.downloadFile(cached.id);
            const buffer = Buffer.from(download.data, "base64");
            reply.header("Content-Type", download.file.contentType || "application/octet-stream");
            reply.header("Content-Length", String(buffer.length));
            reply.header("Content-Disposition", contentDisposition(normalized.fileName, "attachment"));
            recordDiagnostic("download_message_media", true, { chatId: params.chatId, localId: params.localId, source: "server_cache", fileId: cached.id, bytes: buffer.length });
            return reply.send(buffer);
          }
        }
      }
      const media = await agent.getMedia(params.chatId, params.localId);
      if (media.url) {
        return reply.redirect(media.url);
      }
      if (media.type === "pending") {
        recordDiagnostic("download_message_media", false, { chatId: params.chatId, localId: params.localId, code: "MEDIA_PENDING" });
        return reply.code(202).send({ error: "media is still downloading or not available locally", code: "MEDIA_PENDING" });
      }
      if (!media.data) {
        recordDiagnostic("download_message_media", false, { chatId: params.chatId, localId: params.localId, code: "MEDIA_NOT_AVAILABLE" });
        return reply.code(404).send({ error: "media is not available", code: "MEDIA_NOT_AVAILABLE" });
      }
      const buffer = Buffer.from(media.data, "base64");
      const filename = media.filename || `${params.localId}`;
      reply.header("Content-Type", mediaContentType(media.type, media.format, filename));
      reply.header("Content-Length", String(buffer.length));
      reply.header("Content-Disposition", contentDisposition(filename, media.type === "file" ? "attachment" : "inline"));
      recordDiagnostic("download_message_media", true, { chatId: params.chatId, localId: params.localId, source: "agent_media", bytes: buffer.length, type: media.type });
      return reply.send(buffer);
    } catch (error) {
      const mapped = publicError(error);
      recordDiagnostic("download_message_media", false, { chatId: (request.params as { chatId?: string }).chatId, localId: (request.params as { localId?: string }).localId, ...mapped.body });
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  app.get("/api/files", async (request, reply) => {
    const parsed = filesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid files query", code: "INVALID_FILES_QUERY" });
    }
    try {
      const files = await agent.listFiles(parsed.data.limit || 100, parsed.data.offset || 0, parsed.data.type || "file");
      recordDiagnostic("list_files", true, { count: files.length, type: parsed.data.type || "file" });
      return files;
    } catch (error) {
      const mapped = publicError(error);
      recordDiagnostic("list_files", false, mapped.body);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  app.get("/api/files/download", async (request, reply) => {
    try {
      const params = request.query as { id?: string };
      if (!params.id) return reply.code(400).send({ error: "file id is required", code: "FILE_ID_REQUIRED" });
      const download = await agent.downloadFile(params.id);
      const buffer = Buffer.from(download.data, "base64");
      reply.header("Content-Type", download.file.contentType || "application/octet-stream");
      reply.header("Content-Length", String(buffer.length));
      reply.header("Content-Disposition", contentDisposition(download.file.filename || "download", "attachment"));
      recordDiagnostic("download_file", true, { id: params.id, filename: download.file.filename, bytes: buffer.length });
      return reply.send(buffer);
    } catch (error) {
      const mapped = publicError(error);
      recordDiagnostic("download_file", false, { id: (request.query as { id?: string }).id, ...mapped.body });
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  app.get("/api/files/:id/download", async (request, reply) => {
    try {
      const params = request.params as { id: string };
      const download = await agent.downloadFile(params.id);
      const buffer = Buffer.from(download.data, "base64");
      reply.header("Content-Type", download.file.contentType || filenameContentType(download.file.filename) || "application/octet-stream");
      reply.header("Content-Length", String(buffer.length));
      reply.header("Content-Disposition", contentDisposition(download.file.filename || "download", "attachment"));
      recordDiagnostic("download_file", true, { id: params.id, filename: download.file.filename, bytes: buffer.length, route: "path" });
      return reply.send(buffer);
    } catch (error) {
      const mapped = publicError(error);
      recordDiagnostic("download_file", false, { id: (request.params as { id?: string }).id, ...mapped.body, route: "path" });
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  app.delete("/api/files", async (request, reply) => {
    try {
      const params = request.query as { id?: string };
      if (!params.id) return reply.code(400).send({ ok: false, error: "file id is required" });
      const result = await agent.deleteFile(params.id);
      recordDiagnostic("delete_file", result.ok, { id: params.id, error: result.error });
      return result;
    } catch (error) {
      const mapped = publicError(error);
      recordDiagnostic("delete_file", false, { id: (request.query as { id?: string }).id, ...mapped.body });
      return reply.code(mapped.statusCode).send({ ok: false, error: mapped.body.error });
    }
  });

  app.post("/api/chats/:chatId/send", async (request, reply) => {
    const parsed = sendRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, status: "failed", error: "需要提供文本、图片或文件" });
    }

    try {
      const params = request.params as { chatId: string };
      const kind = classifyChat({ id: params.chatId, username: params.chatId });
      if (["official", "service", "system"].includes(kind)) {
        recordDiagnostic("send_message", false, { chatId: params.chatId, kind, error: "READ_ONLY_CHAT" });
        return { ok: false, status: "failed", error: "当前会话不支持发送", raw: { kind } };
      }
      const auth = (await agent.authStatus()) as { status?: string };
      if (auth.status && auth.status !== "logged_in" && auth.status !== "ui_unavailable") {
        recordDiagnostic("send_message", false, { chatId: params.chatId, kind, status: auth.status, error: "NOT_LOGGED_IN" });
        return { ok: false, status: "failed", error: "微信未登录", raw: { status: auth.status } };
      }
      const raw = await agent.sendMessage(params.chatId, parsed.data);
      if (!raw.success) {
        recordDiagnostic("send_message", false, { chatId: params.chatId, kind, payload: parsed.data.text ? "text" : parsed.data.image ? "image" : "file", error: raw.error });
        return { ok: false, status: "failed", error: readableSendError(raw.error || "send failed"), raw };
      }
      recordDiagnostic("send_message", true, { chatId: params.chatId, kind, payload: parsed.data.text ? "text" : parsed.data.image ? "image" : "file" });
      return { ok: true, status: "sent", raw };
    } catch (error) {
      const mapped = publicError(error);
      recordDiagnostic("send_message", false, { chatId: (request.params as { chatId?: string }).chatId, ...mapped.body });
      return reply.code(mapped.statusCode).send({ ok: false, status: "failed", error: readableSendError(mapped.body.error) });
    }
  });

  app.get("/api/screenshot", async (_request, reply) => {
    if (!config.debugApi) return reply.code(404).send({ error: "debug API is disabled", code: "DEBUG_DISABLED" });
    try {
      return await agent.screenshot();
    } catch (error) {
      const mapped = publicError(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  app.get("/api/a11y", async (_request, reply) => {
    if (!config.debugApi) return reply.code(404).send({ error: "debug API is disabled", code: "DEBUG_DISABLED" });
    try {
      return await agent.a11y();
    } catch (error) {
      const mapped = publicError(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  return app;
}
