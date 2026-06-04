#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

SYNC_TOOLS="false"
RELEASE="false"
BACKEND_CONTAINER=""
WEB_CONTAINER=""
WEB_PORT="3001"
AGENT_URL="http://host.docker.internal:6174"

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
    *)
      echo "unknown argument: $1" >&2
      echo "Usage: $0 [--sync-tools] [--release] [--backend-container name] [--web-container name] [--web-port 3001] [--agent-url url]" >&2
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
fi

echo "==> Deploying backend"
"$ROOT_DIR/scripts/dev-deploy.sh" "${BACKEND_ARGS[@]}"

WEB_ARGS=(--port "$WEB_PORT" --agent-url "$AGENT_URL")
if [ -n "$WEB_CONTAINER" ]; then
  WEB_ARGS+=(--container "$WEB_CONTAINER")
fi

echo "==> Deploying web"
"$ROOT_DIR/scripts/dev-deploy-web.sh" "${WEB_ARGS[@]}"

echo "==> Final health checks"
curl -fsS http://localhost:6174/health >/dev/null && echo "Backend OK: http://localhost:6174"
curl -fsS "http://localhost:$WEB_PORT/api/health" >/dev/null && echo "Web OK: http://localhost:$WEB_PORT"
