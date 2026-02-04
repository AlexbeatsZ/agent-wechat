import { describe, it, expect } from "vitest";
import { matchChatWithDb, DEFAULT_AVATAR_HASH, type ChatMatcherDb } from "./chat-matcher.js";
import type { ParseResult } from "./chat-parser.js";
import type { Chat } from "@thisnick/agent-wechat-shared";

function createMockDb(chats: Array<{ id: string; name: string; imageHash?: string }>): ChatMatcherDb {
  const chatList: Chat[] = chats.map(c => ({
    id: c.id,
    name: c.name,
    imageHash: c.imageHash,
    unreadCount: 0,
    isGroup: false,
    isPinned: false,
    isMuted: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  return {
    findChatsByExactName: (name: string) => chatList.filter(c => c.name === name),
    findChatByImageHash: (hash: string) => chatList.find(c => c.imageHash === hash) ?? null,
  };
}

function createParseResult(names: string[]): ParseResult {
  return {
    candidates: names.map(name => ({
      name,
      unreadCount: 0,
      pinned: false,
      muted: false,
    })),
    unreadCount: 0,
    pinned: false,
    muted: false,
  };
}

describe("matchChatWithDb", () => {
  // ========== Name Matching ==========
  it("matches unique name without image", () => {
    const db = createMockDb([{ id: "1", name: "Alice", imageHash: "abc" }]);
    const result = matchChatWithDb(
      db,
      createParseResult(["Alice", "Alice Smith"]),
      "xyz"  // Different image hash - should be ignored
    );
    expect(result.id).toBe("1");
    expect(result.confidence).toBe("name_unique");
    expect(result.shouldUpdateName).toBe(false);
  });

  it("requires image when multiple candidates match", () => {
    const db = createMockDb([
      { id: "1", name: "Nick", imageHash: "abc" },
      { id: "2", name: "Nick Bot", imageHash: "def" },
    ]);
    const result = matchChatWithDb(
      db,
      createParseResult(["Nick", "Nick Bot"]),
      "def"  // Matches "Nick Bot"
    );
    expect(result.id).toBe("2");
    expect(result.confidence).toBe("name_and_image");
  });

  it("requires image when one candidate matches multiple DB entries", () => {
    const db = createMockDb([
      { id: "1", name: "Alice", imageHash: "abc" },
      { id: "2", name: "Alice", imageHash: "def" },  // Same name, different person
    ]);
    const result = matchChatWithDb(
      db,
      createParseResult(["Alice"]),
      "def"
    );
    expect(result.id).toBe("2");
    expect(result.confidence).toBe("name_and_image");
  });

  // ========== Image-Only Matching ==========
  it("matches by image when no name matches", () => {
    const db = createMockDb([{ id: "1", name: "Old Name", imageHash: "abc" }]);
    const result = matchChatWithDb(
      db,
      createParseResult(["New Name"]),
      "abc"
    );
    expect(result.id).toBe("1");
    expect(result.confidence).toBe("image_only");
    expect(result.shouldUpdateName).toBe(true);  // Single candidate = unambiguous
  });

  it("does not update name when image match has multiple candidates", () => {
    const db = createMockDb([{ id: "1", name: "Old Name", imageHash: "abc" }]);
    const result = matchChatWithDb(
      db,
      createParseResult(["New", "New Name"]),
      "abc"
    );
    expect(result.id).toBe("1");
    expect(result.name).toBe("Old Name");  // Keep old name
    expect(result.shouldUpdateName).toBe(false);  // Ambiguous
  });

  // ========== New Chats ==========
  it("creates new entry when no match", () => {
    const db = createMockDb([{ id: "1", name: "Existing", imageHash: "abc" }]);
    const result = matchChatWithDb(
      db,
      createParseResult(["Brand New"]),
      "xyz"
    );
    expect(result.id).not.toBe("1");
    expect(result.confidence).toBe("new");
    expect(result.shouldUpdateName).toBe(true);
  });

  // ========== Default Avatar ==========
  it("skips image matching for default avatar", () => {
    const db = createMockDb([{ id: "1", name: "Someone", imageHash: DEFAULT_AVATAR_HASH }]);
    const result = matchChatWithDb(
      db,
      createParseResult(["New Person"]),
      DEFAULT_AVATAR_HASH  // Default avatar
    );
    expect(result.confidence).toBe("new");  // Don't match by default avatar
  });
});
