import { responseError } from "./api.js";
const objectUrls = new Map();
export function mediaUrl(chatId, localId, variant) {
    const query = new URLSearchParams({ variant });
    return `/api/chats/${encodeURIComponent(chatId)}/media/${encodeURIComponent(localId)}?${query.toString()}`;
}
export async function loadMediaBlobUrl(chatId, localId, variant) {
    const cacheKey = `${chatId}:${localId}:${variant}`;
    const cached = objectUrls.get(cacheKey);
    if (cached)
        return cached;
    const response = await fetch(mediaUrl(chatId, localId, variant), { credentials: "include" });
    if (response.status === 202) {
        const message = await responseError(response);
        throw new Error(variant === "original" ? "原图尚未下载到本机微信" : message);
    }
    if (!response.ok) {
        throw new Error(await responseError(response));
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    objectUrls.set(cacheKey, url);
    return url;
}
export async function loadFirstAvailableMediaBlobUrl(chatId, localId, variants) {
    let lastError;
    for (const variant of variants) {
        try {
            return { url: await loadMediaBlobUrl(chatId, localId, variant), variant, fallback: variant !== variants[0] };
        }
        catch (error) {
            lastError = error;
        }
    }
    throw lastError instanceof Error ? lastError : new Error("媒体加载失败");
}
export async function downloadMessage(message, variant = "original") {
    if (!message.mediaLocalId)
        return;
    const response = await fetch(mediaUrl(message.chatId, message.mediaLocalId, variant), { credentials: "include" });
    if (response.status === 202) {
        throw new Error(variant === "original" ? "原图尚未下载到本机微信" : await responseError(response));
    }
    if (!response.ok) {
        throw new Error(await responseError(response));
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = message.fileName || `media-${message.localId}`;
    link.click();
    URL.revokeObjectURL(url);
}
export function bindLazyMediaImages(onLoaded) {
    document.querySelectorAll("img.chat-image").forEach((img) => {
        if (img.dataset.loading === "true" || img.dataset.loaded === "true")
            return;
        const chatId = img.dataset.chatId;
        const mediaLocalId = img.dataset.mediaLocalId;
        const variant = (img.dataset.variant || "thumb");
        if (!chatId || !mediaLocalId)
            return;
        const scroller = document.querySelector(".messages");
        const wasNearBottom = scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 80 : true;
        img.dataset.loading = "true";
        const variants = variant === "original" ? ["original", "preview", "thumb"] : variant === "preview" ? ["preview", "thumb"] : ["thumb"];
        void loadFirstAvailableMediaBlobUrl(chatId, mediaLocalId, variants).then(({ url }) => {
            img.src = url;
            img.dataset.loaded = "true";
            img.dataset.loading = "false";
            img.onload = () => onLoaded(wasNearBottom);
        }).catch((error) => {
            img.dataset.loading = "false";
            img.style.display = "none";
            if (!img.parentElement?.querySelector(".image-load-failed")) {
                const fallback = document.createElement("div");
                fallback.className = "image-load-failed";
                fallback.textContent = error instanceof Error ? error.message : "图片加载失败";
                img.parentElement?.appendChild(fallback);
            }
        });
    });
}
