export type WeChatConfig = {
  enabled?: boolean;
  serverUrl: string;
  dmPolicy?: "allowlist" | "open" | "disabled";
  allowFrom?: string[];
  groupPolicy?: "open" | "disabled" | "allowlist";
  groupAllowFrom?: string[];
  groups?: Record<
    string,
    {
      requireMention?: boolean;
    }
  >;
  pollIntervalMs?: number;
  authPollIntervalMs?: number;
};

export type ResolvedWeChatAccount = {
  accountId: string;
  enabled: boolean;
  serverUrl: string;
  dmPolicy: string;
  allowFrom: string[];
  groupPolicy: string;
  groupAllowFrom: string[];
  groups: Record<string, { requireMention?: boolean }>;
  pollIntervalMs: number;
  authPollIntervalMs: number;
};

// Defaults
export const DEFAULT_POLL_INTERVAL_MS = 1000;
export const DEFAULT_AUTH_POLL_INTERVAL_MS = 30_000;
export const DEFAULT_ACCOUNT_ID = "default";

export function resolveWeChatAccount(
  cfg: Record<string, unknown>,
  accountId?: string,
): ResolvedWeChatAccount | null {
  const wechat = (cfg as { channels?: { wechat?: WeChatConfig } }).channels
    ?.wechat;
  if (!wechat?.serverUrl) return null;

  return {
    accountId: accountId ?? DEFAULT_ACCOUNT_ID,
    enabled: wechat.enabled !== false,
    serverUrl: wechat.serverUrl,
    dmPolicy: wechat.dmPolicy ?? "disabled",
    allowFrom: wechat.allowFrom ?? [],
    groupPolicy: wechat.groupPolicy ?? "disabled",
    groupAllowFrom: wechat.groupAllowFrom ?? [],
    groups: wechat.groups ?? {},
    pollIntervalMs: wechat.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    authPollIntervalMs:
      wechat.authPollIntervalMs ?? DEFAULT_AUTH_POLL_INTERVAL_MS,
  };
}
