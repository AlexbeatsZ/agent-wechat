import { describe, it, expect } from "vitest";
import { parseChatHead } from "./chat-parser.js";

describe("parseChatHead", () => {
  // ========== Basic Cases ==========
  it("parses simple name only", () => {
    const result = parseChatHead("Alice");
    expect(result.candidates.map(c => c.name)).toContain("Alice");
    expect(result.unreadCount).toBe(0);
    expect(result.muted).toBe(false);
    expect(result.pinned).toBe(false);
  });

  it("parses name with time", () => {
    const result = parseChatHead("Alice 10:30");
    expect(result.candidates.map(c => c.name)).toContain("Alice");
    expect(result.time).toBe("10:30");
  });

  // ========== Multiple Candidates ==========
  it("generates multiple name candidates for ambiguous input", () => {
    const result = parseChatHead("Nick Bot 1 2 3 4 00:12");
    const names = result.candidates.map(c => c.name);
    expect(names).toContain("Nick");
    expect(names).toContain("Nick Bot");
    expect(names).toContain("Nick Bot 1");
    expect(names).toContain("Nick Bot 1 2 3 4");
    expect(result.time).toBe("00:12");
  });

  it("generates multiple sender candidates for groups", () => {
    const result = parseChatHead("Airbnb 一群 Feng - 校友: 谢谢大家 22:00");
    const senders = result.candidates.map(c => c.sender).filter(Boolean);
    expect(senders).toContain("一群 Feng - 校友");
    expect(senders).toContain("Feng - 校友");
    expect(senders).toContain("- 校友");
    expect(senders).toContain("校友");
    expect(result.time).toBe("22:00");
  });

  // ========== Unread Messages ==========
  it("parses unread count", () => {
    const result = parseChatHead("Alice 3 unread message(s) Hello 14:20");
    expect(result.unreadCount).toBe(3);
    expect(result.candidates.map(c => c.name)).toContain("Alice");
    expect(result.candidates[0].preview).toBe("Hello");
    expect(result.time).toBe("14:20");
  });

  it("parses group with unread and [N] badge", () => {
    const result = parseChatHead("Work Chat 5 unread message(s) [3]Alice: Meeting 11:00");
    expect(result.unreadCount).toBe(5);
    // Badge [3] should be stripped
    const senders = result.candidates.map(c => c.sender).filter(Boolean);
    expect(senders).toContain("Alice");
  });

  // ========== Status Flags ==========
  it("extracts muted status", () => {
    const result = parseChatHead("Spam Group Hello 8:00 Mute Notifications");
    expect(result.muted).toBe(true);
    expect(result.time).toBe("8:00");
  });

  it("extracts pinned status", () => {
    const result = parseChatHead("Important Stuck on Top Hello 12:00");
    expect(result.pinned).toBe(true);
  });

  it("extracts both muted and pinned", () => {
    const result = parseChatHead("Group Stuck on Top 10:00 Mute Notifications");
    expect(result.pinned).toBe(true);
    expect(result.muted).toBe(true);
  });

  // ========== Unambiguous Fields ==========
  it("all candidates share unambiguous fields", () => {
    const result = parseChatHead("Group Name 3 unread message(s) Hi 14:00 Mute Notifications");
    expect(result.unreadCount).toBe(3);
    expect(result.time).toBe("14:00");
    expect(result.muted).toBe(true);
    for (const c of result.candidates) {
      expect(c.unreadCount).toBe(3);
      expect(c.time).toBe("14:00");
      expect(c.muted).toBe(true);
    }
  });

  // ========== Edge Cases ==========
  it("handles sticker notation [Sticker]", () => {
    const result = parseChatHead("Alice [Smile] 10:00");
    const previews = result.candidates.map(c => c.preview).filter(Boolean);
    expect(previews.some(p => p?.includes("[Smile]"))).toBe(true);
  });

  it("handles Chinese characters", () => {
    const result = parseChatHead("李明 你好 14:00");
    expect(result.candidates.map(c => c.name)).toContain("李明");
    expect(result.time).toBe("14:00");
  });

  it("handles emoji in name", () => {
    const result = parseChatHead("Party Group 15:00");
    expect(result.candidates.map(c => c.name)).toContain("Party Group");
  });

  it("handles special accounts", () => {
    expect(parseChatHead("Official Accounts").candidates.map(c => c.name)).toContain("Official Accounts");
    expect(parseChatHead("File Transfer").candidates.map(c => c.name)).toContain("File Transfer");
  });
});
