from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlparse
from urllib.request import Request, urlopen
import base64
import json
import mimetypes
import os
import re


HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "3001"))
WEB_ROOT = Path(os.environ.get("WEB_ROOT", "/app/apps/web/dist")).resolve()
AGENT_BASE_URL = os.environ.get("AGENT_WECHAT_BASE_URL", "http://host.docker.internal:6174").rstrip("/")
TOKEN_FILE = os.environ.get("AGENT_WECHAT_TOKEN_FILE", "/run/secrets/agent-wechat-token")
READONLY_KINDS = {"official", "service", "system"}


def read_token():
    return Path(TOKEN_FILE).read_text(encoding="utf-8").strip()


def agent_response(path, method="GET", body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = Request(
        f"{AGENT_BASE_URL}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {read_token()}",
            "Content-Type": "application/json",
        },
    )
    return urlopen(request, timeout=60)


def agent_request(path, method="GET", body=None):
    with agent_response(path, method, body) as response:
        raw = response.read()
        return json.loads(raw.decode("utf-8") or "null")


def classify_chat(chat_id):
    if chat_id == "filehelper":
        return "filehelper", True
    if chat_id.endswith("@chatroom"):
        return "group", True
    if chat_id.startswith("gh_"):
        return "official", False
    if chat_id.startswith("ww_") or chat_id.endswith("@qy_u"):
        return "service", False
    if chat_id.endswith("@openim") or "@openim" in chat_id:
        return "openim", True
    if chat_id in {"weixin", "qqmail", "mphelper", "exmail_tool", "brandsessionholder", "fmessage", "medianote"}:
        return "system", False
    return "individual", True


def normalize_chat(chat):
    chat_id = chat.get("username") or chat.get("id")
    kind = chat.get("kind")
    can_send = None
    if not kind:
        kind, can_send = classify_chat(chat_id or "")
    if can_send is None:
        can_send = kind not in READONLY_KINDS
    return {
        "id": chat_id,
        "displayName": chat.get("remark") or chat.get("name") or chat_id,
        "avatarUrl": None,
        "lastMessagePreview": chat.get("lastMessagePreview"),
        "lastMessageTime": chat.get("lastActivityAt"),
        "unreadCount": int(chat.get("unreadCount") or 0),
        "isGroup": bool(chat.get("isGroup") or kind == "group"),
        "kind": kind,
        "canSend": bool(can_send),
        "raw": chat,
    }


def map_message_type(raw_type, content):
    base = int(raw_type or 0) & 0xFFFFFFFF
    if base in (10000, 10002):
        return "system"
    if base == 1:
        return "text"
    if base in (3, 47):
        return "image"
    if base == 34:
        return "voice"
    if base == 43:
        return "video"
    if base == 49:
        sub = int(raw_type or 0) // 0x100000000
        if sub == 6:
            return "file"
        if sub in (4, 43):
            return "video"
        if sub in (3, 5, 57):
            return "text"
        if re.search(r"<appattach\b", content or "", re.I) or re.search(r"<type>\s*6\s*</type>", content or "", re.I):
            return "file"
        if re.search(r"\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|txt|csv)$", (content or "").strip(), re.I):
            return "file"
        return "text"
    return "unknown"


def normalize_message(message):
    content = message.get("content") or ""
    msg_type = map_message_type(message.get("type"), content)
    local_id = message.get("localId")
    result = {
        "id": str(message.get("serverId") or local_id),
        "localId": local_id,
        "chatId": message.get("chatId"),
        "senderName": message.get("senderName"),
        "senderId": message.get("sender"),
        "direction": "out" if message.get("isSelf") is True else "in" if message.get("isSelf") is False else "unknown",
        "type": msg_type,
        "timestamp": message.get("timestamp"),
        "raw": message,
    }
    if msg_type in ("text", "system", "unknown"):
        result["text"] = content
    if msg_type in ("image", "file", "voice", "video"):
        result["mediaLocalId"] = str(local_id)
    if msg_type == "file":
        title = re.search(r"<title><!\[CDATA\[(.*?)\]\]></title>", content) or re.search(r"<title>(.*?)</title>", content)
        size = re.search(r"<totallen>(\d+)</totallen>", content)
        result["fileName"] = title.group(1) if title else (content.strip() if content.strip() and not content.strip().startswith("<") else None)
        result["fileSize"] = int(size.group(1)) if size else None
    return result


def content_type(media):
    fmt = str(media.get("format") or "")
    media_type = media.get("type")
    if "/" in fmt:
        return fmt
    if media_type == "image":
        return f"image/{fmt or 'jpeg'}"
    if media_type == "video":
        return "video/mp4"
    if media_type == "voice":
        return "audio/mpeg"
    if fmt == "pdf":
        return "application/pdf"
    return mimetypes.guess_type(media.get("filename") or "")[0] or "application/octet-stream"


def attachment_header(filename):
    safe = (filename or "download").replace('"', "")
    encoded = quote(filename or "download", safe="")
    return f'attachment; filename="{safe}"; filename*=UTF-8\'\'{encoded}'


def map_agent_send_error(raw):
    code = raw.get("code")
    error = raw.get("error") or "发送失败"
    if not code and isinstance(error, str) and ":" in error:
        code, error = [part.strip() for part in error.split(":", 1)]
    labels = {
        "CHAT_NOT_OPENED": "聊天未打开",
        "READONLY_CHAT": "当前会话不支持发送",
        "INPUT_NOT_FOUND": "未找到微信输入框",
        "SEND_BUTTON_NOT_FOUND": "未找到发送按钮",
        "WECHAT_WINDOW_NOT_FOUND": "未找到微信窗口或未进入聊天页",
        "PASTE_FAILED": "粘贴文件或图片失败",
        "UPLOAD_FAILED": "上传或发送内容失败",
        "TIMEOUT": "发送超时",
        "AGENT_UNAVAILABLE": "agent-server 不可用",
    }
    return code or "SEND_FAILED", labels.get(code, error)


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def api_error(self, error):
        if isinstance(error, HTTPError):
            try:
                body = json.loads(error.read().decode("utf-8") or "{}")
            except Exception:
                body = {"error": str(error), "code": "AGENT_ERROR"}
            self.send_json(error.code, body)
            return
        self.send_json(502, {"error": "agent-wechat is unreachable", "code": "AGENT_UNAVAILABLE"})

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length).decode("utf-8") or "{}") if length else {}

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            if path == "/api/health":
                self.send_json(200, {"ok": True})
            elif path == "/api/session":
                self.send_json(200, {"passwordEnabled": False, "authenticated": True})
            elif path == "/api/status":
                raw = agent_request("/api/status/auth")
                status = raw.get("status") or "unknown"
                self.send_json(200, {"agentReachable": True, "loggedIn": status == "logged_in", "status": status, "loggedInUser": raw.get("loggedInUser")})
            elif path == "/api/wechat-login/events":
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                raw = agent_request("/api/status/auth")
                event = json.dumps({"type": "status", "status": raw.get("status"), "loggedInUser": raw.get("loggedInUser")}, ensure_ascii=False)
                self.wfile.write(f"data: {event}\n\n".encode("utf-8"))
            elif path == "/api/chats":
                chats = agent_request(f"/api/chats?{parsed.query}")
                self.send_json(200, [normalize_chat(chat) for chat in chats])
            elif path.startswith("/api/chats/") and path.endswith("/messages"):
                chat_id = unquote(path.split("/")[3])
                messages = agent_request(f"/api/messages/{quote(chat_id, safe='')}?{parsed.query}")
                self.send_json(200, [normalize_message(message) for message in messages])
            elif "/media/" in path:
                parts = path.split("/")
                chat_id, local_id = unquote(parts[3]), unquote(parts[5])
                media = agent_request(f"/api/messages/{quote(chat_id, safe='')}/media/{quote(local_id, safe='')}")
                if media.get("type") == "pending" or media.get("retryable") is True or media.get("reason") in {"not_downloaded", "path_not_found", "pending"}:
                    self.send_json(202, {"error": "文件尚未下载到本机微信", "code": "MEDIA_PENDING", "reason": media.get("reason"), "filename": media.get("filename"), "retryable": True})
                    return
                data = media.get("data")
                if not data:
                    self.send_json(404, {"error": media.get("reason") or "media is not available", "code": "MEDIA_NOT_AVAILABLE", "filename": media.get("filename")})
                    return
                raw = base64.b64decode(data)
                filename = media.get("filename") or f"media_{local_id}"
                self.send_response(200)
                self.send_header("Content-Type", content_type(media))
                self.send_header("Content-Disposition", attachment_header(filename))
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            elif path == "/api/files":
                files = agent_request(f"/api/files?{parsed.query}")
                self.send_json(200, files)
            elif path == "/api/files/download":
                file_id = parse_qs(parsed.query).get("id", [""])[0]
                self.proxy_file_download(file_id)
            elif path.startswith("/api/files/") and path.endswith("/download"):
                file_id = unquote(path.split("/")[3])
                self.proxy_file_download(file_id)
            else:
                self.serve_static(path)
        except (HTTPError, URLError, TimeoutError, OSError) as error:
            self.api_error(error)

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/login":
                self.send_json(200, {"passwordEnabled": False, "authenticated": True})
            elif parsed.path == "/api/wechat-login":
                raw = agent_request("/api/status/login", "POST", {})
                self.send_json(200, raw)
            elif parsed.path == "/api/logout":
                raw = agent_request("/api/status/logout", "POST", {})
                self.send_json(200, raw)
            elif parsed.path.startswith("/api/chats/") and parsed.path.endswith("/send"):
                chat_id = unquote(parsed.path.split("/")[3])
                kind, can_send = classify_chat(chat_id)
                if not can_send:
                    self.send_json(403, {"ok": False, "status": "failed", "code": "READONLY_CHAT", "error": "当前会话不支持发送"})
                    return
                payload = self.read_body()
                payload_type = payload.get("type") or ("text" if payload.get("text") else None)
                if payload_type == "text":
                    text = (payload.get("text") or "").strip()
                    if not text:
                        self.send_json(400, {"ok": False, "status": "failed", "code": "UPLOAD_FAILED", "error": "text is required"})
                        return
                    agent_body = {"chatId": chat_id, "text": text}
                elif payload_type == "image":
                    data = payload.get("base64") or payload.get("data")
                    if not data:
                        self.send_json(400, {"ok": False, "status": "failed", "code": "UPLOAD_FAILED", "error": "image base64 is required"})
                        return
                    agent_body = {"chatId": chat_id, "image": {"data": data, "mimeType": payload.get("mimeType") or "image/png"}}
                elif payload_type == "file":
                    data = payload.get("base64") or payload.get("data")
                    filename = payload.get("filename") or "upload"
                    if not data:
                        self.send_json(400, {"ok": False, "status": "failed", "code": "UPLOAD_FAILED", "error": "file base64 is required"})
                        return
                    agent_body = {"chatId": chat_id, "file": {"data": data, "filename": filename}}
                else:
                    self.send_json(400, {"ok": False, "status": "failed", "code": "UPLOAD_FAILED", "error": "unsupported send type"})
                    return
                raw = agent_request("/api/messages/send", "POST", agent_body)
                if not raw.get("success"):
                    code, error = map_agent_send_error(raw)
                    self.send_json(200, {"ok": False, "status": "failed", "code": code, "error": error, "raw": raw})
                    return
                self.send_json(200, {"ok": True, "status": "sent", "raw": raw, "kind": kind})
            else:
                self.send_json(404, {"error": "not found", "code": "NOT_FOUND"})
        except (HTTPError, URLError, TimeoutError, OSError) as error:
            self.api_error(error)

    def proxy_file_download(self, file_id):
        with agent_response(f"/api/files/{quote(file_id, safe='')}/download") as response:
            raw = response.read()
            self.send_response(response.status)
            for name in ("Content-Type", "Content-Disposition"):
                value = response.headers.get(name)
                if value:
                    self.send_header(name, value)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    def serve_static(self, path):
        relative = path.lstrip("/") or "index.html"
        candidate = (WEB_ROOT / relative).resolve()
        if not str(candidate).startswith(str(WEB_ROOT)) or not candidate.is_file():
            candidate = WEB_ROOT / "index.html"
        raw = candidate.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(candidate.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, format, *args):
        return


ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
