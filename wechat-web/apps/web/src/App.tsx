import { useEffect, useMemo, useRef, useState } from "react";
import { Download, LogOut, RefreshCw, Search, Send } from "lucide-react";
import type { ChatDto, MessageDto, SendResponse, SessionDto, StatusDto } from "@wechat-web/shared";
import { api } from "./api.js";

function usePolling(callback: () => void, interval: number, deps: unknown[]): void {
  useEffect(() => {
    callback();
    const id = window.setInterval(callback, interval);
    return () => window.clearInterval(id);
  }, deps);
}

function ErrorBanner({ error }: { error?: string }) {
  if (!error) return null;
  return <div className="error-banner">{error}</div>;
}

function LoginGate({ session, onLogin }: { session: SessionDto; onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  if (!session.passwordEnabled || session.authenticated) return null;
  return (
    <div className="login-screen">
      <form
        className="login-panel"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          try {
            await api.login(password);
            onLogin();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      >
        <h1>wechat-web</h1>
        <input aria-label="访问密码" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
        <button type="submit">进入</button>
        <ErrorBanner error={error} />
      </form>
    </div>
  );
}

function isRegularChat(chat: ChatDto): boolean {
  return Boolean(chat.id) && !chat.id.startsWith("gh_") && chat.id !== "brandsessionholder";
}

function MessageView({ message }: { message: MessageDto }) {
  const mediaUrl = message.mediaLocalId ? api.mediaUrl(message.chatId, message.mediaLocalId) : "";
  const [mediaError, setMediaError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  async function downloadFile() {
    if (!mediaUrl) return;
    setMediaError("");
    try {
      const response = await fetch(mediaUrl, { credentials: "include" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `下载失败 (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = message.fileName || message.text || String(message.localId || "download");
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : String(err));
    }
  }
  if (message.type === "system") {
    return (
      <div className="system-message">
        <span>{message.text}</span>
        <time>{new Date(message.timestamp).toLocaleString()}</time>
      </div>
    );
  }
  return (
    <div className={`message-row ${message.direction === "out" ? "out" : "in"}`}>
      <div className="message-meta">{message.senderName || message.senderId || (message.direction === "out" ? "我" : "对方")}</div>
      <div className={`bubble ${message.type}`}>
        {message.type === "text" && <div className="message-text">{message.text}</div>}
        {message.type === "image" && mediaUrl && !mediaError && <button className="image-button" onClick={() => setPreviewOpen(true)}><img src={mediaUrl} alt="图片消息" onError={() => setMediaError("媒体暂不可用")} /></button>}
        {message.type === "image" && (!mediaUrl || mediaError) && <div className="media-unavailable">{mediaError || "图片暂不可用"}</div>}
        {message.type === "file" && mediaUrl && <button className="file-link" onClick={() => void downloadFile()}><Download size={16} />{message.fileName || message.text || "下载文件"}{message.fileSize ? ` (${message.fileSize} bytes)` : ""}</button>}
        {message.type === "file" && !mediaUrl && <div className="media-unavailable">{message.fileName || message.text || "文件暂不可用"}</div>}
        {message.type === "file" && mediaError && <div className="media-unavailable">{mediaError}</div>}
        {message.type === "voice" && <audio controls src={mediaUrl} />}
        {message.type === "video" && <video controls src={mediaUrl} />}
        {message.type === "unknown" && <details><summary>unknown</summary><pre>{JSON.stringify(message.raw, null, 2)}</pre></details>}
      </div>
      <time>{new Date(message.timestamp).toLocaleString()}</time>
      {previewOpen && (
        <div className="image-preview" role="dialog" aria-modal="true" onClick={() => setPreviewOpen(false)}>
          <button className="image-preview-close" aria-label="关闭图片预览" onClick={() => setPreviewOpen(false)}>×</button>
          <img src={mediaUrl} alt="图片预览" onClick={(event) => event.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<SessionDto>({ passwordEnabled: false, authenticated: true });
  const [status, setStatus] = useState<StatusDto | null>(null);
  const [chats, setChats] = useState<ChatDto[]>([]);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [selectedChatId, setSelectedChatId] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [lastSend, setLastSend] = useState<{ text: string; result?: SendResponse; error?: string } | null>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedChatIdRef = useRef("");
  const selectedChat = chats.find((chat) => chat.id === selectedChatId);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  const filteredChats = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return chats;
    return chats.filter((chat) => chat.displayName.toLowerCase().includes(needle) || chat.lastMessagePreview?.toLowerCase().includes(needle));
  }, [chats, query]);

  async function refreshStatus() {
    try {
      setStatus(await api.status());
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refreshChats() {
    try {
      const next = (await api.chats()).filter(isRegularChat);
      setChats(next);
      setError("");
      if (!selectedChatIdRef.current && next[0]) {
        selectedChatIdRef.current = next[0].id;
        setSelectedChatId(next[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refreshMessages() {
    if (!selectedChatId) return;
    try {
      const next = await api.messages(selectedChatId);
      setMessages((prev) => {
        if (prev.length && next.length > prev.length && !nearBottom) setHasNew(true);
        return next;
      });
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function sendText(sendValue?: string) {
    const source = sendValue ?? (text || composerRef.current?.value || "");
    const trimmed = source.trim();
    if (!selectedChatId || !trimmed || sending) return;
    setSending(true);
    setLastSend(null);
    try {
      const result = await api.send(selectedChatId, trimmed);
      setLastSend({ text: trimmed, result });
      if (result.status === "failed") setError(result.error || "发送失败");
      setText("");
      if (composerRef.current) composerRef.current.value = "";
      await refreshMessages();
      await refreshChats();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLastSend({ text: trimmed, error: message });
      setError(message);
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    api.session().then(setSession).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  usePolling(() => {
    void refreshStatus();
    void refreshChats();
  }, 10_000, [session.authenticated]);

  useEffect(() => {
    void refreshMessages();
    const id = window.setInterval(() => void refreshMessages(), document.hasFocus() ? 2_000 : 10_000);
    return () => window.clearInterval(id);
  }, [selectedChatId, nearBottom]);

  useEffect(() => {
    if (nearBottom && messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
      setHasNew(false);
    }
  }, [messages, nearBottom]);

  return (
    <>
      <LoginGate session={session} onLogin={() => api.session().then(setSession)} />
      <div className="shell">
        <aside className="sidebar">
          <div className="status-line">
            <div>
              <strong>{status?.loggedIn ? "已登录" : "未登录"}</strong>
              <span>{status?.loggedInUser || status?.status || "unknown"}</span>
            </div>
            <button title="刷新" onClick={() => { void refreshStatus(); void refreshChats(); }}><RefreshCw size={18} /></button>
            {session.passwordEnabled && <button title="退出" onClick={() => api.logout().then(setSession)}><LogOut size={18} /></button>}
          </div>
          <ErrorBanner error={error || status?.error} />
          <label className="search"><Search size={16} /><input aria-label="聊天搜索" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索聊天" /></label>
          <div className="chat-list" aria-label="聊天列表">
            {filteredChats.map((chat) => (
              <button key={chat.id} className={`chat-item ${chat.id === selectedChatId ? "active" : ""}`} onClick={() => { selectedChatIdRef.current = chat.id; setSelectedChatId(chat.id); setHasNew(false); }}>
                <div><strong>{chat.displayName}</strong><span>{chat.lastMessagePreview || ""}</span></div>
                {chat.unreadCount > 0 && <em>{chat.unreadCount}</em>}
              </button>
            ))}
          </div>
        </aside>
        <main className="conversation">
          <header><h2>{selectedChat?.displayName || "选择聊天"}</h2><span>{selectedChat?.isGroup ? "群聊" : "单聊"}</span></header>
          <div
            className="messages"
            ref={messagesRef}
            onScroll={(event) => {
              const el = event.currentTarget;
              setNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
            }}
          >
            {messages.map((message) => <MessageView key={`${message.chatId}-${message.id}-${message.localId}`} message={message} />)}
          </div>
          {hasNew && <button className="new-message" onClick={() => { setNearBottom(true); setHasNew(false); }}>有新消息</button>}
          <footer className="composer">
            <textarea
              aria-label="消息输入"
              ref={composerRef}
              onChange={(event) => setText(event.target.value)}
              onInput={(event) => setText(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendText();
                }
              }}
              placeholder="输入消息"
            />
            <button disabled={sending || !selectedChatId} onClick={() => void sendText()}><Send size={18} />{sending ? "发送中" : "发送"}</button>
          </footer>
          {(lastSend?.error || lastSend?.result?.status === "failed") && (
            <div className="send-error">发送失败：{lastSend.error || lastSend.result?.error || "agent 返回发送失败"}<button onClick={() => void sendText(lastSend.text)}>重试</button></div>
          )}
          {lastSend?.result?.status === "uncertain" && <div className="send-error">已提交但未确认出现在最新消息中<button onClick={() => void sendText(lastSend.text)}>重试</button></div>}
        </main>
      </div>
    </>
  );
}
