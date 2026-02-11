#!/usr/bin/env bash
set -euo pipefail

# Watch Rust source, cross-compile on change, and hot-swap the binary
# in the running container (restarts only the server process).
#
# Usage:
#   pnpm dev:watch                     # auto-detect everything
#   pnpm dev:watch --container foo     # specify container

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
RUST_DIR="$ROOT_DIR/packages/agent-server-rust"

CONTAINER=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --container)
      CONTAINER="${2:-}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      echo "Usage: $0 [--container name]" >&2
      exit 1
      ;;
  esac
done

# Auto-detect container
if [ -z "$CONTAINER" ]; then
  CONTAINER=$(docker ps --filter "name=agent-wechat" --format '{{.Names}}' | head -1)
  if [ -z "$CONTAINER" ]; then
    echo "No running agent-wechat container found. Start one with: pnpm dev" >&2
    exit 1
  fi
fi

# Detect container architecture
CONTAINER_ARCH=$(docker inspect --format '{{.Architecture}}' "$CONTAINER" 2>/dev/null || echo "")
case "$CONTAINER_ARCH" in
  amd64)  TARGET="x86_64-unknown-linux-gnu" ;;
  arm64)  TARGET="aarch64-unknown-linux-gnu" ;;
  *)
    # Fall back to host arch
    case "$(uname -m)" in
      x86_64)        TARGET="x86_64-unknown-linux-gnu" ;;
      aarch64|arm64) TARGET="aarch64-unknown-linux-gnu" ;;
      *)
        echo "Unknown architecture. Cannot determine cross-compile target." >&2
        exit 1
        ;;
    esac
    ;;
esac

BINARY="$RUST_DIR/target/$TARGET/release/agent-server"

echo "Watching $RUST_DIR"
echo "  Target:    $TARGET"
echo "  Container: $CONTAINER"
echo "  Binary:    $BINARY"
echo ""

# Write a temp deploy script that cargo watch will call
DEPLOY_SCRIPT=$(mktemp)
trap "rm -f $DEPLOY_SCRIPT" EXIT

cat > "$DEPLOY_SCRIPT" <<SCRIPT
#!/usr/bin/env bash
set -euo pipefail
cd "$RUST_DIR"
cross build --release --target $TARGET
echo "==> Deploying to $CONTAINER"
docker cp "$BINARY" "$CONTAINER:/opt/agent-server/agent-server"
docker exec "$CONTAINER" pkill -f '/opt/agent-server/agent-server' 2>/dev/null || true
echo "==> Server restarting with new binary"
SCRIPT
chmod +x "$DEPLOY_SCRIPT"

cd "$RUST_DIR"
cargo watch -w src -w migrations -s "$DEPLOY_SCRIPT"
