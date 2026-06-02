from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
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


def read_token():
    return Path(TOKEN_FILE).read_text(encoding="utf-8").strip()


def agent_request(path, method="GET", body=None):
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
    with urlopen(request, timeout=30) as response:
        raw = response.read()
        return json.loads(raw.decode("utf-8") or "null")


def normalize_chat(chat):
    chat_id = chat.get("username") or chat.get("id")
    return {
        "id": chat_id,
        "displayName": chat.get("remark") or chat.get("name") or chat_id,
        "avatarUrl": None,
        "lastMessagePreview": chat.get("lastMessagePreview"),
        "lastMessageTime": chat.get("lastActivityAt"),
        "unreadCount": int(chat.get("unreadCount") or 0),
        "isGroup": bool(chat.get("isGroup")),
        "raw": chat,
    }


def regular_chat(chat):
    chat_id = chat.get("username") or chat.get("id") or ""
    return bool(chat_id) and not chat_id.startswith("gh_") and chat_id != "brandsessionholder"


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


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def api_error(self, error):
        status = error.code if isinstance(error, HTTPError) else 502
        self.send_json(status, {"error": str(error), "code": "AGENT_ERROR" if isinstance(error, HTTPError) else "AGENT_UNREACHABLE"})

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length).decode("utf-8") or "{}") if length else {}

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            if path == "/api/session":
                self.send_json(200, {"passwordEnabled": False, "authenticated": True})
            elif path == "/api/status":
                raw = agent_request("/api/status/auth")
                status = raw.get("status") or "unknown"
                self.send_json(200, {"agentReachable": True, "loggedIn": status == "logged_in", "status": status, "loggedInUser": raw.get("loggedInUser")})
            elif path == "/api/chats":
                chats = agent_request(f"/api/chats?{parsed.query}")
                self.send_json(200, [normalize_chat(chat) for chat in chats if regular_chat(chat)])
            elif path.startswith("/api/chats/") and path.endswith("/messages"):
                chat_id = path.split("/")[3]
                messages = agent_request(f"/api/messages/{quote(chat_id, safe='')}?{parsed.query}")
                self.send_json(200, [normalize_message(message) for message in messages])
            elif "/media/" in path:
                parts = path.split("/")
                chat_id, local_id = parts[3], parts[5]
                media = agent_request(f"/api/messages/{quote(chat_id, safe='')}/media/{quote(local_id, safe='')}")
                if media.get("url"):
                    self.send_response(302)
                    self.send_header("Location", media["url"])
                    self.end_headers()
                    return
                data = media.get("data")
                if not data:
                    self.send_json(404, {"error": "media is not available", "code": "MEDIA_NOT_AVAILABLE"})
                    return
                raw = base64.b64decode(data)
                self.send_response(200)
                self.send_header("Content-Type", media.get("format") if "/" in str(media.get("format")) else "application/octet-stream")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            else:
                self.serve_static(path)
        except (HTTPError, URLError, TimeoutError, OSError) as error:
            self.api_error(error)

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/login":
                self.send_json(200, {"passwordEnabled": False, "authenticated": True})
            elif parsed.path == "/api/logout":
                self.send_json(200, {"passwordEnabled": False, "authenticated": False})
            elif parsed.path.startswith("/api/chats/") and parsed.path.endswith("/send"):
                chat_id = parsed.path.split("/")[3]
                text = (self.read_body().get("text") or "").strip()
                if not text:
                    self.send_json(400, {"ok": False, "status": "failed", "error": "text is required"})
                    return
                raw = agent_request("/api/messages/send", "POST", {"chatId": chat_id, "text": text})
                self.send_json(200, {"ok": bool(raw.get("success")), "status": "sent" if raw.get("success") else "failed", "raw": raw})
            else:
                self.send_json(404, {"error": "not found", "code": "NOT_FOUND"})
        except (HTTPError, URLError, TimeoutError, OSError) as error:
            self.api_error(error)

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
