export function messagesEl() {
    return document.querySelector(".messages");
}
export function isNearBottom(el, threshold = 80) {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}
export function scrollToBottom(smooth = false) {
    const el = messagesEl();
    if (!el)
        return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
}
export function captureMessageScroll() {
    const el = messagesEl();
    if (!el)
        return null;
    return { top: el.scrollTop, height: el.scrollHeight };
}
export function restoreMessageScroll(snapshot) {
    const el = messagesEl();
    if (!el || !snapshot)
        return;
    el.scrollTop = snapshot.top + (el.scrollHeight - snapshot.height);
}
