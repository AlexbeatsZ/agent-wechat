import { api, publicError } from "./api.js";
import { autosizeComposer, renderComposer, renderError, renderMessages } from "./render/index.js";
import { formatBytes, MAX_UPLOAD_BYTES, selectedChat, state } from "./state.js";
import { refreshMessages } from "./app.js";
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
        reader.readAsDataURL(file);
    });
}
export async function sendPayload(payload, optimistic) {
    const chat = selectedChat();
    if (!chat)
        return false;
    if (!chat.canSend) {
        state.error = publicError("READONLY_CHAT");
        renderError();
        return false;
    }
    const chatId = chat.id;
    state.sending = true;
    state.error = "";
    if (optimistic) {
        state.messages = [...state.messages, optimistic];
        renderMessages();
    }
    renderComposer();
    renderError();
    try {
        const result = await api(`/api/chats/${encodeURIComponent(chatId)}/send`, { method: "POST", body: JSON.stringify(payload) });
        if (!result.ok)
            throw new Error(publicError(result.code, result.error));
        if (state.selectedChatId === chatId) {
            await refreshMessages({ reason: "send", forceBottom: true });
            window.setTimeout(() => void refreshMessages({ reason: "send", forceBottom: true }), 1200);
        }
        return true;
    }
    catch (error) {
        if (optimistic && state.selectedChatId === chatId) {
            state.messages = state.messages.map((message) => message.id === optimistic.id ? { ...message, pending: false, failed: true } : message);
            renderMessages();
        }
        state.error = error instanceof Error ? error.message : String(error);
        renderError();
        return false;
    }
    finally {
        state.sending = false;
        renderComposer();
    }
}
export async function sendText() {
    const input = document.querySelector("#composer-input");
    const text = input?.value || "";
    const trimmed = text.trim();
    const chat = selectedChat();
    if (!input || !trimmed || !chat)
        return;
    input.value = "";
    autosizeComposer();
    const optimistic = {
        id: `optimistic-${Date.now()}`,
        localId: Date.now(),
        chatId: chat.id,
        direction: "out",
        type: "text",
        text: trimmed,
        timestamp: new Date().toISOString(),
        optimistic: true,
        pending: true,
    };
    const ok = await sendPayload({ type: "text", text: trimmed }, optimistic);
    if (!ok && state.selectedChatId === chat.id) {
        input.value = text;
        autosizeComposer();
        input.focus();
    }
}
export async function sendFile(file, asImage) {
    if (file.size > MAX_UPLOAD_BYTES) {
        state.error = `文件过大，当前 Web 上传建议不超过 ${formatBytes(MAX_UPLOAD_BYTES)}`;
        renderError();
        return;
    }
    state.uploadStatus = `正在读取${asImage ? "图片" : "文件"}...`;
    renderComposer();
    try {
        const base64 = await fileToBase64(file);
        state.uploadStatus = "正在发送...";
        renderComposer();
        await sendPayload({
            type: asImage ? "image" : "file",
            filename: file.name,
            mimeType: file.type || "application/octet-stream",
            base64,
        });
    }
    catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
        renderError();
    }
    finally {
        state.uploadStatus = "";
        renderComposer();
    }
}
