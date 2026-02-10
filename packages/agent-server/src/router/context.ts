import { getDb, type DatabaseInstance } from "../db/index.js";
import type { CreateHTTPContextOptions } from "@trpc/server/adapters/standalone";
import type { CreateWSSContextFnOptions } from "@trpc/server/adapters/ws";
import type { Session } from "@thisnick/agent-wechat-shared";
import { getSession, getOrCreateDefaultSession } from "../sessions/manager.js";

export interface Context {
  db: DatabaseInstance;
  sessionId?: string;
  session?: Session;
  /** Fires when the HTTP request closes (client disconnect / Ctrl+C) */
  abortSignal: AbortSignal;
}

export async function createContext(
  opts: CreateHTTPContextOptions | CreateWSSContextFnOptions
): Promise<Context> {
  const db = getDb();

  // Extract session ID from header
  let sessionId: string | undefined;
  let session: Session | undefined;

  if ("req" in opts && opts.req) {
    const headerValue = opts.req.headers["x-session-id"];
    sessionId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  }

  // Look up session if ID provided, otherwise use default
  if (sessionId) {
    session = getSession(sessionId) ?? undefined;
  } else {
    // Use default session if no session specified
    try {
      session = await getOrCreateDefaultSession();
      sessionId = session.id;
    } catch {
      // Default session might not exist yet during initialization
    }
  }

  // Abort when client disconnects before response is sent (Ctrl+C)
  const abortController = new AbortController();
  if ("res" in opts && opts.res && "writableFinished" in opts.res) {
    const res = opts.res as import("http").ServerResponse;
    res.on("close", () => {
      if (!res.writableFinished) {
        abortController.abort();
      }
    });
  }

  return {
    db,
    sessionId,
    session,
    abortSignal: abortController.signal,
  };
}
