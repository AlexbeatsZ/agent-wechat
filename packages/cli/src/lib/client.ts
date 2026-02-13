import WebSocket from "ws";
import type { LoginSubscriptionEvent } from "@thisnick/agent-wechat-shared";

export interface SubscriptionClientOptions {
  url: string;
  token?: string;
  sessionId?: string;
}

function normalizeUrl(base: string): string {
  const url = base.startsWith("http") ? base : `http://${base}`;
  return url.replace(/\/$/, "");
}

function qs(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null);
  if (entries.length === 0) return "";
  return "?" + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
}

// Subscription client interface for WebSocket-based subscriptions
export interface SubscriptionClient {
  status: {
    loginSubscription: {
      subscribe: (
        input: { timeoutMs?: number; newAccount?: boolean },
        callbacks: {
          onData: (event: LoginSubscriptionEvent) => void;
          onError?: (err: Error) => void;
          onComplete?: () => void;
        }
      ) => { unsubscribe: () => void };
    };
  };
}

export interface SubscriptionClientResult {
  client: SubscriptionClient;
  close: () => void;
}

/**
 * Create a WebSocket-capable client for login subscriptions.
 * The REST client is in @thisnick/agent-wechat-shared (WeChatClient).
 */
export function createSubscriptionClient(options: SubscriptionClientOptions): SubscriptionClientResult {
  const base = normalizeUrl(options.url);
  const wsUrl = base.replace(/^http/, "ws");

  let activeWs: WebSocket | null = null;

  const client: SubscriptionClient = {
    status: {
      loginSubscription: {
        subscribe: (input, callbacks) => {
          const params = qs({ timeoutMs: input.timeoutMs, newAccount: input.newAccount });
          const ws = new WebSocket(`${wsUrl}/api/ws/login${params}`);
          activeWs = ws;

          ws.on("message", (data: Buffer) => {
            try {
              const event = JSON.parse(data.toString()) as LoginSubscriptionEvent;
              callbacks.onData(event);
            } catch (e) {
              callbacks.onError?.(e instanceof Error ? e : new Error(String(e)));
            }
          });

          ws.on("error", (err: Error) => {
            callbacks.onError?.(err);
          });

          ws.on("close", () => {
            callbacks.onComplete?.();
          });

          return {
            unsubscribe: () => {
              ws.close();
              activeWs = null;
            },
          };
        },
      },
    },
  };

  return {
    client,
    close: () => {
      activeWs?.close();
      activeWs = null;
    },
  };
}
