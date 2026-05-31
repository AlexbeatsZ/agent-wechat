import { z } from "zod";

export const statusSchema = z.object({
  agentReachable: z.boolean(),
  loggedIn: z.boolean(),
  status: z.string(),
  loggedInUser: z.string().optional(),
  automationReady: z.boolean().optional(),
  checkedAt: z.string(),
  error: z.string().optional()
});

export const chatSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  kind: z.enum(["individual", "group", "official", "service", "openim", "system"]),
  lastMessagePreview: z.string().optional(),
  lastMessageTime: z.string().optional(),
  lastMsgLocalId: z.number().optional(),
  unreadCount: z.number(),
  isGroup: z.boolean(),
  raw: z.unknown()
});

export const messageTypeSchema = z.enum(["text", "image", "file", "voice", "video", "system", "unknown"]);
export const directionSchema = z.enum(["in", "out", "unknown"]);

export const messageSchema = z.object({
  id: z.string(),
  localId: z.number().optional(),
  chatId: z.string(),
  senderName: z.string().optional(),
  senderId: z.string().optional(),
  direction: directionSchema,
  type: messageTypeSchema,
  text: z.string().optional(),
  timestamp: z.string(),
  mediaLocalId: z.string().optional(),
  fileName: z.string().optional(),
  fileSize: z.number().optional(),
  raw: z.unknown()
});

export const sendRequestSchema = z.object({
  text: z.string().trim().min(1).max(5000).optional(),
  image: z.object({
    data: z.string().min(1),
    mimeType: z.string().min(1)
  }).optional(),
  file: z.object({
    data: z.string().min(1),
    filename: z.string().min(1)
  }).optional()
}).refine((value) => Boolean(value.text || value.image || value.file), "text, image, or file is required");

export const sendResponseSchema = z.object({
  ok: z.boolean(),
  status: z.enum(["sent", "uncertain", "failed"]),
  error: z.string().optional(),
  raw: z.unknown().optional()
});

export const sessionSchema = z.object({
  passwordEnabled: z.boolean(),
  authenticated: z.boolean()
});

export const serverFileSchema = z.object({
  id: z.string(),
  filename: z.string(),
  size: z.number(),
  modifiedAt: z.string(),
  sourcePathHint: z.string(),
  contentType: z.string()
});

export type StatusDto = z.infer<typeof statusSchema>;
export type ChatDto = z.infer<typeof chatSchema>;
export type MessageDto = z.infer<typeof messageSchema>;
export type MessageType = z.infer<typeof messageTypeSchema>;
export type Direction = z.infer<typeof directionSchema>;
export type SendRequest = z.infer<typeof sendRequestSchema>;
export type SendResponse = z.infer<typeof sendResponseSchema>;
export type SessionDto = z.infer<typeof sessionSchema>;
export type ServerFileDto = z.infer<typeof serverFileSchema>;
