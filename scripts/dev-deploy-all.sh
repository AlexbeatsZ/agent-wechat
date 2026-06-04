#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

SYNC_TOOLS="false"
RELEASE="false"
BACKEND_CONTAINER=""
WEB_CONTAINER=""
WEB_PORT="3001"
AGENT_URL="http://127.0.0.1:6174"
LEGACY_WEB_CONTAINER="false"

usage() {
  echo "Usage: $0 [--sync-tools] [--release] [--backend-container name] [--web-port 3001] [--agent-url url] [--legacy-web-container --web-container name]" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --sync-tools)
      SYNC_TOOLS="true"
      shift
      ;;
    --release)
      RELEASE="true"
      shift
      ;;
    --backend-container)
      BACKEND_CONTAINER="${2:-}"
      shift 2
      ;;
    --web-container)
      WEB_CONTAINER="${2:-}"
      shift 2
      ;;
    --web-port)
      WEB_PORT="${2:-}"
      shift 2
      ;;
    --agent-url)
      AGENT_URL="${2:-}"
      shift 2
      ;;
    --legacy-web-container)
      LEGACY_WEB_CONTAINER="true"
      shift
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

BACKEND_ARGS=()
if [ "$RELEASE" = "true" ]; then
  BACKEND_ARGS+=(--release)
fi
if [ "$SYNC_TOOLS" = "true" ]; then
  BACKEND_ARGS+=(--sync-tools)
fi
if [ -n "$BACKEND_CONTAINER" ]; then
  BACKEND_ARGS+=(--container "$BACKEND_CONTAINER")
else
  BACKEND_CONTAINER="agent-wechat"
fi

echo "==> Deploying backend"
"$ROOT_DIR/scripts/dev-deploy.sh" "${BACKEND_ARGS[@]}"

echo "==> Building web"
pnpm --filter @wechat-web/web build

if [ "$LEGACY_WEB_CONTAINER" = "true" ]; then
  WEB_ARGS=(--port "$WEB_PORT" --agent-url "$AGENT_URL")
  if [ -n "$WEB_CONTAINER" ]; then
    WEB_ARGS+=(--container "$WEB_CONTAINER")
  fi

  echo "==> Deploying legacy standalone web container"
  "$ROOT_DIR/scripts/dev-deploy-web.sh" "${WEB_ARGS[@]}"
else
  echo "==> Deploying bundled web into $BACKEND_CONTAINER"
  docker exec "$BACKEND_CONTAINER" sh -lc 'mkdir -p /opt/wechat-web/dist'
  docker cp "$ROOT_DIR/wechat-web/deploy_server.py" "$BACKEND_CONTAINER:/opt/wechat-web/deploy_server.py"
  docker cp "$ROOT_DIR/wechat-web/apps/web/dist/." "$BACKEND_CONTAINER:/opt/wechat-web/dist/"

  echo "==> Restarting bundled web server"
  docker exec "$BACKEND_CONTAINER" sh -lc "pkill -f '/opt/wechat-web/deploy_server.py' 2>/dev/null || true; HOST=0.0.0.0 PORT=$WEB_PORT WEB_ROOT=/opt/wechat-web/dist AGENT_WECHAT_BASE_URL=$AGENT_URL AGENT_WECHAT_TOKEN_FILE=/data/auth-token nohup python3 /opt/wechat-web/deploy_server.py >/tmp/wechat-web.log 2>&1 &"
fi

echo "==> Final health checks"
curl -fsS http://localhost:6174/health >/dev/null && echo "Backend OK: http://localhost:6174"
curl -fsS "http://localhost:$WEB_PORT/api/health" >/dev/null && echo "Web OK: http://localhost:$WEB_PORT"
