import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import { Download, File as FileIcon, Image, LogIn, LogOut, Plus, RefreshCw, Search, Send, Trash2, X } from "lucide-react";
import type { ChatDto, MessageDto, SendResponse, ServerFileDto, SessionDto, StatusDto } from "@wechat-web/shared";
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
  return Boolean(chat.id) && chat.id !== "brandsessionholder";
}

function chatKindLabel(chat?: ChatDto): string {
  if (!chat) return "单聊";
  if (chat.kind === "group") return "群聊";
  if (chat.kind === "official") return "公众号";
  if (chat.kind === "service") return "服务通知";
  if (chat.kind === "openim") return "OpenIM";
  if (chat.kind === "system") return "系统";
  return "单聊";
}

function chatListKindLabel(chat: ChatDto): string {
  if (chat.kind === "official") return "公众号";
  if (chat.kind === "service") return "服务";
  if (chat.kind === "openim") return "OpenIM";
  return "";
}

function canSendToChat(chat?: ChatDto): boolean {
  return Boolean(chat && !["official", "service", "system"].includes(chat.kind));
}

function statusLabel(status?: string): string {
  if (status === "phone_confirm") return "等待手机确认";
  if (status === "qr_pending") return "等待扫码";
  if (status === "login_account") return "等待点击登录";
  if (status === "login_loading") return "登录中";
  if (status === "logged_out") return "未登录";
  return status || "unknown";
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function fileKind(file: ServerFileDto): "image" | "video" | "file" {
  if (file.contentType.startsWith("image/") || file.sourcePathHint.includes("/Img/")) return "image";
  if (file.contentType.startsWith("video/") || file.sourcePathHint.includes("msg/video/")) return "video";
  return "file";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",").pop() || "" : result);
    };
    reader.readAsDataURL(file);
  });
}

type LoginEvent =
  | { type: "status"; message?: string }
  | { type: "qr"; qrDataUrl?: string; qrData?: string }
  | { type: "phone_confirm"; message?: string }
  | { type: "login_success"; userId?: string }
  | { type: "login_timeout" }
  | { type: "error"; message?: string }
  | { type: "done" };

type ClearedUnreadMarker = {
  lastMsgLocalId?: number;
  lastMessageTime?: string;
};

const CLEARED_UNREADS_STORAGE_KEY = "wechat-web:cleared-unreads:v1";

function readClearedUnreads(): Map<string, ClearedUnreadMarker> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CLEARED_UNREADS_STORAGE_KEY) || "{}") as Record<string, ClearedUnreadMarker>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function writeClearedUnreads(markers: Map<string, ClearedUnreadMarker>) {
  try {
    window.localStorage.setItem(CLEARED_UNREADS_STORAGE_KEY, JSON.stringify(Object.fromEntries(markers)));
  } catch {
    // localStorage can be unavailable in private or restricted browser contexts.
  }
}

function clearedMarkerFor(chat: ChatDto): ClearedUnreadMarker {
  return {
    lastMsgLocalId: chat.lastMsgLocalId,
    lastMessageTime: chat.lastMessageTime
  };
}

function shouldSuppressUnread(chat: ChatDto, marker?: ClearedUnreadMarker): boolean {
  if (!marker || chat.unreadCount <= 0) return false;
  if (chat.lastMsgLocalId !== undefined && marker.lastMsgLocalId !== undefined) {
    return chat.lastMsgLocalId <= marker.lastMsgLocalId;
  }
  if (chat.lastMessageTime && marker.lastMessageTime) {
    return Date.parse(chat.lastMessageTime) <= Date.parse(marker.lastMessageTime);
  }
  return false;
}

function messageTime(message: MessageDto): number {
  const parsed = Date.parse(message.timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isOptimisticMessage(message: MessageDto): boolean {
  return Boolean((message.raw as { optimistic?: boolean } | undefined)?.optimistic);
}

function realMessageMatchesOptimistic(real: MessageDto, optimistic: MessageDto): boolean {
  if (real.direction !== "out") return false;
  if (real.type !== optimistic.type) return false;
  if (optimistic.type === "text") return real.text === optimistic.text;
  if (optimistic.type === "file") return Boolean(optimistic.fileName && real.fileName === optimistic.fileName);
  if (optimistic.type === "image") return Math.abs(messageTime(real) - messageTime(optimistic)) < 120_000;
  return false;
}

function mergeWithPendingOptimistic(realMessages: MessageDto[], previousMessages: MessageDto[]): MessageDto[] {
  const now = Date.now();
  const pending = previousMessages.filter((message) => {
    if (!isOptimisticMessage(message)) return false;
    if (now - messageTime(message) > 120_000) return false;
    return !realMessages.some((real) => realMessageMatchesOptimistic(real, message));
  });
  return [...realMessages, ...pending].sort((a, b) => messageTime(a) - messageTime(b) || Number(a.localId || 0) - Number(b.localId || 0));
}

function MessageView({ message }: { message: MessageDto }) {
  const mediaUrl = message.mediaLocalId ? api.mediaUrl(message.chatId, message.mediaLocalId) : "";
  const [mediaError, setMediaError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  async function downloadFile() {
    if (!mediaUrl || downloading) return;
    setDownloading(true);
    setMediaError("");
    try {
      let response: Response | null = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        response = await fetch(mediaUrl, { credentials: "include" });
        if (response.status !== 202) break;
        if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, 1500 * (attempt + 1)));
      }
      if (!response) throw new Error("下载失败");
      if (response.status === 202) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.code === "MEDIA_PENDING" ? "文件尚未下载到本机微信，请稍后再试" : body?.error || "文件尚未准备好");
      }
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `下载失败 (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = message.fileName || message.text || String(message.localId || "download");
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
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
        {message.type === "file" && mediaUrl && <button className="file-link" disabled={downloading} onClick={() => void downloadFile()}><Download size={16} />{downloading ? "下载中..." : message.fileName || message.text || "下载文件"}{!downloading && message.fileSize ? ` (${message.fileSize} bytes)` : ""}</button>}
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
  const [serverFiles, setServerFiles] = useState<ServerFileDto[]>([]);
  const [selectedChatId, setSelectedChatId] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [filesError, setFilesError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [fileSort, setFileSort] = useState<"time" | "name" | "size" | "type">("time");
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [lastSend, setLastSend] = useState<{ text: string; result?: SendResponse; error?: string } | null>(null);
  const [loginRunning, setLoginRunning] = useState(false);
  const [loginQr, setLoginQr] = useState("");
  const [loginMessage, setLoginMessage] = useState("");
  const [nearBottom, setNearBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const selectedChatIdRef = useRef("");
  const clearedUnreadMarkersRef = useRef(readClearedUnreads());
  const loginSourceRef = useRef<EventSource | null>(null);
  const selectedChat = chats.find((chat) => chat.id === selectedChatId);
  const loggedIn = status?.loggedIn === true;
  const statusDetail = loggedIn ? (status?.loggedInUser || statusLabel(status?.status)) : statusLabel(status?.status);
  const composerDisabled = sending || !loggedIn || !selectedChatId || !canSendToChat(selectedChat) || status?.automationReady === false;
  const sortedServerFiles = useMemo(() => {
    return [...serverFiles].sort((a, b) => {
      if (fileSort === "name") return a.filename.localeCompare(b.filename, "zh-Hans-CN");
      if (fileSort === "size") return b.size - a.size;
      if (fileSort === "type") return fileKind(a).localeCompare(fileKind(b)) || a.filename.localeCompare(b.filename, "zh-Hans-CN");
      return Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt);
    });
  }, [serverFiles, fileSort]);

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
      const selectedId = selectedChatIdRef.current;
      const next = (await api.chats())
        .filter(isRegularChat)
        .map((chat) => {
          if (chat.id === selectedId) {
            clearedUnreadMarkersRef.current.set(chat.id, clearedMarkerFor(chat));
            return { ...chat, unreadCount: 0 };
          }
          return shouldSuppressUnread(chat, clearedUnreadMarkersRef.current.get(chat.id)) ? { ...chat, unreadCount: 0 } : chat;
        });
      if (selectedId) writeClearedUnreads(clearedUnreadMarkersRef.current);
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

  async function refreshMessages(): Promise<MessageDto[]> {
    if (!selectedChatId) return [];
    try {
      const next = await api.messages(selectedChatId);
      setMessages((prev) => {
        const merged = mergeWithPendingOptimistic(next, prev);
        if (prev.length && merged.length > prev.length && !nearBottom) setHasNew(true);
        return merged;
      });
      setError("");
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  function appendOptimisticMessage(message: Omit<MessageDto, "id" | "timestamp" | "direction" | "chatId" | "senderName" | "raw"> & { text?: string }) {
    if (!selectedChatId) return;
    const optimistic: MessageDto = {
      id: `optimistic-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      chatId: selectedChatId,
      direction: "out",
      senderName: "我",
      timestamp: new Date().toISOString(),
      raw: { optimistic: true },
      ...message
    };
    setMessages((items) => [...items, optimistic]);
    setNearBottom(true);
  }

  async function refreshMessagesAfterSend(previousCount: number) {
    for (const delay of [300, 900, 1800, 3200]) {
      await new Promise((resolve) => window.setTimeout(resolve, delay));
      const next = await refreshMessages();
      if (next.length > previousCount) break;
    }
    await refreshChats();
  }

  async function refreshServerFiles() {
    setLoadingFiles(true);
    setFilesError("");
    try {
      setServerFiles(await api.files());
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingFiles(false);
    }
  }

  async function sendText(sendValue?: string): Promise<boolean> {
    const source = sendValue ?? (text || composerRef.current?.value || "");
    const trimmed = source.trim();
    if (!loggedIn || !selectedChatId || !trimmed || sending || !canSendToChat(selectedChat)) return false;
    setSending(true);
    setLastSend(null);
    try {
      const result = await api.sendText(selectedChatId, trimmed);
      setLastSend({ text: trimmed, result });
      if (result.status === "failed") setError(result.error || "发送失败");
      if (result.status !== "failed") {
        appendOptimisticMessage({ type: "text", text: trimmed });
      }
      setText("");
      if (composerRef.current) composerRef.current.value = "";
      void refreshMessagesAfterSend(messages.length);
      return result.status !== "failed";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLastSend({ text: trimmed, error: message });
      setError(message);
      return false;
    } finally {
      setSending(false);
    }
  }

  async function sendAttachment(file: File, kind: "image" | "file") {
    if (!loggedIn || !selectedChatId || sending || !canSendToChat(selectedChat)) return;
    setSending(true);
    setLastSend(null);
    try {
      const pendingText = (text || composerRef.current?.value || "").trim();
      if (pendingText) {
        const textResult = await api.sendText(selectedChatId, pendingText);
        if (textResult.status === "failed") {
          setLastSend({ text: pendingText, result: textResult });
          setError(textResult.error || "发送失败");
          return;
        }
        setText("");
        if (composerRef.current) composerRef.current.value = "";
      }
      const data = await fileToBase64(file);
      const result = kind === "image"
        ? await api.sendImage(selectedChatId, data, file.type || "image/png")
        : await api.sendFile(selectedChatId, data, file.name || "file");
      setLastSend({ text: file.name || (kind === "image" ? "[图片]" : "[文件]"), result });
      if (result.status === "failed") setError(result.error || "发送失败");
      if (result.status !== "failed") {
        appendOptimisticMessage(kind === "image"
          ? { type: "image", text: file.name || "[图片]" }
          : { type: "file", fileName: file.name || "file", fileSize: file.size });
      }
      void refreshMessagesAfterSend(messages.length);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLastSend({ text: file.name, error: message });
      setError(message);
    } finally {
      setSending(false);
      setUploadMenuOpen(false);
    }
  }

  async function deleteServerFile(id: string) {
    try {
      const result = await api.deleteFile(id);
      if (!result.ok) throw new Error(result.error || "删除失败");
      setServerFiles((files) => files.filter((file) => file.id !== id));
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : String(err));
    }
  }

  function selectChat(chat: ChatDto) {
    selectedChatIdRef.current = chat.id;
    clearedUnreadMarkersRef.current.set(chat.id, clearedMarkerFor(chat));
    writeClearedUnreads(clearedUnreadMarkersRef.current);
    setSelectedChatId(chat.id);
    setHasNew(false);
    setChats((items) => items.map((item) => item.id === chat.id ? { ...item, unreadCount: 0 } : item));
    void api.openChat(chat.id, true)
      .then(() => refreshChats())
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files || []);
    if (!files.length) return;
    event.preventDefault();
    const first = files[0]!;
    void sendAttachment(first, first.type.startsWith("image/") ? "image" : "file");
  }

  function startWechatLogin(newAccount = false) {
    loginSourceRef.current?.close();
    setLoginRunning(true);
    setLoginQr("");
    setLoginMessage("正在打开微信登录...");
    setError("");

    const source = new EventSource(api.wechatLoginEventsUrl(newAccount), { withCredentials: true });
    loginSourceRef.current = source;
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as LoginEvent;
      if (data.type === "status") setLoginMessage(data.message || "正在登录...");
      if (data.type === "qr") {
        setLoginQr(data.qrDataUrl || "");
        setLoginMessage("请用手机微信扫码确认登录");
      }
      if (data.type === "phone_confirm") setLoginMessage(data.message || "请在手机微信上确认登录");
      if (data.type === "login_success") {
        setLoginMessage(data.userId ? `已登录：${data.userId}` : "已登录");
        setLoginRunning(false);
        source.close();
        void refreshStatus();
        void refreshChats();
      }
      if (data.type === "login_timeout") {
        setLoginMessage("登录超时，请重试");
        setLoginRunning(false);
        source.close();
      }
      if (data.type === "error") {
        setLoginMessage(data.message || "登录失败");
        setLoginRunning(false);
        source.close();
      }
      if (data.type === "done") {
        setLoginRunning(false);
        source.close();
      }
    };
    source.onerror = () => {
      setLoginRunning(false);
      setLoginMessage("登录连接中断");
      source.close();
    };
  }

  useEffect(() => {
    api.session().then(setSession).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    return () => loginSourceRef.current?.close();
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

  useEffect(() => {
    if (filesOpen) void refreshServerFiles();
  }, [filesOpen]);

  return (
    <>
      <LoginGate session={session} onLogin={() => api.session().then(setSession)} />
      <div className="shell">
        <aside className="sidebar">
          <div className="status-line">
            <div>
              <strong>{status?.loggedIn ? "已登录" : "未登录"}</strong>
              <span>{statusDetail}</span>
            </div>
            <button title="刷新" onClick={() => { void refreshStatus(); void refreshChats(); }}><RefreshCw size={18} /></button>
            {session.passwordEnabled && <button title="退出" onClick={() => api.logout().then(setSession)}><LogOut size={18} /></button>}
          </div>
          <ErrorBanner error={error || status?.error} />
          {!status?.loggedIn && (
            <div className="wechat-login-card">
              <button disabled={loginRunning} onClick={() => startWechatLogin(false)}><LogIn size={16} />{loginRunning ? "登录中" : "登录微信"}</button>
              <button disabled={loginRunning} onClick={() => startWechatLogin(true)}>切换账号</button>
              {loginMessage && <span>{loginMessage}</span>}
              {loginQr && <img src={loginQr} alt="微信登录二维码" />}
            </div>
          )}
          <label className="search"><Search size={16} /><input aria-label="聊天搜索" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索聊天" /></label>
          <div className="files-toolbar">
            <button onClick={() => setFilesOpen(true)}><FileIcon size={16} />服务器文件</button>
          </div>
          <div className="chat-list" aria-label="聊天列表">
            {filteredChats.map((chat) => (
              <button key={chat.id} className={`chat-item ${chat.id === selectedChatId ? "active" : ""}`} onClick={() => selectChat(chat)}>
                <div><strong>{chat.displayName}{chatListKindLabel(chat) && <small>{chatListKindLabel(chat)}</small>}</strong><span>{chat.lastMessagePreview || ""}</span></div>
                {chat.unreadCount > 0 && <em>{chat.unreadCount}</em>}
              </button>
            ))}
          </div>
        </aside>
        <main className="conversation">
          <header><h2>{selectedChat?.displayName || "选择聊天"}</h2><span>{chatKindLabel(selectedChat)}</span></header>
          {!status?.loggedIn && !selectedChat && (
            <div className="empty-state">
              <h3>登录微信</h3>
              <p>{loginMessage || "在网页里启动登录流程，二维码会显示在左侧。"}</p>
              {loginQr && <img src={loginQr} alt="微信登录二维码" />}
              <div>
                <button disabled={loginRunning} onClick={() => startWechatLogin(false)}><LogIn size={17} />{loginRunning ? "登录中" : "登录微信"}</button>
                <button disabled={loginRunning} onClick={() => startWechatLogin(true)}>切换账号</button>
              </div>
            </div>
          )}
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
            <div className="attach-control">
              <button type="button" className="attach-button" disabled={composerDisabled} onClick={() => setUploadMenuOpen((open) => !open)}><Plus size={18} /></button>
              {uploadMenuOpen && (
                <div className="attach-menu">
                  <button type="button" onClick={() => fileInputRef.current?.click()}><FileIcon size={16} />发送文件</button>
                  <button type="button" onClick={() => imageInputRef.current?.click()}><Image size={16} />发送图片</button>
                </div>
              )}
              <input ref={fileInputRef} className="hidden-input" type="file" onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void sendAttachment(file, "file");
              }} />
              <input ref={imageInputRef} className="hidden-input" type="file" accept="image/*" onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void sendAttachment(file, "image");
              }} />
            </div>
            <textarea
              aria-label="消息输入"
              ref={composerRef}
              disabled={composerDisabled}
              onChange={(event) => setText(event.target.value)}
              onInput={(event) => setText(event.currentTarget.value)}
              onPaste={handlePaste}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendText();
                }
              }}
              placeholder={!loggedIn ? "微信未登录，登录后可发送" : status?.automationReady === false ? "微信窗口暂不可操作，暂不能发送" : selectedChat && !canSendToChat(selectedChat) ? "当前会话只读，不能发送消息" : "输入消息，或 Ctrl+V 粘贴图片/文件"}
            />
            <button disabled={composerDisabled} onClick={() => void sendText()}><Send size={18} />{sending ? "发送中" : "发送"}</button>
          </footer>
          {selectedChat && !canSendToChat(selectedChat) && <div className="readonly-hint">当前会话为{chatKindLabel(selectedChat)}，暂不支持发送，只能查看。</div>}
          {!loggedIn && <div className="readonly-hint">微信未登录，当前只能查看已缓存文件和历史消息。</div>}
          {status?.automationReady === false && <div className="readonly-hint">微信窗口暂不可操作，发送和清红点暂不可用；文件浏览和已缓存下载仍可使用。</div>}
          {(lastSend?.error || lastSend?.result?.status === "failed") && (
            <div className="send-error">发送失败：{lastSend.error || lastSend.result?.error || "agent 返回发送失败"}<button onClick={() => void sendText(lastSend.text)}>重试</button></div>
          )}
          {lastSend?.result?.status === "uncertain" && <div className="send-info">已提交，正在同步最新消息<button onClick={() => void refreshMessages()}>刷新消息</button></div>}
        </main>
      </div>
      {filesOpen && (
        <div className="file-manager-backdrop" role="dialog" aria-modal="true" aria-label="服务器文件管理">
          <section className="file-manager">
            <header>
              <div>
                <h3>服务器文件</h3>
                <span>{serverFiles.length} 个已缓存文件</span>
              </div>
              <div className="file-manager-actions">
                <select aria-label="文件排序" value={fileSort} onChange={(event) => setFileSort(event.target.value as typeof fileSort)}>
                  <option value="time">按时间</option>
                  <option value="type">按类型</option>
                  <option value="name">按名称</option>
                  <option value="size">按大小</option>
                </select>
                <button title="刷新" disabled={loadingFiles} onClick={() => void refreshServerFiles()}><RefreshCw size={16} /></button>
                <button title="关闭" onClick={() => setFilesOpen(false)}><X size={18} /></button>
              </div>
            </header>
            {filesError && <div className="mini-error">{filesError}</div>}
            {loadingFiles && <div className="file-empty">加载中...</div>}
            {!loadingFiles && sortedServerFiles.length === 0 && <div className="file-empty">暂无已缓存文件</div>}
            <div className="file-table">
              {sortedServerFiles.map((file) => (
                <div key={file.id} className="file-table-row">
                  <div>
                    <strong>{file.filename}</strong>
                    <span>{formatBytes(file.size)} · {new Date(file.modifiedAt).toLocaleString()} · {fileKind(file)}</span>
                    <small>{file.sourcePathHint}</small>
                  </div>
                  <a title="下载" href={api.fileDownloadUrl(file.id)}><Download size={16} /></a>
                  <button title="删除" onClick={() => void deleteServerFile(file.id)}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
