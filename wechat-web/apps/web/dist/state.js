export const MAX_UPLOAD_BYTES = 35 * 1024 * 1024;
export const state = {
    status: null,
    chats: [],
    selectedChatId: "",
    messages: [],
    error: "",
    sending: false,
    uploadStatus: "",
    filesOpen: false,
    attachMenuOpen: false,
    serverFiles: [],
    loginQrDataUrl: "",
    loginMessage: "",
    loginQrFailed: false,
    previewImageUrl: "",
    newMessageCount: 0,
    showBottomButton: false,
    composing: false,
};
export function selectedChat() {
    return state.chats.find((chat) => chat.id === state.selectedChatId);
}
export function labelForKind(kind) {
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
export function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch] || ch));
}
export function formatBytes(size) {
    if (!size)
        return "";
    if (size < 1024)
        return `${size} B`;
    if (size < 1024 * 1024)
        return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
