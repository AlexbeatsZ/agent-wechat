export function publicError(code, message) {
    const labels = {
        CHAT_NOT_OPENED: "聊天未打开",
        READONLY_CHAT: "当前会话不支持发送",
        INPUT_NOT_FOUND: "未找到微信输入框",
        SEND_BUTTON_NOT_FOUND: "未找到发送按钮",
        WECHAT_WINDOW_NOT_FOUND: "未找到微信窗口或未进入聊天页",
        PASTE_FAILED: "粘贴图片或文件失败",
        UPLOAD_FAILED: "上传或发送内容失败",
        TIMEOUT: "发送超时",
        AGENT_UNAVAILABLE: "agent-server 不可用",
        MEDIA_PENDING: "文件尚未下载到本机微信",
        MEDIA_NOT_AVAILABLE: "媒体文件不可用",
        ORIGINAL_NOT_AVAILABLE: "原图尚未下载到本机微信",
        PLAN_STUCK: "当前操作无法继续，请刷新微信窗口后重试",
        QR_DECODE_FAILED: "微信已进入扫码登录页，但二维码识别失败，请通过 VNC 查看或重新切换账号",
    };
    return (code && labels[code]) || message || "操作失败";
}
export async function api(url, init) {
    const response = await fetch(url, {
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
        ...init,
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
        const label = publicError(body?.code, body?.error);
        const detail = body?.error && body?.code ? `: ${body.error}` : "";
        throw new Error(label + detail);
    }
    return body;
}
export async function responseError(response) {
    const body = await response.json().catch(() => ({}));
    if (body.reason === "original_not_available")
        return "原图尚未下载到本机微信";
    return publicError(body.code, body.error);
}
