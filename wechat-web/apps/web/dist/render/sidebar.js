import { escapeHtml, labelForKind, state } from "../state.js";
const SERVICE_KINDS = new Set(["official", "service", "system"]);
export function renderSidebar() {
    renderStatus();
    renderLogin();
    renderError();
    renderChats();
}
export function renderStatus() {
    const el = document.querySelector('[data-region="status"]');
    if (!el)
        return;
    el.innerHTML = `
    <div><strong>${state.status?.loggedIn ? "已登录" : "未登录"}</strong><span>${escapeHtml(state.status?.loggedInUser || state.status?.status || "unknown")}</span></div>
    <button type="button" data-action="login">${state.status?.loggedIn ? "刷新" : "登录微信"}</button>
  `;
}
export function renderLogin() {
    const el = document.querySelector('[data-region="login"]');
    if (!el)
        return;
    if (state.status?.loggedIn || (!state.loginQrDataUrl && !state.loginMessage && !state.loginQrFailed)) {
        el.innerHTML = "";
        return;
    }
    el.innerHTML = state.loginQrFailed ? `
    <div class="login-qr-panel">
      <div class="qr-failed-icon">QR</div>
      <span>${escapeHtml(state.loginMessage || "二维码识别失败")}</span>
      <button type="button" data-action="switch-login">切换账号二维码</button>
    </div>
  ` : `
    <div class="login-qr-panel">
      ${state.loginQrDataUrl ? `<img src="${state.loginQrDataUrl}" alt="微信登录二维码">` : ""}
      <span>${escapeHtml(state.loginMessage)}</span>
      <button type="button" data-action="switch-login">切换账号二维码</button>
    </div>
  `;
}
export function renderError() {
    const el = document.querySelector('[data-region="error"]');
    if (!el)
        return;
    el.innerHTML = state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : "";
}
export function renderChats() {
    const list = document.querySelector('[data-region="chats"]');
    if (!list)
        return;
    const scrollTop = list.scrollTop;
    const serviceChats = state.chats.filter((item) => SERVICE_KINDS.has(item.kind));
    const mainChats = state.chats.filter((item) => !SERVICE_KINDS.has(item.kind));
    const visibleChats = state.serviceFolderOpen ? serviceChats : mainChats;
    const serviceEntry = !state.serviceFolderOpen && serviceChats.length ? renderServiceFolder(serviceChats) : "";
    const backEntry = state.serviceFolderOpen ? `
    <button class="folder-back" type="button" data-action="close-service-folder">
      <span class="back-icon">‹</span><span>公众号与服务</span><small>${serviceChats.length} 个会话</small>
    </button>
  ` : "";
    list.innerHTML = state.chats.length
        ? `${backEntry}${serviceEntry}${visibleChats.map(renderChatItem).join("") || `<div class="empty-state">暂无会话</div>`}`
        : `<div class="empty-state">暂无会话。若刚扫码登录，请稍等数据库密钥提取完成后刷新。</div>`;
    list.scrollTop = scrollTop;
}
export function updateActiveChat() {
    document.querySelectorAll("[data-chat]").forEach((button) => {
        button.classList.toggle("active", button.dataset.chat === state.selectedChatId);
    });
}
function renderServiceFolder(items) {
    const unread = items.reduce((sum, item) => sum + item.unreadCount, 0);
    const latest = items.find((item) => item.lastMessagePreview) || items[0];
    return `
    <button class="chat-item service-folder" data-action="open-service-folder" type="button">
      <span class="chat-avatar service-avatar">服</span>
      <span class="chat-main">
        <span class="chat-top"><strong>公众号与服务</strong><time>${formatChatTime(latest?.lastMessageTime)}</time></span>
        <span class="chat-preview">${escapeHtml(latest?.displayName || "")}${latest?.lastMessagePreview ? `: ${escapeHtml(latest.lastMessagePreview)}` : ""}</span>
      </span>
      ${unread ? `<em>${unread > 99 ? "99+" : unread}</em>` : ""}
    </button>
  `;
}
function renderChatItem(item) {
    return `
    <button class="chat-item ${item.id === state.selectedChatId ? "active" : ""}" data-chat="${escapeHtml(item.id)}" type="button">
      <span class="chat-avatar">${avatarText(item)}</span>
      <span class="chat-main">
        <span class="chat-top"><strong>${escapeHtml(item.displayName)}</strong><time>${formatChatTime(item.lastMessageTime)}</time></span>
        <span class="chat-preview">${escapeHtml(item.lastMessagePreview || labelForKind(item.kind))}</span>
      </span>
      ${item.unreadCount ? `<em>${item.unreadCount > 99 ? "99+" : item.unreadCount}</em>` : ""}
      ${item.canSend || item.unreadCount ? "" : `<small class="readonly-chip">只读</small>`}
    </button>
  `;
}
function avatarText(item) {
    if (item.kind === "filehelper")
        return "文";
    if (item.isGroup)
        return "群";
    return escapeHtml((item.displayName || "?").trim().slice(0, 1).toUpperCase() || "?");
}
function formatChatTime(value) {
    if (!value)
        return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return "";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
