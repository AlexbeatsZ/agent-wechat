/**
 * Chat avatar image extraction and hashing.
 *
 * Extracts the avatar region from a chat list item screenshot,
 * masks the badge area (unread count), and computes an MD5 hash
 * for identity matching.
 *
 * Calibrated coordinates (relative to list-item bounds):
 * - Avatar: offset (13, 17), size 34x34
 * - Badge:  offset (28, 17), size 9x9 (relative to list-item)
 */

import { PNG } from "pngjs";
import { createHash } from "crypto";

// Calibrated coordinates from manual measurement
const AVATAR_OFFSET = { x: 13, y: 17 };
const AVATAR_SIZE = 34;
const BADGE_OFFSET = { x: 28, y: 17 };  // relative to list-item
const BADGE_SIZE = 9;

// Gray color for masking (R, G, B)
const MASK_COLOR = [128, 128, 128];

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Extract the avatar hash from a screenshot for a chat list item (sync version).
 *
 * @param screenshot - PNG image buffer (full screenshot)
 * @param listItemBounds - Bounds of the list item in the screenshot
 * @returns MD5 hash of the avatar pixels (with badge masked), or null if extraction fails
 */
export function extractChatHeadHashSync(
  screenshot: Buffer,
  listItemBounds: Bounds | null | undefined
): string | null {
  if (!listItemBounds) {
    return null;
  }

  try {
    // Parse the PNG (sync)
    const png = PNG.sync.read(screenshot);

    // Calculate avatar position in absolute coordinates
    const avatarX = listItemBounds.x + AVATAR_OFFSET.x;
    const avatarY = listItemBounds.y + AVATAR_OFFSET.y;

    // Calculate badge position relative to avatar
    const badgeRelX = BADGE_OFFSET.x - AVATAR_OFFSET.x;  // 28 - 13 = 15
    const badgeRelY = BADGE_OFFSET.y - AVATAR_OFFSET.y;  // 17 - 17 = 0

    // Validate bounds
    if (avatarX < 0 || avatarY < 0 ||
        avatarX + AVATAR_SIZE > png.width ||
        avatarY + AVATAR_SIZE > png.height) {
      return null;
    }

    // Extract avatar pixels and mask badge area
    const avatarPixels: number[] = [];

    for (let y = 0; y < AVATAR_SIZE; y++) {
      for (let x = 0; x < AVATAR_SIZE; x++) {
        const srcX = avatarX + x;
        const srcY = avatarY + y;
        const srcIdx = (png.width * srcY + srcX) * 4;  // RGBA

        // Check if this pixel is in the badge area
        const inBadge = x >= badgeRelX && x < badgeRelX + BADGE_SIZE &&
                        y >= badgeRelY && y < badgeRelY + BADGE_SIZE;

        if (inBadge) {
          // Use mask color
          avatarPixels.push(MASK_COLOR[0], MASK_COLOR[1], MASK_COLOR[2]);
        } else {
          // Use actual pixel
          avatarPixels.push(png.data[srcIdx], png.data[srcIdx + 1], png.data[srcIdx + 2]);
        }
      }
    }

    // Compute MD5 hash
    const hash = createHash("md5")
      .update(Buffer.from(avatarPixels))
      .digest("hex");

    return hash;
  } catch (error) {
    console.error("[ChatImage] Failed to extract avatar hash:", error);
    return null;
  }
}

/**
 * Extract the avatar hash from a screenshot for a chat list item (async version - deprecated).
 * Use extractChatHeadHashSync instead.
 */
export async function extractChatHeadHash(
  screenshot: Buffer,
  listItemBounds: Bounds | null | undefined
): Promise<string | null> {
  return extractChatHeadHashSync(screenshot, listItemBounds);
}

/**
 * Get the avatar extraction constants (for testing/calibration).
 */
export function getAvatarConstants() {
  return {
    AVATAR_OFFSET,
    AVATAR_SIZE,
    BADGE_OFFSET,
    BADGE_SIZE,
  };
}
