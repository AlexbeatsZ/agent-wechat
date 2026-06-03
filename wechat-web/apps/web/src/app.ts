type ChatKind = "individual" | "group" | "official" | "service" | "system" | "openim" | "filehelper";

type ChatDto = {
  id: string;
  displayName: string;
  lastMessagePreview?: string;
  unreadCount: number;
  isGroup: boolean;
  kind: ChatKind;
  canSend: boolean;
};

type MessageDto = {
  id: string;
  localId: number;
  chatId: string;
  senderName?: string;
  senderId?: string;
  direction: "in" | "out" | "unknown";
  type: "text" | "image" | "file" | "voice" | "video" | "system" | "unknown";
  text?: string;
  timestamp: string;
  mediaLocalId?: string;
  fileName?: string;
  fileSize?: number;
};

type ServerFileDto = {
  id: string;
  filename: string;
  size: number;
  modifiedAt: string;
  sourcePathHint: string;
  contentType: string;
};

type StatusDto = {
  agentReachable: boolean;
  loggedIn: boolean;
  status: string;
  loggedInUser?: string;
  error?: string;
};

const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("root missing");
const appRoot = root;

const state: {
  status: StatusDto | null;
  chats: ChatDto[];
  selectedChatId: string;
  messages: MessageDto[];
  error: string;
  sending: boolean;
  filesOpen: boolean;
  attachMenuOpen: boolean;
  serverFiles: ServerFileDto[];
  loginQrDataUrl: string;
  loginMessage: string;
} = {
  status: null,
  chats: [],
  selectedChatId: "",
  messages: [],
  error: "",
  sending: false,
  filesOpen: false,
  attachMenuOpen: false,
  serverFiles: [],
  loginQrDataUrl: "",
  loginMessage: "",
};

function labelForKind(kind: ChatKind): string {
  return {
    individual: "好友",
    group: "群聊",
    official: "公众号",
    service: "服务通知",
    system: "系统",
    openim: "OpenIM",
    filehelper: "文件助手",
  }[kind] || kind;
}

function publicError(code?: string, message?: string): string {
  const labels: Record<string, string> = {
    CHAT_NOT_OPENED: "聊天未打开，请重新选择会话后再试",
    READONLY_CHAT: "当前会话不支持发送",
    INPUT_NOT_FOUND: "未找到微信输入框",
    SEND_BUTTON_NOT_FOUND: "未找到发送按钮",
    WECHAT_WINDOW_NOT_FOUND: "未找到微信窗口或未进入聊天页",
    PASTE_FAILED: "粘贴图片或文件失败",
    UPLOAD_FAILED: "上传或发送内容失败",
    TIMEOUT: "发送超时",
    AGENT_UNAVAILABLE: "agent-server 不可用",
    MEDIA_PENDING: "文件尚未下载到本机微信",
    PLAN_STUCK: "当前操作无法继续，请刷新微信窗口后重试",
    QR_DECODE_FAILED: "微信已进入扫码登录页，但二维码识别失败，请通过 VNC 查看或重新切换账号",
  };
  return (code && labels[code]) || message || "操作失败";
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(publicError(body?.code, body?.error));
  }
  return body as T;
}

async function refreshStatus(): Promise<void> {
  try {
    state.status = await api<StatusDto>("/api/status");
    if (state.status.loggedIn) {
      state.loginQrDataUrl = "";
      state.loginMessage = "";
    }
  } catch (error) {
    state.status = { agentReachable: false, loggedIn: false, status: "unknown", error: String(error) };
  }
  render();
}

async function pollLoginAfterQr(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
    await refreshStatus();
    if (state.status?.loggedIn) {
      await refreshChats();
      await refreshMessages();
      return;
    }
  }
}

async function startWechatLogin(newAccount = false): Promise<void> {
  state.error = "";
  state.loginMessage = "正在获取微信登录二维码";
  state.loginQrDataUrl = "";
  render();
  try {
    const result = await api<{ qrDataUrl?: string; state?: { status?: string }; success?: boolean; message?: string }>(
      "/api/wechat-login",
      { method: "POST", body: JSON.stringify({ newAccount }) },
    );
    state.loginQrDataUrl = result.qrDataUrl || "";
    state.loginMessage = result.qrDataUrl
      ? "请使用手机微信扫码登录"
      : result.message || result.state?.status || "登录流程已启动";
    if (result.state?.status === "qr_decode_failed") {
      state.error = publicError("QR_DECODE_FAILED", result.message);
    }
    await refreshStatus();
    if (result.qrDataUrl || ["phone_confirm", "loading"].includes(result.state?.status || "")) {
      void pollLoginAfterQr();
    }
  } catch (error) {
    state.loginMessage = "";
    state.error = error instanceof Error ? error.message : String(error);
  }
  render();
}

async function refreshChats(): Promise<void> {
  state.chats = await api<ChatDto[]>("/api/chats?limit=120&offset=0");
  if (!state.selectedChatId && state.chats[0]) state.selectedChatId = state.chats[0].id;
  if (state.selectedChatId && !state.chats.some((chat) => chat.id === state.selectedChatId)) {
    state.selectedChatId = state.chats[0]?.id || "";
  }
  render();
}

async function refreshMessages(): Promise<void> {
  if (!state.selectedChatId) return;
  state.messages = await api<MessageDto[]>(`/api/chats/${encodeURIComponent(state.selectedChatId)}/messages?limit=100&offset=0`);
  render();
  const list = document.querySelector(".messages");
  if (list) list.scrollTop = list.scrollHeight;
}

async function refreshAll(): Promise<void> {
  await refreshStatus();
  if (state.status?.loggedIn) {
    await refreshChats();
    await refreshMessages();
  }
}

function selectedChat(): ChatDto | undefined {
  return state.chats.find((chat) => chat.id === state.selectedChatId);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch] || ch));
}

function formatBytes(size?: number): string {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
    reader.readAsDataURL(file);
  });
}

async function sendPayload(payload: Record<string, unknown>, optimisticText?: string): Promise<void> {
  const chat = selectedChat();
  if (!chat) return;
  if (!chat.canSend) {
    state.error = publicError("READONLY_CHAT");
    render();
    return;
  }
  state.sending = true;
  state.error = "";
  if (optimisticText) {
    state.messages = [...state.messages, {
      id: `optimistic-${Date.now()}`,
      localId: Date.now(),
      chatId: chat.id,
      direction: "out",
      type: "text",
      text: optimisticText,
      timestamp: new Date().toISOString(),
    }];
    render();
  }
  try {
    const result = await api<{ ok: boolean; status: string; code?: string; error?: string }>(
      `/api/chats/${encodeURIComponent(chat.id)}/send`,
      { method: "POST", body: JSON.stringify(payload) },
    );
    if (!result.ok) throw new Error(publicError(result.code, result.error));
    await refreshMessages();
    window.setTimeout(() => void refreshMessages(), 1200);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.sending = false;
    render();
  }
}

async function sendText(): Promise<void> {
  const input = document.querySelector<HTMLTextAreaElement>("#composer-input");
  const text = input?.value.trim() || "";
  if (!text) return;
  if (input) input.value = "";
  await sendPayload({ type: "text", text }, text);
}

async function sendFile(file: File, asImage: boolean): Promise<void> {
  const base64 = await fileToBase64(file);
  await sendPayload({
    type: asImage ? "image" : "file",
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    base64,
  });
}

async function downloadMessage(message: MessageDto): Promise<void> {
  if (!message.mediaLocalId) return;
  state.error = "";
  const response = await fetch(`/api/chats/${encodeURIComponent(message.chatId)}/media/${encodeURIComponent(message.mediaLocalId)}`, { credentials: "include" });
  if (response.status === 202) {
    const body = await response.json().catch(() => ({}));
    state.error = publicError(body.code, body.error);
    render();
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    state.error = publicError(body.code, body.error);
    render();
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = message.fileName || `media-${message.localId}`;
  link.click();
  URL.revokeObjectURL(url);
}

async function loadServerFiles(): Promise<void> {
  state.filesOpen = true;
  state.serverFiles = await api<ServerFileDto[]>("/api/files?type=all&limit=200&offset=0");
  render();
}

function renderMessages(): string {
  if (!state.selectedChatId) return `<div class="empty-state">请选择左侧会话</div>`;
  if (!state.messages.length) return `<div class="empty-state">暂无消息，或正在读取微信数据库</div>`;
  return state.messages.map((message) => {
    const meta = escapeHtml(message.senderName || message.senderId || (message.direction === "out" ? "我" : "对方"));
    if (message.type === "system") return `<div class="system-message">${escapeHtml(message.text || "")}</div>`;
    const body = message.type === "file"
      ? `<button class="file-link" data-download="${message.localId}">下载 ${escapeHtml(message.fileName || "文件")} ${formatBytes(message.fileSize)}</button>`
      : message.type === "image"
        ? `<button class="file-link" data-download="${message.localId}">下载图片</button>`
        : `<div class="message-text">${escapeHtml(message.text || "")}</div>`;
    return `<div class="message-row ${message.direction === "out" ? "out" : "in"}"><div class="message-meta">${meta}</div><div class="bubble">${body}</div><time>${new Date(message.timestamp).toLocaleString()}</time></div>`;
  }).join("");
}

function render(): void {
  const chat = selectedChat();
  appRoot.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="status-line">
          <div><strong>${state.status?.loggedIn ? "已登录" : "未登录"}</strong><span>${escapeHtml(state.status?.loggedInUser || state.status?.status || "unknown")}</span></div>
          <button id="login-btn">${state.status?.loggedIn ? "刷新" : "登录微信"}</button>
        </div>
        ${!state.status?.loggedIn && (state.loginQrDataUrl || state.loginMessage) ? `
          <div class="login-qr-panel">
            ${state.loginQrDataUrl ? `<img src="${state.loginQrDataUrl}" alt="微信登录二维码">` : ""}
            <span>${escapeHtml(state.loginMessage)}</span>
            <button id="switch-login-btn">切换账号二维码</button>
          </div>` : ""}
        <div class="toolbar"><button id="server-files">服务器文件</button><button id="refresh">刷新</button></div>
        ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ""}
        <div class="chat-list">${state.chats.length ? state.chats.map((item) => `
          <button class="chat-item ${item.id === state.selectedChatId ? "active" : ""}" data-chat="${escapeHtml(item.id)}">
            <div><strong>${escapeHtml(item.displayName)}</strong><span>${escapeHtml(item.lastMessagePreview || "")}</span></div>
            <small>${labelForKind(item.kind)}${item.canSend ? "" : " / 只读"}</small>
            ${item.unreadCount ? `<em>${item.unreadCount}</em>` : ""}
          </button>`).join("") : `<div class="empty-state">暂无会话。若刚扫码登录，请稍等数据库密钥提取完成后刷新。</div>`}</div>
      </aside>
      <main class="conversation">
        <header><h2>${escapeHtml(chat?.displayName || "选择聊天")}</h2><span>${chat ? `${labelForKind(chat.kind)}${chat.canSend ? "" : " / 只读"}` : ""}</span></header>
        <div class="messages">${renderMessages()}</div>
        <footer class="composer ${chat && !chat.canSend ? "readonly" : ""}">
          ${chat && !chat.canSend ? `<div class="readonly-note">当前会话为只读，不能发送消息</div>` : ""}
          <div class="attach-wrap">
            <button id="plus-btn" ${!chat?.canSend ? "disabled" : ""} aria-label="添加附件">+</button>
            ${state.attachMenuOpen ? `<div class="attach-menu">
              <button id="pick-image">发送图片</button>
              <button id="pick-file">发送文件</button>
            </div>` : ""}
          </div>
          <textarea id="composer-input" ${!chat?.canSend ? "disabled" : ""} placeholder="输入消息，Ctrl+V 可粘贴文本/图片/文件"></textarea>
          <button id="send-btn" ${state.sending || !chat?.canSend ? "disabled" : ""}>${state.sending ? "发送中" : "发送"}</button>
          <input id="file-input" type="file" hidden>
          <input id="image-input" type="file" accept="image/*" hidden>
        </footer>
      </main>
    </div>
    ${state.filesOpen ? `<div class="modal"><div class="modal-panel"><header><h3>服务器文件</h3><button id="close-files">关闭</button></header><div class="server-files">${state.serverFiles.map((file) => `<a class="server-file" href="/api/files/${encodeURIComponent(file.id)}/download"><strong>${escapeHtml(file.filename)}</strong><span>${formatBytes(file.size)} ${escapeHtml(file.contentType)} ${new Date(file.modifiedAt).toLocaleString()}</span><small>${escapeHtml(file.sourcePathHint)}</small></a>`).join("")}</div></div></div>` : ""}
  `;
  bindEvents();
}

function bindEvents(): void {
  document.querySelector("#refresh")?.addEventListener("click", () => void refreshAll());
  document.querySelector("#login-btn")?.addEventListener("click", () => {
    if (state.status?.loggedIn) {
      void refreshAll();
    } else {
      void startWechatLogin();
    }
  });
  document.querySelector("#switch-login-btn")?.addEventListener("click", () => void startWechatLogin(true));
  document.querySelector("#server-files")?.addEventListener("click", () => void loadServerFiles().catch((e) => { state.error = String(e); render(); }));
  document.querySelector("#close-files")?.addEventListener("click", () => { state.filesOpen = false; render(); });
  document.querySelectorAll<HTMLButtonElement>("[data-chat]").forEach((button) => button.addEventListener("click", () => {
    state.selectedChatId = button.dataset.chat || "";
    state.messages = [];
    void refreshMessages();
  }));
  document.querySelector("#send-btn")?.addEventListener("click", () => void sendText());
  document.querySelector("#plus-btn")?.addEventListener("click", () => {
    state.attachMenuOpen = !state.attachMenuOpen;
    render();
  });
  document.querySelector("#pick-image")?.addEventListener("click", () => {
    state.attachMenuOpen = false;
    document.querySelector<HTMLInputElement>("#image-input")?.click();
  });
  document.querySelector("#pick-file")?.addEventListener("click", () => {
    state.attachMenuOpen = false;
    document.querySelector<HTMLInputElement>("#file-input")?.click();
  });
  document.querySelector("#file-input")?.addEventListener("change", (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) void sendFile(file, false);
  });
  document.querySelector("#image-input")?.addEventListener("change", (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) void sendFile(file, true);
  });
  document.querySelector("#composer-input")?.addEventListener("keydown", (event) => {
    if (event instanceof KeyboardEvent && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendText();
    }
  });
  document.querySelector("#composer-input")?.addEventListener("paste", (event) => {
    const items = (event as ClipboardEvent).clipboardData?.items || [];
    for (const item of Array.from(items)) {
      const file = item.getAsFile();
      if (file) {
        event.preventDefault();
        void sendFile(file, item.type.startsWith("image/"));
        return;
      }
    }
  });
  document.querySelectorAll<HTMLButtonElement>("[data-download]").forEach((button) => button.addEventListener("click", () => {
    const localId = Number(button.dataset.download);
    const message = state.messages.find((m) => m.localId === localId);
    if (message) void downloadMessage(message);
  }));
}

void refreshAll();
window.setInterval(() => void refreshAll(), 10000);
