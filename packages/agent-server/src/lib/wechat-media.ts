/**
 * Media extraction from WeChat's databases and filesystem.
 *
 * Handles image thumbnails (filesystem cache), emoji (emoticon.db CDN URLs),
 * and voice messages (media_0.db SILK BLOBs).
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { MediaResult } from "@thisnick/agent-wechat-shared";
import { queryWechatDb, getDbPath } from "./wechat-db.js";
import { getMsgTableName, decompressHex } from "./wechat-messages.js";

/** ZSTD magic number */
const ZSTD_MAGIC = "28b52ffd";

interface MsgLookupRow {
  local_id: number;
  local_type: number;
  create_time: number;
  hex_content: string | null;
  is_compressed: number | null;
}

/**
 * Find both possible base paths for the WeChat account directory.
 */
function getAccountBasePaths(accountDir: string): string[] {
  return [
    path.join("/home/wechat/xwechat_files", accountDir),
    path.join("/home/wechat/Documents/xwechat_files", accountDir),
  ];
}

/**
 * Decode message content from hex, decompressing if needed.
 */
function decodeContent(hexContent: string | null, isCompressed: number | null): string {
  if (!hexContent) return "";
  if (isCompressed && hexContent.toLowerCase().startsWith(ZSTD_MAGIC)) {
    try {
      return decompressHex(hexContent);
    } catch {
      return "";
    }
  }
  return Buffer.from(hexContent, "hex").toString("utf-8");
}

/**
 * Look up a specific message by localId to get its type and content.
 */
function lookupMessage(
  accountDir: string,
  msgKey: string,
  chatId: string,
  localId: number,
): MsgLookupRow | null {
  const dbPath = getDbPath(accountDir, "message_0.db");
  const tableName = getMsgTableName(chatId);

  const rows = queryWechatDb(
    dbPath,
    msgKey,
    `SELECT local_id, local_type, create_time,
            hex(message_content) as hex_content,
            WCDB_CT_message_content as is_compressed
     FROM "${tableName}"
     WHERE local_id = ${localId}
     LIMIT 1;`,
  ) as unknown as MsgLookupRow[];

  return rows[0] ?? null;
}

/**
 * Get image thumbnail from filesystem cache.
 *
 * Path pattern: cache/{YYYY-MM}/Message/{md5(chatId)}/Thumb/{localId}_{createTime}_thumb.jpg
 */
export function getImageThumbnail(
  accountDir: string,
  keys: Record<string, string>,
  chatId: string,
  localId: number,
): MediaResult {
  const msgKey = keys["message_0.db"];
  if (!msgKey) return { type: "unsupported", format: "", filename: "" };

  const msg = lookupMessage(accountDir, msgKey, chatId, localId);
  if (!msg) return { type: "unsupported", format: "", filename: "" };

  const hash = crypto.createHash("md5").update(chatId).digest("hex");
  const date = new Date(msg.create_time * 1000);
  const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

  const thumbName = `${localId}_${msg.create_time}_thumb.jpg`;

  for (const base of getAccountBasePaths(accountDir)) {
    const thumbPath = path.join(base, "cache", yearMonth, "Message", hash, "Thumb", thumbName);
    if (fs.existsSync(thumbPath)) {
      const data = fs.readFileSync(thumbPath).toString("base64");
      return {
        type: "image",
        data,
        format: "jpeg",
        filename: `msg_${localId}.jpg`,
      };
    }
  }

  // Thumbnail not found in cache - try finding any thumb matching this localId
  for (const base of getAccountBasePaths(accountDir)) {
    const thumbDir = path.join(base, "cache", yearMonth, "Message", hash, "Thumb");
    if (fs.existsSync(thumbDir)) {
      const files = fs.readdirSync(thumbDir);
      const match = files.find(f => f.startsWith(`${localId}_`));
      if (match) {
        const data = fs.readFileSync(path.join(thumbDir, match)).toString("base64");
        return {
          type: "image",
          data,
          format: "jpeg",
          filename: `msg_${localId}.jpg`,
        };
      }
    }
  }

  // It's an image message but thumbnail hasn't been cached by WeChat yet
  return { type: "image", format: "jpeg", filename: `msg_${localId}.jpg` };
}

/**
 * Get emoji CDN URL from emoticon.db.
 *
 * Extracts md5 from message XML, looks up CDN URL in emoticon.db.
 */
export function getEmojiMedia(
  accountDir: string,
  keys: Record<string, string>,
  chatId: string,
  localId: number,
): MediaResult {
  const msgKey = keys["message_0.db"];
  const emoticonKey = keys["emoticon.db"];
  if (!msgKey) return { type: "unsupported", format: "", filename: "" };

  const msg = lookupMessage(accountDir, msgKey, chatId, localId);
  if (!msg) return { type: "unsupported", format: "", filename: "" };

  // Decode and extract md5 from XML
  let content = decodeContent(msg.hex_content, msg.is_compressed);

  // Strip group sender prefix if present
  const nlIndex = content.indexOf(":\n");
  if (nlIndex !== -1 && nlIndex < 80) {
    content = content.slice(nlIndex + 2);
  }

  const md5Match = content.match(/md5="([a-f0-9]+)"/i);
  if (!md5Match) {
    return { type: "unsupported", format: "", filename: "" };
  }
  const md5 = md5Match[1];

  // Look up CDN URL from emoticon.db
  if (emoticonKey) {
    const emoticonDbPath = getDbPath(accountDir, "emoticon.db");
    const rows = queryWechatDb(
      emoticonDbPath,
      emoticonKey,
      `SELECT cdn_url FROM kNonStoreEmoticonTable WHERE md5 = '${md5}' LIMIT 1;`,
    ) as unknown as { cdn_url: string }[];

    if (rows.length > 0 && rows[0].cdn_url) {
      return {
        type: "emoji",
        url: rows[0].cdn_url,
        format: "gif",
        filename: `emoji_${md5}.gif`,
      };
    }
  }

  // Fallback: extract cdnurl directly from message XML
  const cdnMatch = content.match(/cdnurl="(https?:\/\/[^"]+)"/i);
  if (cdnMatch) {
    return {
      type: "emoji",
      url: cdnMatch[1],
      format: "gif",
      filename: `emoji_${md5}.gif`,
    };
  }

  return {
    type: "emoji",
    format: "unknown",
    filename: `emoji_${md5}`,
  };
}

/**
 * Get voice data from media_0.db.
 *
 * Voice messages are stored as SILK_V3 BLOBs in the VoiceInfo table.
 */
export function getVoiceData(
  accountDir: string,
  keys: Record<string, string>,
  chatId: string,
  localId: number,
): MediaResult {
  const mediaKey = keys["media_0.db"];
  if (!mediaKey) return { type: "unsupported", format: "", filename: "" };

  const mediaDbPath = getDbPath(accountDir, "media_0.db");

  // Map chatId to Name2Id integer
  const nameRows = queryWechatDb(
    mediaDbPath,
    mediaKey,
    `SELECT rowid FROM Name2Id WHERE user_name = '${chatId.replace(/'/g, "''")}';`,
  ) as unknown as { rowid: number }[];

  if (nameRows.length === 0) return { type: "unsupported", format: "", filename: "" };
  const chatNameId = nameRows[0].rowid;

  // Fetch voice data as hex
  const voiceRows = queryWechatDb(
    mediaDbPath,
    mediaKey,
    `SELECT hex(voice_data) as hex_data, length(voice_data) as size
     FROM VoiceInfo
     WHERE chat_name_id = ${chatNameId} AND local_id = ${localId}
     LIMIT 1;`,
  ) as unknown as { hex_data: string; size: number }[];

  if (voiceRows.length === 0 || !voiceRows[0].hex_data) {
    return { type: "unsupported", format: "", filename: "" };
  }

  const data = Buffer.from(voiceRows[0].hex_data, "hex").toString("base64");
  return {
    type: "voice",
    data,
    format: "silk",
    filename: `msg_${localId}.silk`,
  };
}

/**
 * Get media for a message, dispatching by type.
 */
export function getMessageMedia(
  accountDir: string,
  keys: Record<string, string>,
  chatId: string,
  localId: number,
): MediaResult {
  const msgKey = keys["message_0.db"];
  if (!msgKey) return { type: "unsupported", format: "", filename: "" };

  const msg = lookupMessage(accountDir, msgKey, chatId, localId);
  if (!msg) return { type: "unsupported", format: "", filename: "" };

  const base = msg.local_type & 0xFFFFFFFF;

  switch (base) {
    case 3:  // image
      return getImageThumbnail(accountDir, keys, chatId, localId);
    case 34: // voice
      return getVoiceData(accountDir, keys, chatId, localId);
    case 47: // emoji
      return getEmojiMedia(accountDir, keys, chatId, localId);
    default: {
      // For other types (e.g. appmsg links), check if a cached thumbnail exists
      const thumb = getImageThumbnail(accountDir, keys, chatId, localId);
      if (thumb.data) return thumb;
      return { type: "unsupported", format: "", filename: "" };
    }
  }
}
