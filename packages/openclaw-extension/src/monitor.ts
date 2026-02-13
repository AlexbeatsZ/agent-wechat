import { WeChatClient } from "@thisnick/agent-wechat-shared";
import type { Chat, Message } from "@thisnick/agent-wechat-shared";
import type { ResolvedWeChatAccount } from "./types.js";
import { getWeChatRuntime } from "./runtime.js";

// Message types that may have downloadable media
const MEDIA_TYPES = new Set([3, 34]); // image, voice

export interface WeChatMonitorOptions {
  account: ResolvedWeChatAccount;
  abortSignal: AbortSignal;
  runtime: any; // PluginRuntime
  setStatus: (next: any) => void;
  log?: { info?: (...args: any[]) => void; error?: (...args: any[]) => void };
  cfg: any; // OpenClawConfig
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function startWeChatMonitor(
  opts: WeChatMonitorOptions,
): Promise<void> {
  const { account, abortSignal, runtime, setStatus, log } = opts;
  const client = new WeChatClient({ baseUrl: account.serverUrl });

  // Track last-seen message ID per chat
  const lastSeenId = new Map<string, number>();
  let lastAuthCheck = 0;

  // Report initial status as running
  setStatus({
    accountId: account.accountId,
    running: true,
    connected: true,
    linked: true,
  });

  while (!abortSignal.aborted) {
    try {
      // ---- Auth polling (every authPollIntervalMs) ----
      const now = Date.now();
      if (now - lastAuthCheck >= account.authPollIntervalMs) {
        lastAuthCheck = now;
        try {
          const auth = await client.authStatus();
          setStatus({
            accountId: account.accountId,
            running: true,
            connected: true,
            linked: auth.isLoggedIn,
          });
          if (!auth.isLoggedIn) {
            log?.info?.(`[wechat:${account.accountId}] Not authenticated`);
            await sleep(account.pollIntervalMs, abortSignal);
            continue;
          }
        } catch (err) {
          setStatus({
            accountId: account.accountId,
            running: true,
            connected: false,
            linked: false,
            lastError: String(err),
          });
          log?.error?.(
            `[wechat:${account.accountId}] Auth check failed: ${err}`,
          );
          await sleep(account.pollIntervalMs, abortSignal);
          continue;
        }
      }

      // ---- Message polling ----
      let chats: Chat[];
      try {
        chats = await client.listChats(50);
      } catch (err) {
        log?.error?.(
          `[wechat:${account.accountId}] Failed to list chats: ${err}`,
        );
        await sleep(account.pollIntervalMs, abortSignal);
        continue;
      }

      // Filter to chats with unreads
      const unreadChats = chats.filter((c) => c.unreadCount > 0);

      if (unreadChats.length > 0) {
        for (const chat of unreadChats) {
          if (abortSignal.aborted) break;
          await processUnreadChat(
            client,
            chat,
            lastSeenId,
            account,
            runtime,
            opts.cfg,
            log,
          );
        }
      }
    } catch (err) {
      log?.error?.(
        `[wechat:${account.accountId}] Monitor error: ${err}`,
      );
    }

    await sleep(account.pollIntervalMs, abortSignal);
  }

  setStatus({
    accountId: account.accountId,
    running: false,
    connected: false,
  });
}

async function processUnreadChat(
  client: WeChatClient,
  chat: Chat,
  lastSeenId: Map<string, number>,
  account: ResolvedWeChatAccount,
  runtime: any,
  cfg: any,
  log?: { info?: (...args: any[]) => void; error?: (...args: any[]) => void },
): Promise<void> {
  const chatId = chat.username ?? chat.id;

  // Open the chat (triggers media downloads + future clear-unreads)
  try {
    await client.openChat(chatId, true);
  } catch (err) {
    log?.error?.(
      `[wechat:${account.accountId}] Failed to open chat ${chatId}: ${err}`,
    );
  }

  // Determine how many messages to fetch
  const prevLastSeen = lastSeenId.get(chatId) ?? 0;
  const fetchLimit = Math.max(chat.unreadCount, 20);

  let messages: Message[];
  try {
    messages = await client.listMessages(chatId, fetchLimit);
  } catch (err) {
    log?.error?.(
      `[wechat:${account.accountId}] Failed to list messages for ${chatId}: ${err}`,
    );
    return;
  }

  // Filter to new messages (localId > lastSeenId)
  const newMessages = messages.filter((m) => m.localId > prevLastSeen);
  if (newMessages.length === 0) {
    // Update lastSeenId even if no new messages (to advance past current)
    if (messages.length > 0) {
      const maxId = Math.max(...messages.map((m) => m.localId));
      lastSeenId.set(chatId, maxId);
    }
    return;
  }

  // Sort oldest-first for processing
  newMessages.sort((a, b) => a.localId - b.localId);

  // Wait for media to settle
  await sleep(500);

  for (const msg of newMessages) {
    // Attempt media download for supported types
    let media: {
      base64: string;
      mimeType: string;
      filename: string;
    } | undefined;

    const baseType = msg.type & 0x7fffffff;
    if (MEDIA_TYPES.has(baseType)) {
      try {
        const result = await client.getMedia(chatId, msg.localId);
        if (result.data && result.type !== "unsupported") {
          const mimeMap: Record<string, string> = {
            jpeg: "image/jpeg",
            jpg: "image/jpeg",
            png: "image/png",
            gif: "image/gif",
            mp3: "audio/mpeg",
            silk: "audio/silk",
          };
          media = {
            base64: result.data,
            mimeType: mimeMap[result.format] ?? `application/${result.format}`,
            filename: result.filename,
          };
        }
      } catch {
        // Media download failed — continue without attachment
      }
    }

    // Build inbound message and dispatch via runtime
    const isGroup = chatId.includes("@chatroom");
    const senderId = msg.sender ?? chatId;
    const timestamp = new Date(msg.timestamp).getTime();

    try {
      await runtime.channel.reply.handleInbound({
        channel: "wechat",
        accountId: account.accountId,
        messageId: `wechat:${chatId}:${msg.localId}`,
        target: chatId,
        senderId,
        senderName: msg.sender,
        text: msg.content,
        timestamp,
        isGroup,
        isMentioned: msg.isMentioned ?? false,
        media: media
          ? {
              data: Buffer.from(media.base64, "base64"),
              mimeType: media.mimeType,
              filename: media.filename,
            }
          : undefined,
        replyTo: msg.reply
          ? { senderId: msg.reply.sender, text: msg.reply.content }
          : undefined,
        cfg,
      });

      // Record activity
      runtime.channel.activity?.record?.({
        channel: "wechat",
        accountId: account.accountId,
        direction: "inbound",
        at: timestamp,
      });
    } catch (err) {
      log?.error?.(
        `[wechat:${account.accountId}] Failed to dispatch message ${msg.localId}: ${err}`,
      );
    }
  }

  // Update lastSeenId
  const maxId = Math.max(...newMessages.map((m) => m.localId));
  lastSeenId.set(chatId, maxId);
}
