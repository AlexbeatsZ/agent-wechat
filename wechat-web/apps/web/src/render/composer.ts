import { selectedChat, state } from "../state.js";

export function renderComposer(): void {
  const chat = selectedChat();
  const composer = document.querySelector<HTMLElement>('[data-region="composer"]');
  const input = document.querySelector<HTMLTextAreaElement>("#composer-input");
  const send = document.querySelector<HTMLButtonElement>("#send-btn");
  const readonly = document.querySelector<HTMLElement>('[data-region="readonly"]');
  const status = document.querySelector<HTMLElement>('[data-region="composer-status"]');
  if (!composer || !input || !send || !readonly || !status) return;

  const disabled = !chat?.canSend;
  composer.classList.toggle("readonly", disabled);
  input.disabled = disabled;
  input.placeholder = disabled ? "当前会话不能发送消息" : "输入消息，Enter 发送，Shift+Enter 换行";
  send.disabled = state.sending || disabled;
  send.textContent = state.sending ? "发送中" : "发送";
  readonly.hidden = !disabled;
  readonly.textContent = disabled ? "当前会话为只读，不能发送消息" : "";
  status.textContent = state.uploadStatus;
}

export function autosizeComposer(): void {
  const input = document.querySelector<HTMLTextAreaElement>("#composer-input");
  if (!input) return;
  input.style.height = "0px";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}
