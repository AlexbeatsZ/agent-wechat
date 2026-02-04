/**
 * Multi-candidate chat head parser.
 *
 * Chat head strings are ambiguous - no clear delimiter between name and preview/sender.
 * This parser generates all plausible (name, sender, preview) interpretations.
 *
 * Example: "Nick Bot 1 2 3 4 00:12"
 * - Name could be: "Nick", "Nick Bot", "Nick Bot 1", etc.
 *
 * Example: "Airbnb 一群 Feng - 校友: 谢谢大家 22:00"
 * - Sender could be: "一群 Feng - 校友", "Feng - 校友", "- 校友", "校友"
 */

export interface ParseCandidate {
  name: string;
  sender?: string;
  preview?: string;
  time?: string;
  unreadCount: number;
  pinned: boolean;
  muted: boolean;
}

export interface ParseResult {
  candidates: ParseCandidate[];
  // Fields that are unambiguous (same across all candidates)
  time?: string;
  unreadCount: number;
  pinned: boolean;
  muted: boolean;
}

/**
 * Parse a chat head string into multiple candidates.
 *
 * Strategy:
 * 1. Strip anchored patterns first (unambiguous): time, muted, pinned, unread
 * 2. Generate name/sender candidates from the remainder
 */
export function parseChatHead(raw: string): ParseResult {
  let text = raw;

  // 1. Strip unambiguous suffixes (from end)
  const muted = /Mute Notif\w*\s*$/i.test(text);
  text = text.replace(/\s*Mute Notif\w*\s*$/i, "");

  const timeMatch = text.match(/\s+(\d{1,2}:\d{2})\s*$/);
  const time = timeMatch?.[1];
  if (timeMatch) text = text.slice(0, timeMatch.index).trim();

  const pinned = text.includes("Stuck on Top");
  text = text.replace("Stuck on Top", "").trim();

  // 2. Extract unread count (splits name from preview)
  let unreadCount = 0;
  let beforeUnread = text;
  let afterUnread = "";

  const unreadMatch = text.match(/^(.+?)\s+(\d+)\s+unread message\(s\)\s*(.*)$/);
  if (unreadMatch) {
    beforeUnread = unreadMatch[1].trim();
    unreadCount = parseInt(unreadMatch[2], 10);
    afterUnread = unreadMatch[3].trim().replace(/^\[\d+\]\s*/, ""); // Remove [N] badge
  }

  // 3. Generate candidates
  const candidates: ParseCandidate[] = [];
  const base = { time, unreadCount, pinned, muted };

  if (afterUnread) {
    // Has unread - name is before, preview/sender is after
    candidates.push(...generateSenderCandidates(beforeUnread, afterUnread, base));
  } else {
    // No unread - need to split the whole string
    candidates.push(...generateAllCandidates(beforeUnread, base));
  }

  // Ensure at least one candidate exists
  if (candidates.length === 0) {
    candidates.push({ ...base, name: text || raw });
  }

  return { candidates, time, unreadCount, pinned, muted };
}

/**
 * Generate candidates when we have a known name and a remainder (after unread).
 */
function generateSenderCandidates(
  name: string,
  remainder: string,
  base: Omit<ParseCandidate, "name" | "sender" | "preview">
): ParseCandidate[] {
  const candidates: ParseCandidate[] = [];

  // Check for sender:message pattern
  const colonIdx = remainder.indexOf(":");
  if (colonIdx > 0) {
    const sender = remainder.slice(0, colonIdx).trim();
    const preview = remainder.slice(colonIdx + 1).trim();

    // Generate all possible sender splits (split on spaces before colon)
    const senderWords = sender.split(/\s+/);
    for (let i = 0; i < senderWords.length; i++) {
      const senderPart = senderWords.slice(i).join(" ");
      const namePart = i > 0
        ? name + " " + senderWords.slice(0, i).join(" ")
        : name;

      candidates.push({
        ...base,
        name: namePart,
        sender: senderPart,
        preview,
      });
    }
  } else {
    // No sender, just preview
    candidates.push({ ...base, name, preview: remainder });
  }

  return candidates;
}

/**
 * Generate all possible (name, sender, preview) splits from a string.
 */
function generateAllCandidates(
  text: string,
  base: Omit<ParseCandidate, "name" | "sender" | "preview">
): ParseCandidate[] {
  const candidates: ParseCandidate[] = [];

  // Check for sender:message pattern
  const colonIdx = text.indexOf(":");
  if (colonIdx > 0) {
    const beforeColon = text.slice(0, colonIdx).trim();
    const afterColon = text.slice(colonIdx + 1).trim();

    // Generate all (name, sender) splits
    const words = beforeColon.split(/\s+/);
    for (let i = 1; i < words.length; i++) {
      candidates.push({
        ...base,
        name: words.slice(0, i).join(" "),
        sender: words.slice(i).join(" "),
        preview: afterColon,
      });
    }
  }

  // Also generate name-only candidates (split on spaces)
  const words = text.split(/\s+/);
  for (let i = 1; i <= words.length; i++) {
    const name = words.slice(0, i).join(" ");
    const preview = i < words.length ? words.slice(i).join(" ") : undefined;
    candidates.push({ ...base, name, preview, sender: undefined });
  }

  return candidates;
}
