import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";

const chats = [
  { id: "a", displayName: "Alice", avatarUrl: null, lastMessagePreview: "hello", unreadCount: 2, isGroup: false, raw: {} },
  { id: "b", displayName: "群聊", avatarUrl: null, lastMessagePreview: "file", unreadCount: 0, isGroup: true, raw: {} }
];

const messages = [
  { id: "1", localId: 1, chatId: "a", senderName: "Alice", direction: "in", type: "text", text: "hello", timestamp: "2026-01-01T00:00:00.000Z", raw: {} },
  { id: "2", localId: 2, chatId: "a", senderName: "Alice", direction: "in", type: "unknown", text: "???", timestamp: "2026-01-01T00:00:00.000Z", raw: { type: 999 } }
];

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

function mockFetch(sendOk = false) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/session") return new Response(JSON.stringify({ passwordEnabled: false, authenticated: true }));
    if (url === "/api/status") return new Response(JSON.stringify({ agentReachable: true, loggedIn: true, status: "logged_in", checkedAt: "now" }));
    if (url.startsWith("/api/chats?")) return new Response(JSON.stringify(chats));
    if (url.includes("/messages")) return new Response(JSON.stringify(messages));
    if (url.includes("/send") && init?.method === "POST") {
      return new Response(JSON.stringify(sendOk ? { ok: true, status: "sent" } : { ok: false, status: "failed", error: "send failed" }));
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  });
}

describe("App", () => {
  it("renders chat list and messages", async () => {
    mockFetch();
    render(<App />);
    expect((await screen.findAllByText("Alice")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("hello")).length).toBeGreaterThan(0);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("unknown")).toBeInTheDocument();
  });

  it("filters chats", async () => {
    mockFetch();
    render(<App />);
    await screen.findAllByText("Alice");
    await userEvent.type(screen.getByLabelText("聊天搜索"), "群");
    const chatList = screen.getByLabelText("聊天列表");
    expect(within(chatList).getByText("群聊")).toBeInTheDocument();
    expect(within(chatList).queryByText("Alice")).not.toBeInTheDocument();
  });

  it("shows send failure and retry", async () => {
    mockFetch(false);
    render(<App />);
    await screen.findAllByText("Alice");
    await userEvent.type(screen.getByLabelText("消息输入"), "test");
    const sendButton = screen.getByRole("button", { name: /发送/ });
    await waitFor(() => expect(sendButton).not.toBeDisabled());
    fireEvent.click(sendButton);
    expect(await screen.findByText(/发送失败/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});
