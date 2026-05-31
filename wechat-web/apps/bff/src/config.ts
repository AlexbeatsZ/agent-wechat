import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export interface AppConfig {
  agentBaseUrl: string;
  tokenFile: string;
  mock: boolean;
  debugApi: boolean;
  simplePassword?: string;
  cookieSecret: string;
  host: string;
  port: number;
  logLevel: string;
}

function boolEnv(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function resolveTokenFile(value: string | undefined): string {
  if (value && value.trim()) {
    return path.resolve(value);
  }

  let current = process.cwd();
  while (true) {
    const candidate = path.join(current, ".agent-wechat-home", ".config", "agent-wechat", "token");
    if (fs.existsSync(candidate)) return candidate;

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return path.resolve(process.cwd(), "..", ".agent-wechat-home", ".config", "agent-wechat", "token");
}

export function loadConfig(): AppConfig {
  const simplePassword = process.env.BFF_SIMPLE_PASSWORD?.trim() || undefined;
  const cookieSecret =
    process.env.BFF_COOKIE_SECRET?.trim() ||
    (simplePassword ? randomBytes(32).toString("hex") : "wechat-web-dev-cookie-secret");

  return {
    agentBaseUrl: process.env.AGENT_WECHAT_BASE_URL?.trim() || "http://127.0.0.1:6174",
    tokenFile: resolveTokenFile(process.env.AGENT_WECHAT_TOKEN_FILE),
    mock: boolEnv(process.env.AGENT_WECHAT_MOCK),
    debugApi: boolEnv(process.env.ENABLE_DEBUG_API),
    simplePassword,
    cookieSecret,
    host: process.env.BFF_HOST?.trim() || "0.0.0.0",
    port: Number(process.env.BFF_PORT || 8787),
    logLevel: process.env.BFF_LOG_LEVEL?.trim() || "info"
  };
}

export function readTokenFile(tokenFile: string): string {
  const token = fs.readFileSync(tokenFile, "utf8").trim();
  if (!token) {
    throw new Error("agent-wechat token file is empty");
  }
  return token;
}
