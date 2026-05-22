import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import { isRegularChat, normalizeChat, normalizeMessage } from "./normalize.js";
import { RealAgentClient } from "./agentClient.js";
import { MockAgentClient } from "./mockClient.js";
import { HttpError, type AgentClient } from "./types.js";
import type { AppConfig } from "./config.js";

const SESSION_COOKIE = "wechat_web_sid";
const sendRequestSchema = z.object({ text: z.string().trim().min(1).max(5000) });

export interface BuildAppOptions {
  config: AppConfig;
  agent?: AgentClient;
}

function publicError(error: unknown): { statusCode: number; body: { error: string; code: string } } {
  if (error instanceof HttpError) {
    return { statusCode: error.statusCode, body: { error: error.message, code: error.code } };
  }
  return { statusCode: 500, body: { error: "internal server error", code: "INTERNAL_ERROR" } };
}

function mediaContentType(mediaType: string | undefined, format: string | undefined): string {
  if (format?.includes("/")) return format;
  if (mediaType === "image") return format ? `image/${format}` : "image/png";
  if (mediaType === "voice") return "audio/mpeg";
  if (mediaType === "video") return "video/mp4";
  return "application/octet-stream";
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const sessions = new Set<string>();
  const config = options.config;
  const agent = options.agent || (config.mock ? new MockAgentClient() : new RealAgentClient(config));

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
      const raw = (await agent.authStatus()) as { status?: string; loggedInUser?: string };
      const status = raw.status || "unknown";
      return {
        agentReachable: true,
        loggedIn: status === "logged_in",
        status,
        loggedInUser: raw.loggedInUser,
        checkedAt
      };
    } catch (error) {
      const mapped = publicError(error);
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

  app.get("/api/chats", async (request, reply) => {
    try {
      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(Number(query.limit || 50), 200);
      const offset = Math.max(Number(query.offset || 0), 0);
      const chats = await agent.listChats(limit, offset);
      return chats.filter(isRegularChat).map(normalizeChat);
    } catch (error) {
      const mapped = publicError(error);
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
      return messages.map(normalizeMessage);
    } catch (error) {
      const mapped = publicError(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  app.get("/api/chats/:chatId/media/:localId", async (request, reply) => {
    try {
      const params = request.params as { chatId: string; localId: string };
      const media = await agent.getMedia(params.chatId, params.localId);
      if (media.url) {
        return reply.redirect(media.url);
      }
      if (!media.data) {
        return reply.code(404).send({ error: "media is not available", code: "MEDIA_NOT_AVAILABLE" });
      }
      const buffer = Buffer.from(media.data, "base64");
      const filename = media.filename || `${params.localId}`;
      reply.header("Content-Type", mediaContentType(media.type, media.format));
      reply.header("Content-Disposition", `inline; filename="${encodeURIComponent(filename)}"`);
      return reply.send(buffer);
    } catch (error) {
      const mapped = publicError(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  app.post("/api/chats/:chatId/send", async (request, reply) => {
    const parsed = sendRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, status: "failed", error: "text is required" });
    }

    try {
      const params = request.params as { chatId: string };
      const raw = await agent.sendMessage(params.chatId, parsed.data.text);
      if (!raw.success) {
        return { ok: false, status: "failed", error: raw.error || "send failed", raw };
      }
      const latest = await agent.listMessages(params.chatId, 20, 0);
      const confirmed = latest.some((message) => message.isSelf && message.content === parsed.data.text);
      return { ok: confirmed, status: confirmed ? "sent" : "uncertain", raw };
    } catch (error) {
      const mapped = publicError(error);
      return reply.code(mapped.statusCode).send({ ok: false, status: "failed", error: mapped.body.error });
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
