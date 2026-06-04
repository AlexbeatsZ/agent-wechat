#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WEB_DIR="$ROOT_DIR/wechat-web"

CONTAINER="agent-wechat-web"
IMAGE="agent-wechat-web:dev"
PORT="3001"
AGENT_URL="http://host.docker.internal:6174"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --container)
      CONTAINER="${2:-}"
      shift 2
      ;;
    --image)
      IMAGE="${2:-}"
      shift 2
      ;;
    --port)
      PORT="${2:-}"
      shift 2
      ;;
    --agent-url)
      AGENT_URL="${2:-}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      echo "Usage: $0 [--container name] [--image tag] [--port 3001] [--agent-url url]" >&2
      exit 1
      ;;
  esac
done

TOKEN_DIR="$HOME/.config/agent-wechat"
TOKEN_PATH="$TOKEN_DIR/token"
if [ ! -f "$TOKEN_PATH" ]; then
  mkdir -p "$TOKEN_DIR"
  openssl rand -hex 32 > "$TOKEN_PATH"
  chmod 600 "$TOKEN_PATH"
  echo "Auth token generated: $TOKEN_PATH"
fi

echo "==> Building web frontend"
pnpm --filter @wechat-web/web build

echo "==> Building web image: $IMAGE"
docker build -t "$IMAGE" -f "$WEB_DIR/Dockerfile.deploy" "$WEB_DIR"

echo "==> Restarting web container: $CONTAINER"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

docker run -d \
  --name "$CONTAINER" \
  --add-host=host.docker.internal:host-gateway \
  -p "$PORT:3001" \
  -e "AGENT_WECHAT_BASE_URL=$AGENT_URL" \
  -v "$TOKEN_PATH:/run/secrets/agent-wechat-token:ro" \
  "$IMAGE" >/dev/null

echo "==> Waiting for web health"
for _ in {1..30}; do
  if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    echo "Web is ready: http://localhost:$PORT"
    exit 0
  fi
  sleep 1
  printf "."
done

echo ""
echo "Web did not become ready. Check logs with: docker logs $CONTAINER" >&2
exit 1
