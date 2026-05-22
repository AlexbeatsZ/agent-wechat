# wechat-web

非串流网页版微信前端。浏览器只访问本项目 BFF，BFF 再读取本机 token 并调用 `agent-wechat` REST API。

## 启动 agent-wechat

本仓库已经提供项目内 `wx` wrapper，不需要全局安装：

```powershell
cd C:\Users\Meta\Project\Workspaces\agent-wechat
pnpm wx -- up
pnpm wx -- auth login
```

也可以使用全局 CLI：

```powershell
npm install -g @agent-wechat/cli
wx up
wx auth login
```

## 启动 wechat-web

```powershell
cd C:\Users\Meta\Project\Workspaces\agent-wechat\wechat-web
pnpm install
Copy-Item .env.example .env
pnpm dev
```

默认 Web 地址：`http://127.0.0.1:5173`。BFF 地址：`http://127.0.0.1:8787`。

无微信环境开发 UI：

```powershell
$env:AGENT_WECHAT_MOCK="true"
pnpm dev
```

## 环境变量

- `AGENT_WECHAT_BASE_URL`: agent-wechat REST 地址，默认 `http://127.0.0.1:6174`。
- `AGENT_WECHAT_TOKEN_FILE`: token 文件路径。当前推荐 `C:\Users\Meta\Project\Workspaces\agent-wechat\.agent-wechat-home\.config\agent-wechat\token`。
- `AGENT_WECHAT_MOCK`: `true` 时不连接真实 agent-wechat。
- `ENABLE_DEBUG_API`: `true` 时开放 `/api/screenshot` 和 `/api/a11y`。
- `BFF_SIMPLE_PASSWORD`: 非空时启用 Web 访问密码。
- `BFF_COOKIE_SECRET`: 启用密码时建议设置固定随机字符串。
- `BFF_HOST` / `BFF_PORT`: BFF 监听地址和端口。

## 安全说明

- 不要公网暴露 `agent-wechat:6174`。
- 不要把 token 放到前端代码、浏览器请求或日志中。
- 推荐通过 Tailscale、WireGuard、ZeroTier 等私有网络访问。
- 本项目仅用于个人自用，不做群发、营销、自动加人、多租户或审计系统。

## 验证

```powershell
pnpm typecheck
pnpm test
pnpm build
```
