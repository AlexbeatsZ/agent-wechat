import { escapeHtml, labelForKind, state } from "../state.js";

export function renderSidebar(): void {
  renderStatus();
  renderLogin();
  renderError();
  renderChats();
}

export function renderStatus(): void {
  const el = document.querySelector<HTMLElement>('[data-region="status"]');
  if (!el) return;
  el.innerHTML = `
    <div><strong>${state.status?.loggedIn ? "已登录" : "未登录"}</strong><span>${escapeHtml(state.status?.loggedInUser || state.status?.status || "unknown")}</span></div>
    <button type="button" data-action="login">${state.status?.loggedIn ? "刷新" : "登录微信"}</button>
  `;
}

export function renderLogin(): void {
  const el = document.querySelector<HTMLElement>('[data-region="login"]');
  if (!el) return;
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

export function renderError(): void {
  const el = document.querySelector<HTMLElement>('[data-region="error"]');
  if (!el) return;
  el.innerHTML = state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : "";
}

export function renderChats(): void {
  const list = document.querySelector<HTMLElement>('[data-region="chats"]');
  if (!list) return;
  const scrollTop = list.scrollTop;
  list.innerHTML = state.chats.length ? state.chats.map((item) => `
    <button class="chat-item ${item.id === state.selectedChatId ? "active" : ""}" data-chat="${escapeHtml(item.id)}" type="button">
      <div><strong>${escapeHtml(item.displayName)}</strong><span>${escapeHtml(item.lastMessagePreview || "")}</span></div>
      <small>${labelForKind(item.kind)}${item.canSend ? "" : " / 只读"}</small>
      ${item.unreadCount ? `<em>${item.unreadCount}</em>` : ""}
    </button>
  `).join("") : `<div class="empty-state">暂无会话。若刚扫码登录，请稍等数据库密钥提取完成后刷新。</div>`;
  list.scrollTop = scrollTop;
}

export function updateActiveChat(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-chat]").forEach((button) => {
    button.classList.toggle("active", button.dataset.chat === state.selectedChatId);
  });
}
