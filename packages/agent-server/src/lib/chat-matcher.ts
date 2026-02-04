/**
 * Chat matching algorithm for identity resolution.
 *
 * Strategy: Match candidates by name first. Only use image hash when name matching is ambiguous.
 *
 * Matching rules:
 * 1. If exactly ONE candidate matches exactly ONE DB entry by name -> use it, skip image
 * 2. If ambiguous (multiple matches) -> use image hash to disambiguate
 * 3. If no name match -> try image hash matching
 * 4. If still no match -> create new entry
 */

import { randomUUID } from "crypto";
import type { Chat } from "@thisnick/agent-wechat-shared";
import type { DatabaseInstance } from "../db/index.js";
import { findChatsByExactName, findChatByImageHash } from "../db/queries.js";
import type { ParseResult } from "./chat-parser.js";

// Default avatar hash - skip image-only matching for this
export const DEFAULT_AVATAR_HASH = "28459a28ae4df5d1f2d026d1fa9379a2";

export type MatchConfidence = "name_unique" | "name_and_image" | "image_only" | "new";

export interface MatchResult {
  id: string;
  name: string;  // Best guess for display
  confidence: MatchConfidence;
  shouldUpdateName: boolean;  // Only true if unambiguous
}

/**
 * Interface for testing - allows mocking DB lookups
 */
export interface ChatMatcherDb {
  findChatsByExactName(name: string): Chat[];
  findChatByImageHash(imageHash: string): Chat | null;
}

/**
 * Create a ChatMatcherDb adapter from a DatabaseInstance
 */
export function createChatMatcherDb(db: DatabaseInstance): ChatMatcherDb {
  return {
    findChatsByExactName: (name: string) => findChatsByExactName(db, name),
    findChatByImageHash: (imageHash: string) => findChatByImageHash(db, imageHash),
  };
}

/**
 * Match a parsed chat head against the database.
 *
 * @param db - Database instance or ChatMatcherDb interface
 * @param parseResult - Parse result with candidates
 * @param imageHash - MD5 hash of the avatar (with badge masked)
 */
export function matchChatWithDb(
  db: DatabaseInstance | ChatMatcherDb,
  parseResult: ParseResult,
  imageHash: string
): MatchResult {
  // Normalize to ChatMatcherDb interface
  const matcherDb: ChatMatcherDb = "findChatsByExactName" in db
    ? db as ChatMatcherDb
    : createChatMatcherDb(db as DatabaseInstance);

  const candidateNames = [...new Set(parseResult.candidates.map(c => c.name))];

  // 1. Try name matching first - find all (candidate, dbEntry) pairs
  const nameMatches: Array<{ candidate: string; dbEntry: Chat }> = [];
  for (const name of candidateNames) {
    const matches = matcherDb.findChatsByExactName(name);
    for (const dbChat of matches) {
      nameMatches.push({ candidate: name, dbEntry: dbChat });
    }
  }

  // 2. Check if name matching is unambiguous
  if (nameMatches.length === 1) {
    // Exactly ONE candidate matches exactly ONE DB entry - use it, skip image
    const match = nameMatches[0];
    return {
      id: match.dbEntry.id,
      name: match.candidate,
      confidence: "name_unique",
      shouldUpdateName: false,  // Name already correct
    };
  }

  // 3. Ambiguous name match (multiple matches) OR no name match at all -> use image hash
  if (imageHash && imageHash !== DEFAULT_AVATAR_HASH) {
    const imageMatch = matcherDb.findChatByImageHash(imageHash);
    if (imageMatch) {
      // Found by image - check if we can determine the correct name
      if (nameMatches.length > 0) {
        // Had ambiguous name matches - find which one matches the image
        const confirmedMatch = nameMatches.find(m => m.dbEntry.id === imageMatch.id);
        if (confirmedMatch) {
          return {
            id: imageMatch.id,
            name: confirmedMatch.candidate,
            confidence: "name_and_image",
            shouldUpdateName: false,  // Name confirmed by image
          };
        }
      }

      // Image match but no name match - possibly renamed
      const singleCandidate = candidateNames.length === 1;
      return {
        id: imageMatch.id,
        name: singleCandidate ? candidateNames[0] : imageMatch.name,
        confidence: "image_only",
        shouldUpdateName: singleCandidate,  // Only update if parse was unambiguous
      };
    }
  }

  // 4. No match at all - new chat
  return {
    id: randomUUID(),
    name: candidateNames[0],  // First candidate (most conservative)
    confidence: "new",
    shouldUpdateName: true,
  };
}
