#!/usr/bin/env bash
set -euo pipefail

# Cross-compile the Rust server and deploy into a running container.
# Usage:
#   ./scripts/dev-deploy.sh                 # auto-detect arch + container
#   ./scripts/dev-deploy.sh --arch arm64    # force architecture
#   ./scripts/dev-deploy.sh --container abc # specify container name/id

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
RUST_DIR="$ROOT_DIR/packages/agent-server-rust"

ARCH=""
CONTAINER=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --arch)
      ARCH="${2:-}"
      shift 2
      ;;
    --container)
      CONTAINER="${2:-}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      echo "Usage: $0 [--arch arm64|amd64] [--container name]" >&2
      exit 1
      ;;
  esac
done

# Auto-detect architecture from running container
if [ -z "$ARCH" ]; then
  if [ -n "$CONTAINER" ]; then
    ARCH=$(docker inspect --format '{{.Architecture}}' "$CONTAINER" 2>/dev/null || echo "")
  fi
  if [ -z "$ARCH" ]; then
    # Default to host arch
    case "$(uname -m)" in
      x86_64)  ARCH="amd64" ;;
      aarch64|arm64) ARCH="arm64" ;;
      *) echo "Unknown architecture: $(uname -m)" >&2; exit 1 ;;
    esac
  fi
fi

# Map to Rust target triple
case "$ARCH" in
  amd64|x86_64)
    TARGET="x86_64-unknown-linux-gnu"
    ;;
  arm64|aarch64)
    TARGET="aarch64-unknown-linux-gnu"
    ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

# Auto-detect container if not specified
if [ -z "$CONTAINER" ]; then
  CONTAINER=$(docker ps --filter "ancestor=agent-wechat:${ARCH}" --format '{{.Names}}' | head -1)
  if [ -z "$CONTAINER" ]; then
    CONTAINER=$(docker ps --filter "name=agent-wechat" --format '{{.Names}}' | head -1)
  fi
  if [ -z "$CONTAINER" ]; then
    echo "No running agent-wechat container found. Specify with --container" >&2
    exit 1
  fi
fi

echo "==> Cross-compiling for $TARGET"
cd "$RUST_DIR"
cross build --release --target "$TARGET"

BINARY="$RUST_DIR/target/$TARGET/release/agent-server"
if [ ! -f "$BINARY" ]; then
  echo "Binary not found at $BINARY" >&2
  exit 1
fi

echo "==> Deploying to container: $CONTAINER"
docker cp "$BINARY" "$CONTAINER:/opt/agent-server/agent-server"

echo "==> Restarting container"
docker restart "$CONTAINER"

echo "==> Done. Container restarting with new binary."
