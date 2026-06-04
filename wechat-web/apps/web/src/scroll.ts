export type ScrollSnapshot = {
  top: number;
  height: number;
};

export function messagesEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".messages");
}

export function isNearBottom(el: HTMLElement, threshold = 80): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

export function scrollToBottom(smooth = false): void {
  const el = messagesEl();
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
}

export function captureMessageScroll(): ScrollSnapshot | null {
  const el = messagesEl();
  if (!el) return null;
  return { top: el.scrollTop, height: el.scrollHeight };
}

export function restoreMessageScroll(snapshot: ScrollSnapshot | null): void {
  const el = messagesEl();
  if (!el || !snapshot) return;
  el.scrollTop = snapshot.top + (el.scrollHeight - snapshot.height);
}
