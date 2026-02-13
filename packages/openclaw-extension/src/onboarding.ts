import { WeChatClient } from "@thisnick/agent-wechat-shared";
import type { ResolvedWeChatAccount } from "./types.js";

export interface OnboardingStatus {
  configured: boolean;
  lines: string[];
}

export interface WizardPrompter {
  text(opts: { message: string; default?: string }): Promise<string>;
  select<T extends string>(opts: {
    message: string;
    choices: { label: string; value: T }[];
  }): Promise<T>;
  multiText(opts: {
    message: string;
    hint?: string;
  }): Promise<string[]>;
  confirm(opts: { message: string; default?: boolean }): Promise<boolean>;
}

export const wechatOnboardingAdapter = {
  getStatus: async ({
    account,
  }: {
    account: ResolvedWeChatAccount;
  }): Promise<OnboardingStatus> => {
    if (!account.serverUrl) {
      return {
        configured: false,
        lines: ["Not configured. Run: openclaw channels setup wechat"],
      };
    }

    const client = new WeChatClient({ baseUrl: account.serverUrl });
    const lines: string[] = [];

    try {
      await client.status();
      lines.push(`Connected to ${account.serverUrl}`);
    } catch {
      return {
        configured: true,
        lines: [
          `Server URL: ${account.serverUrl}`,
          "Cannot reach server — is the agent-wechat container running?",
        ],
      };
    }

    try {
      const auth = await client.authStatus();
      if (auth.isLoggedIn) {
        lines.push(
          `Logged in${auth.loggedInUser ? ` as ${auth.loggedInUser}` : ""}`,
        );
      } else {
        lines.push("Not logged in. Run: pnpm cli auth login");
      }
    } catch {
      lines.push("Could not check auth status");
    }

    lines.push(`DM policy: ${account.dmPolicy}`);
    if (account.allowFrom.length > 0) {
      lines.push(`Allowed senders: ${account.allowFrom.join(", ")}`);
    }
    lines.push(`Group policy: ${account.groupPolicy}`);

    return { configured: true, lines };
  },

  configure: async ({
    prompter,
    cfg,
    setCfg,
  }: {
    prompter: WizardPrompter;
    cfg: Record<string, unknown>;
    setCfg: (path: string, value: unknown) => void;
  }): Promise<void> => {
    // 1. Server URL
    const existingUrl =
      (cfg as any)?.channels?.wechat?.serverUrl ?? "http://localhost:6174";
    const serverUrl = await prompter.text({
      message: "Agent-wechat server URL",
      default: existingUrl,
    });
    setCfg("channels.wechat.serverUrl", serverUrl);

    // 2. Test connection
    const client = new WeChatClient({ baseUrl: serverUrl });
    try {
      await client.status();
    } catch {
      setCfg("channels.wechat.enabled", false);
      throw new Error(
        `Cannot reach ${serverUrl}. Ensure the agent-wechat container is running.`,
      );
    }

    // 3. Check auth
    try {
      const auth = await client.authStatus();
      if (!auth.isLoggedIn) {
        // Not a fatal error — user can log in later
        await prompter.confirm({
          message:
            "WeChat is not logged in. You can log in later with: pnpm cli auth login. Continue setup?",
          default: true,
        });
      }
    } catch {
      // Auth check failed — continue setup anyway
    }

    // 4. DM policy
    const dmPolicy = await prompter.select({
      message: "DM (direct message) policy",
      choices: [
        { label: "Disabled — ignore all DMs", value: "disabled" as const },
        {
          label: "Allowlist — only respond to specific senders",
          value: "allowlist" as const,
        },
        { label: "Open — respond to all DMs", value: "open" as const },
      ],
    });
    setCfg("channels.wechat.dmPolicy", dmPolicy);

    // 5. Allowlist
    if (dmPolicy === "allowlist") {
      const allowFrom = await prompter.multiText({
        message: "Allowed WeChat IDs (wxid_xxx), one per line",
        hint: "Enter wxid values, press Enter after each. Empty line to finish.",
      });
      setCfg("channels.wechat.allowFrom", allowFrom);
    }

    // 6. Group policy
    const groupPolicy = await prompter.select({
      message: "Group chat policy",
      choices: [
        {
          label: "Disabled — ignore all group messages",
          value: "disabled" as const,
        },
        {
          label: "Allowlist — only respond in specific groups",
          value: "allowlist" as const,
        },
        {
          label: "Open — respond in all groups (when mentioned)",
          value: "open" as const,
        },
      ],
    });
    setCfg("channels.wechat.groupPolicy", groupPolicy);

    if (groupPolicy === "allowlist") {
      const groupAllowFrom = await prompter.multiText({
        message: "Allowed group IDs (xxx@chatroom), one per line",
        hint: "Enter chatroom IDs, press Enter after each. Empty line to finish.",
      });
      setCfg("channels.wechat.groupAllowFrom", groupAllowFrom);
    }

    // 7. Enable
    setCfg("channels.wechat.enabled", true);
  },
};
