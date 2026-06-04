import { api } from "./api.js";
import { downloadMessage, bindLazyMediaImages, loadMediaBlobUrl } from "./media.js";
import { autosizeComposer, mountShellOnce, renderBottomButton, renderChats, renderComposer, renderError, renderLogin, renderMessages, renderModals, renderSidebar, renderStatus, updateActiveChat, } from "./render/index.js";
import { captureMessageScroll, isNearBottom, restoreMessageScroll, scrollToBottom, messagesEl } from "./scroll.js";
import { sendFile, sendText } from "./send.js";
import { escapeHtml, labelForKind, selectedChat, state } from "./state.js";
const root = document.querySelector("#root");
if (!root)
    throw new Error("root missing");
let messagesRequestSeq = 0;
async function refreshStatus() {
    try {
        state.status = await api("/api/status");
        if (state.status.loggedIn) {
            state.loginQrDataUrl = "";
            state.loginMessage = "";
        }
    }
    catch (error) {
        state.status = { agentReachable: false, loggedIn: false, status: "unknown", error: String(error) };
    }
    renderStatus();
    renderLogin();
}
async function pollLoginAfterQr() {
    for (let i = 0; i < 20; i += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
        await refreshStatus();
        if (state.status?.loggedIn) {
            await refreshChats();
            await refreshMessages({ reason: "initial", forceBottom: true });
            return;
        }
    }
}
async function startWechatLogin(newAccount = false) {
    state.error = "";
    state.loginMessage = "正在获取微信登录二维码";
    state.loginQrDataUrl = "";
    state.loginQrFailed = false;
    renderLogin();
    renderError();
    try {
        const result = await api("/api/wechat-login", { method: "POST", body: JSON.stringify({ newAccount }) });
        state.loginQrDataUrl = result.qrDataUrl || "";
        state.loginMessage = result.qrDataUrl
            ? "请使用手机微信扫码登录"
            : result.message || result.state?.status || "登录流程已启动";
        if (result.state?.status === "qr_decode_failed") {
            state.error = "微信已进入扫码登录页，但二维码识别失败，请通过 VNC 查看或重新切换账号";
            state.loginQrFailed = true;
        }
        await refreshStatus();
        if (result.qrDataUrl || ["phone_confirm", "loading"].includes(result.state?.status || "")) {
            void pollLoginAfterQr();
        }
    }
    catch (error) {
        state.loginMessage = "";
        state.error = error instanceof Error ? error.message : String(error);
    }
    renderLogin();
    renderError();
}
async function refreshChats() {
    state.chats = await api("/api/chats?limit=120&offset=0");
    if (!state.selectedChatId && state.chats[0])
        state.selectedChatId = state.chats[0].id;
    if (state.selectedChatId && !state.chats.some((chat) => chat.id === state.selectedChatId)) {
        state.selectedChatId = state.chats[0]?.id || "";
    }
    renderChats();
    renderConversationHeader();
    renderComposer();
}
export async function refreshMessages(options = {}) {
    const chatId = state.selectedChatId;
    if (!chatId)
        return;
    const seq = ++messagesRequestSeq;
    const reason = options.reason || "poll";
    const el = messagesEl();
    const wasNearBottom = el ? isNearBottom(el) : true;
    const snapshot = captureMessageScroll();
    const previousLast = state.messages.at(-1)?.localId;
    const previousLength = state.messages.length;
    const messages = await api(`/api/chats/${encodeURIComponent(chatId)}/messages?limit=100&offset=0`);
    if (seq !== messagesRequestSeq || chatId !== state.selectedChatId)
        return;
    state.messages = messages;
    const nextLast = messages.at(-1)?.localId;
    const hasNew = previousLast !== undefined && nextLast !== undefined && nextLast !== previousLast;
    const shouldBottom = options.forceBottom || reason === "switch-chat" || reason === "send" || (reason === "poll" && wasNearBottom);
    if (hasNew && !shouldBottom) {
        state.newMessageCount += Math.max(1, messages.length - previousLength);
        state.showBottomButton = true;
    }
    renderMessages();
    bindLazyMediaImages((imageWasNearBottom) => {
        if (imageWasNearBottom)
            scrollToBottom();
        else
            restoreMessageScroll(captureMessageScroll());
    });
    if (shouldBottom) {
        state.newMessageCount = 0;
        state.showBottomButton = false;
        renderBottomButton();
        scrollToBottom(reason !== "switch-chat");
    }
    else {
        restoreMessageScroll(snapshot);
    }
}
async function refreshAll(reason = "poll") {
    await refreshStatus();
    if (state.status?.loggedIn) {
        await refreshChats();
        await refreshMessages({ reason });
    }
}
function renderConversationHeader() {
    const header = document.querySelector('[data-region="conversation-header"]');
    const chat = selectedChat();
    if (!header)
        return;
    header.innerHTML = `<h2>${escapeHtml(chat?.displayName || "选择聊天")}</h2><span>${chat ? `${labelForKind(chat.kind)}${chat.canSend ? "" : " / 只读"}` : ""}</span>`;
}
async function loadServerFiles() {
    state.filesOpen = true;
    state.serverFiles = await api("/api/files?type=all&limit=200&offset=0");
    renderModals();
}
function bindEvents() {
    document.addEventListener("click", (event) => {
        const target = event.target;
        const chatButton = target.closest("[data-chat]");
        if (chatButton) {
            const nextChatId = chatButton.dataset.chat || "";
            if (nextChatId && nextChatId !== state.selectedChatId) {
                state.selectedChatId = nextChatId;
                state.messages = [];
                state.newMessageCount = 0;
                state.showBottomButton = false;
                updateActiveChat();
                renderConversationHeader();
                renderMessages();
                renderComposer();
                void refreshMessages({ reason: "switch-chat", forceBottom: true });
            }
            return;
        }
        const action = target.closest("[data-action]")?.dataset.action;
        if (action === "refresh")
            void refreshAll("initial");
        if (action === "login")
            state.status?.loggedIn ? void refreshAll("initial") : void startWechatLogin();
        if (action === "switch-login")
            void startWechatLogin(true);
        if (action === "server-files")
            void loadServerFiles().catch((e) => { state.error = String(e); renderError(); });
        if (action === "close-files") {
            state.filesOpen = false;
            renderModals();
        }
        if (action === "close-preview") {
            state.previewImageUrl = "";
            renderModals();
        }
        if (action === "pick-image")
            document.querySelector("#image-input")?.click();
        if (action === "pick-file")
            document.querySelector("#file-input")?.click();
        if (action === "send")
            void sendText();
        if (action === "bottom") {
            state.newMessageCount = 0;
            state.showBottomButton = false;
            renderBottomButton();
            scrollToBottom(true);
        }
        const download = target.closest("[data-download]");
        if (download) {
            const localId = Number(download.dataset.download);
            const message = state.messages.find((m) => m.localId === localId);
            if (message)
                void downloadMessage(message, (download.dataset.variant || "original")).catch((e) => { state.error = String(e.message || e); renderError(); });
        }
        const preview = target.closest("[data-preview-image]");
        if (preview) {
            const localId = Number(preview.dataset.previewImage);
            const message = state.messages.find((m) => m.localId === localId);
            if (message?.mediaLocalId) {
                void loadMediaBlobUrl(message.chatId, message.mediaLocalId, "preview").then((url) => {
                    state.previewImageUrl = url;
                    renderModals();
                }).catch((e) => { state.error = String(e.message || e); renderError(); });
            }
        }
    });
    document.addEventListener("input", (event) => {
        if (event.target.id === "composer-input")
            autosizeComposer();
    });
    document.addEventListener("compositionstart", (event) => {
        if (event.target.id === "composer-input")
            state.composing = true;
    });
    document.addEventListener("compositionend", (event) => {
        if (event.target.id === "composer-input")
            state.composing = false;
    });
    document.addEventListener("keydown", (event) => {
        if (event.target.id === "composer-input" && event.key === "Enter" && !event.shiftKey && !state.composing) {
            event.preventDefault();
            void sendText();
        }
    });
    document.addEventListener("paste", (event) => {
        const target = event.target;
        if (target.id !== "composer-input" || !selectedChat()?.canSend)
            return;
        const items = event.clipboardData?.items || [];
        for (const item of Array.from(items)) {
            const file = item.getAsFile();
            if (file) {
                event.preventDefault();
                void sendFile(file, item.type.startsWith("image/"));
                return;
            }
        }
    });
    document.querySelector("#file-input")?.addEventListener("change", (event) => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        input.value = "";
        if (file)
            void sendFile(file, false);
    });
    document.querySelector("#image-input")?.addEventListener("change", (event) => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        input.value = "";
        if (file)
            void sendFile(file, true);
    });
    document.querySelector(".messages")?.addEventListener("scroll", () => {
        const el = messagesEl();
        if (!el)
            return;
        if (isNearBottom(el)) {
            state.newMessageCount = 0;
            state.showBottomButton = false;
        }
        else if (state.newMessageCount > 0) {
            state.showBottomButton = true;
        }
        renderBottomButton();
    });
}
mountShellOnce(root);
bindEvents();
renderSidebar();
renderConversationHeader();
renderMessages();
renderComposer();
renderModals();
void refreshAll("initial");
window.setInterval(() => void refreshAll("poll"), 10000);
