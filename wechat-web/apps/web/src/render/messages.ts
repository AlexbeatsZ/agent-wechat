import { escapeHtml, formatBytes, state } from "../state.js";
import type { MessageDto } from "../types.js";

export function renderMessages(): void {
  const el = document.querySelector<HTMLElement>('[data-region="messages"]');
  if (!el) return;
  if (!state.selectedChatId) {
    el.innerHTML = `<div class="empty-state">请选择左侧会话</div>`;
  } else if (!state.messages.length) {
    el.innerHTML = `<div class="empty-state">暂无消息，或正在读取微信数据库</div>`;
  } else {
    el.innerHTML = state.messages.map(renderMessage).join("");
  }
  renderBottomButton();
}

export function renderBottomButton(): void {
  const button = document.querySelector<HTMLButtonElement>(".new-message-button");
  if (!button) return;
  button.hidden = !state.showBottomButton;
  button.textContent = state.newMessageCount > 0 ? `${state.newMessageCount} 条新消息` : "回到底部";
}

function renderMessage(message: MessageDto): string {
  if (message.type === "system") return renderSystemMessage(message);
  const meta = escapeHtml(message.senderName || message.senderId || (message.direction === "out" ? "我" : "对方"));
  const status = message.pending ? `<span class="message-state">发送中</span>` : message.failed ? `<span class="message-state failed">发送失败</span>` : "";
  return `
    <div class="message-row ${message.direction === "out" ? "out" : "in"} ${message.optimistic ? "optimistic" : ""}" data-local-id="${message.localId}">
      <div class="message-meta">${meta}${status}</div>
      <div class="bubble">${renderMessageBody(message)}</div>
      <time>${new Date(message.timestamp).toLocaleString()}</time>
    </div>
  `;
}

function renderMessageBody(message: MessageDto): string {
  switch (message.type) {
    case "image": return renderImageMessage(message);
    case "file": return renderFileMessage(message);
    case "voice": return renderVoiceMessage(message);
    case "video": return renderVideoMessage(message);
    case "text":
    case "unknown":
    default:
      return renderTextMessage(message);
  }
}

function renderTextMessage(message: MessageDto): string {
  return `<div class="message-text">${escapeHtml(message.text || "")}</div>`;
}

function renderImageMessage(message: MessageDto): string {
  return `
    <div class="image-bubble">
      <img class="chat-image" data-chat-id="${escapeHtml(message.chatId)}" data-media-local-id="${escapeHtml(message.mediaLocalId || "")}" data-variant="thumb" alt="图片消息" loading="lazy">
      <div class="image-actions">
        <button type="button" data-preview-image="${message.localId}">查看</button>
        <button type="button" data-download="${message.localId}" data-variant="original">原图</button>
      </div>
    </div>
  `;
}

function renderFileMessage(message: MessageDto): string {
  return `
    <button type="button" class="file-card" data-download="${message.localId}" data-variant="original">
      <span class="file-icon">FILE</span>
      <span class="file-info"><strong>${escapeHtml(message.fileName || "文件")}</strong><small>${formatBytes(message.fileSize) || "点击下载"}</small></span>
    </button>
  `;
}

function renderVoiceMessage(message: MessageDto): string {
  return `
    <button type="button" class="voice-card" data-download="${message.localId}" data-variant="preview">
      <span class="voice-wave"></span><span>语音消息</span><small>下载播放</small>
    </button>
  `;
}

function renderVideoMessage(message: MessageDto): string {
  return `
    <div class="video-card">
      <div class="video-cover">VIDEO</div>
      <button type="button" data-download="${message.localId}" data-variant="preview">下载/播放</button>
    </div>
  `;
}

function renderSystemMessage(message: MessageDto): string {
  return `<div class="system-message">${escapeHtml(message.text || "")}</div>`;
}
