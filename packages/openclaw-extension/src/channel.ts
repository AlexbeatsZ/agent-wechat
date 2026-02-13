import type { ChannelPlugin, ChannelMeta } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { ResolvedWeChatAccount } from "./types.js";
import { resolveWeChatAccount } from "./types.js";
import { startWeChatMonitor } from "./monitor.js";
import { wechatOnboardingAdapter } from "./onboarding.js";
import { collectWeChatStatusIssues } from "./status.js";
import { WeChatClient } from "@thisnick/agent-wechat-shared";

const meta: ChannelMeta = {
  id: "wechat",
  label: "WeChat",
  selectionLabel: "WeChat (微信)",
  blurb: "WeChat messaging via agent-wechat container.",
  aliases: ["weixin"],
  order: 80,
};

export const wechatPlugin: ChannelPlugin<ResolvedWeChatAccount> = {
  id: "wechat",
  meta,

  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    threads: false,
    media: true,
    reply: true,
  },

  reload: { configPrefixes: ["channels.wechat"] },

  configSchema: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        serverUrl: { type: "string" },
        dmPolicy: {
          type: "string",
          enum: ["open", "allowlist", "disabled"],
        },
        allowFrom: { type: "array", items: { type: "string" } },
        groupPolicy: {
          type: "string",
          enum: ["open", "allowlist", "disabled"],
        },
        groupAllowFrom: { type: "array", items: { type: "string" } },
        groups: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: {
              requireMention: { type: "boolean" },
            },
          },
        },
        pollIntervalMs: { type: "integer", minimum: 100 },
        authPollIntervalMs: { type: "integer", minimum: 1000 },
      },
    },
  },

  // ---- Config adapter ----
  config: {
    listAccountIds: (_cfg) => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg, accountId) => {
      const account = resolveWeChatAccount(
        cfg as unknown as Record<string, unknown>,
        accountId ?? undefined,
      );
      if (!account) {
        return {
          accountId: accountId ?? DEFAULT_ACCOUNT_ID,
          enabled: false,
          serverUrl: "",
          dmPolicy: "disabled",
          allowFrom: [],
          groupPolicy: "disabled",
          groupAllowFrom: [],
          groups: {},
          pollIntervalMs: 1000,
          authPollIntervalMs: 30000,
        };
      }
      return account;
    },
    isEnabled: (account) => account.enabled && !!account.serverUrl,
    isConfigured: (account) => !!account.serverUrl,
    unconfiguredReason: () =>
      "No serverUrl configured. Run: openclaw channels setup wechat",
  },

  // ---- Security adapter ----
  security: {
    resolveDmPolicy: ({ account }) => ({
      policy: account.dmPolicy ?? "disabled",
      allowFrom: account.allowFrom ?? [],
      allowFromPath: "channels.wechat.allowFrom",
      policyPath: "channels.wechat.dmPolicy",
      approveHint: "Add the wxid to channels.wechat.allowFrom",
    }),
  },

  // ---- Groups adapter ----
  groups: {
    resolveRequireMention: ({ cfg, groupId }) => {
      const wechat = (cfg as any)?.channels?.wechat;
      if (!wechat) return true;
      if (groupId && wechat.groups?.[groupId]?.requireMention != null) {
        return wechat.groups[groupId].requireMention;
      }
      return true; // Default: require mention in groups
    },
  },

  // ---- Messaging adapter ----
  messaging: {
    normalizeTarget: (raw) => raw, // WeChat IDs are used as-is
    targetResolver: {
      looksLikeId: (raw) =>
        raw.includes("@chatroom") || raw.startsWith("wxid_"),
      hint: "WeChat ID (wxid_xxx or xxx@chatroom)",
    },
  },

  // ---- Outbound adapter ----
  outbound: {
    deliveryMode: "direct",
    sendText: async ({ cfg, to, text }) => {
      const account = resolveWeChatAccount(
        cfg as unknown as Record<string, unknown>,
      );
      if (!account?.serverUrl) {
        return { channel: "wechat", ok: false, error: "No serverUrl configured" };
      }
      const client = new WeChatClient({ baseUrl: account.serverUrl });
      const result = await client.sendMessage({ chatId: to, text });
      return {
        channel: "wechat",
        ok: result.success,
        error: result.error ?? undefined,
      };
    },
    sendMedia: async ({ cfg, to, text, mediaUrl }) => {
      const account = resolveWeChatAccount(
        cfg as unknown as Record<string, unknown>,
      );
      if (!account?.serverUrl) {
        return { channel: "wechat", ok: false, error: "No serverUrl configured" };
      }
      const client = new WeChatClient({ baseUrl: account.serverUrl });
      // Fetch media URL → base64
      if (mediaUrl) {
        try {
          const res = await fetch(mediaUrl);
          const buffer = await res.arrayBuffer();
          const base64 = Buffer.from(buffer).toString("base64");
          const mimeType =
            res.headers.get("content-type") ?? "image/png";
          const result = await client.sendMessage({
            chatId: to,
            text: text || undefined,
            image: { data: base64, mimeType },
          });
          return {
            channel: "wechat",
            ok: result.success,
            error: result.error ?? undefined,
          };
        } catch (err) {
          return {
            channel: "wechat",
            ok: false,
            error: `Failed to fetch media: ${err}`,
          };
        }
      }
      // Text-only fallback
      const result = await client.sendMessage({
        chatId: to,
        text: text || undefined,
      });
      return {
        channel: "wechat",
        ok: result.success,
        error: result.error ?? undefined,
      };
    },
  },

  // ---- Gateway adapter ----
  gateway: {
    startAccount: async (ctx) => {
      ctx.log?.info?.(
        `[wechat:${ctx.accountId}] Starting monitor (polling ${ctx.account.serverUrl})`,
      );
      return startWeChatMonitor({
        account: ctx.account,
        abortSignal: ctx.abortSignal,
        runtime: ctx.runtime,
        setStatus: ctx.setStatus,
        log: ctx.log,
        cfg: ctx.cfg,
      });
    },
  },

  // ---- Status adapter ----
  status: {
    collectStatusIssues: collectWeChatStatusIssues,
  },

  // ---- Onboarding adapter ----
  onboarding: wechatOnboardingAdapter,
};
