import { z } from "zod";
import type { Plan, ActionParams, SelectedAction } from "../ia/types.js";
import { clickBounds } from "../ia/actions.js";
import { upsertChat, findChatByImageHash, findChatsByExactName } from "../db/queries.js";
import { DEFAULT_AVATAR_HASH } from "../lib/chat-matcher.js";

/**
 * Sync chats plan params
 */
export interface SyncChatsParams extends ActionParams {
  maxChats: number;
}

const syncChatsParamsSchema = z.object({
  maxChats: z.number().optional().default(20),
}) as unknown as z.ZodSchema<SyncChatsParams>;

/**
 * Chats to skip during sync
 */
const SKIP_PATTERNS = [
  "File Transfer",
  "文件传输助手",
  "Official Accounts",
  "Service Accounts",
  "订阅号",
  "服务号",
];

function shouldSkipChat(name?: string): boolean {
  if (!name) return false;
  return SKIP_PATTERNS.some(p => name.includes(p));
}

/**
 * Persist chat to database
 */
function persistChat(
  db: Parameters<typeof upsertChat>[0],
  chatName: string,
  isGroup: boolean,
  unreadCount: number,
  rawImageHash?: string
): void {
  const imageHash = rawImageHash === DEFAULT_AVATAR_HASH ? undefined : rawImageHash;

  let existingChat = imageHash ? findChatByImageHash(db, imageHash) : null;
  if (!existingChat) {
    const nameMatches = findChatsByExactName(db, chatName);
    if (nameMatches.length === 1) {
      existingChat = nameMatches[0];
    }
  }

  if (existingChat) {
    upsertChat(db, {
      id: existingChat.id,
      name: chatName,
      imageHash: imageHash ?? existingChat.imageHash,
      isGroup: isGroup || existingChat.isGroup,
      unreadCount,
    });
  } else {
    upsertChat(db, {
      name: chatName,
      imageHash,
      isGroup,
      unreadCount,
      createdAt: new Date().toISOString(),
    });
  }
}

/**
 * Sync plan state
 */
export interface SyncPlanState {
  phase: "init" | "syncing" | "done";
  lastSelectedName: string | null;  // For detecting end of list (looped back)
  processedCount: number;
  pendingUnreadCount: number;  // Captured from focused item before pressing space
}

/**
 * Sync Chats Plan - Decoupled ctrl+Tab and space algorithm:
 *
 * 1. Init: Close any open chat, press Home, then ctrl+Tab
 * 2. Loop (no chat open - checking focused item):
 *    - If focused should skip → ctrl+Tab (skip it)
 *    - If focused === lastSelected → done (looped back)
 *    - Otherwise → note unreadCount, press space
 * 3. Loop (chat open - persist and move on):
 *    - Persist chat with noted unreadCount
 *    - Update lastSelectedName
 *    - Click to close, ctrl+Tab
 */
export const syncChatsPlan: Plan<SyncChatsParams, SyncPlanState> = {
  id: "sync_chats",
  description: "Sync chat list by selecting each chat",
  params: syncChatsParamsSchema,

  initialPlanState: () => ({
    phase: "init",
    lastSelectedName: null,
    processedCount: 0,
    pendingUnreadCount: 0,
  }),

  isGoalReached: ({ params, planState }) => {
    if (planState.phase === "done") return true;
    if (params.maxChats && planState.processedCount >= params.maxChats) return true;
    return false;
  },

  selectAction: ({ state, identified, planState, db }): SelectedAction | null => {
    const mainMeta = identified.mainWindow?.metadata;
    const view = state.mainWindow.view;
    const selectedBounds = state.mainWindow.selectedChatBounds;
    const openedChatName = state.mainWindow.openedChatName;
    const focusedName = state.mainWindow.focusedChatName;
    const focusedIndex = state.mainWindow.focusedChatIndex;

    // Get unread count from focused item in visibleChats
    const focusedUnread = focusedIndex !== undefined
      ? state.mainWindow.visibleChats?.[focusedIndex]?.unreadCount ?? 0
      : 0;

    // === INIT PHASE ===
    if (planState.phase === "init") {
      // If chat is open, close it first
      if (view === "chat_open") {
        if (selectedBounds) {
          return { action: clickBounds(selectedBounds), metadata: mainMeta };
        }
        return { action: { type: "key", combo: "Escape" }, metadata: mainMeta };
      }

      // No chat open - press Home then ctrl+Tab to focus first item
      planState.phase = "syncing";
      return {
        action: {
          type: "sequence",
          actions: [
            { type: "key", combo: "Home" },
            { type: "key", combo: "ctrl+Tab" },
          ],
        },
        metadata: mainMeta,
      };
    }

    // === SYNCING PHASE ===
    if (planState.phase === "syncing") {
      // --- Chat NOT open: evaluate focused item ---
      if (view !== "chat_open") {
        // Skip system chats
        if (shouldSkipChat(focusedName)) {
          return { action: { type: "key", combo: "ctrl+Tab" }, metadata: mainMeta };
        }

        // Check if we've looped back (focused === last selected)
        if (focusedName && focusedName === planState.lastSelectedName) {
          planState.phase = "done";
          return null;
        }

        // Note unread count and press space to select
        planState.pendingUnreadCount = focusedUnread;
        return { action: { type: "key", combo: "space" }, metadata: mainMeta };
      }

      // --- Chat IS open: persist and move on ---
      if (openedChatName) {
        // Persist the chat with noted unread count
        const imageHash = state.mainWindow.openedChatImageHash;
        const isGroup = state.mainWindow.openedChatIsGroup ?? false;
        persistChat(db, openedChatName, isGroup, planState.pendingUnreadCount, imageHash);
        planState.processedCount++;
        planState.lastSelectedName = openedChatName;

        // Emit progress event
        const progressEvent = {
          type: "emit" as const,
          event: { type: "sync_progress", processedCount: planState.processedCount },
        };

        // Close and move focus to next: emit, click, ctrl+Tab
        if (selectedBounds) {
          return {
            action: {
              type: "sequence",
              actions: [
                progressEvent,
                clickBounds(selectedBounds),
                { type: "key", combo: "ctrl+Tab" },
              ],
            },
            metadata: mainMeta,
          };
        }
        return {
          action: {
            type: "sequence",
            actions: [
              progressEvent,
              { type: "key", combo: "Escape" },
              { type: "key", combo: "ctrl+Tab" },
            ],
          },
          metadata: mainMeta,
        };
      }

      // Chat open but no name yet - wait for UI to settle
      return null;
    }

    // === DONE ===
    return null;
  },
};
