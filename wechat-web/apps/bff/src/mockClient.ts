import type { AgentChat, AgentClient, AgentMedia, AgentMessage, AgentSendResult } from "./types.js";

const now = new Date().toISOString();

const chats: AgentChat[] = [
  { id: "filehelper", username: "filehelper", name: "文件传输助手", lastMessagePreview: "这是一条 mock 消息", lastActivityAt: now, unreadCount: 0, isGroup: false },
  { id: "room@chatroom", username: "room@chatroom", name: "项目讨论群", lastMessagePreview: "Alice: 明天看一下 UI", lastActivityAt: now, unreadCount: 3, isGroup: true }
];

let messages: AgentMessage[] = [
  { localId: 1, serverId: 1001, chatId: "filehelper", sender: "me", senderName: "我", type: 1, content: "这是一条 mock 消息", timestamp: now, isSelf: true },
  { localId: 2, serverId: 1002, chatId: "filehelper", sender: "filehelper", senderName: "文件传输助手", type: 3, content: "[图片]", timestamp: now, isSelf: false },
  { localId: 3, serverId: 1003, chatId: "room@chatroom", sender: "alice", senderName: "Alice", type: 1, content: "明天看一下 UI", timestamp: now, isSelf: false },
  { localId: 4, serverId: 1004, chatId: "room@chatroom", sender: "bob", senderName: "Bob", type: 49, content: "<appmsg><title><![CDATA[demo.pdf]]></title><totallen>2048</totallen></appmsg>", timestamp: now, isSelf: false }
];

export class MockAgentClient implements AgentClient {
  async authStatus(): Promise<unknown> {
    return { status: "logged_in", loggedInUser: "Mock User" };
  }

  async listChats(limit: number, offset: number): Promise<AgentChat[]> {
    return chats.slice(offset, offset + limit);
  }

  async listMessages(chatId: string, limit: number, offset: number): Promise<AgentMessage[]> {
    return messages.filter((message) => message.chatId === chatId).slice(offset, offset + limit);
  }

  async getMedia(_chatId: string, localId: string): Promise<AgentMedia> {
    if (localId === "4") {
      return { type: "file", format: "application/pdf", filename: "demo.pdf", data: Buffer.from("mock pdf").toString("base64") };
    }
    return {
      type: "image",
      format: "image/svg+xml",
      filename: "mock-image.svg",
      data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#f1f5f9"/><text x="40" y="95" font-size="24" fill="#0f172a">Mock image</text></svg>').toString("base64")
    };
  }

  async sendMessage(chatId: string, text: string): Promise<AgentSendResult> {
    const localId = Math.max(...messages.map((message) => message.localId)) + 1;
    messages = [
      ...messages,
      { localId, serverId: 1000 + localId, chatId, sender: "me", senderName: "我", type: 1, content: text, timestamp: new Date().toISOString(), isSelf: true }
    ];
    return { success: true };
  }

  async screenshot(): Promise<unknown> {
    return { base64: "" };
  }

  async a11y(): Promise<unknown> {
    return { tree: { mock: true }, aria: "mock accessibility tree" };
  }
}
