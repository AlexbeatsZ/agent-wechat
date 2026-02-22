#!/usr/bin/env bash
set -euo pipefail

# Download the WeChat .deb for the local architecture into docker/wechat.deb.
# This speeds up local Docker builds — the Dockerfile uses it if present.

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
OUT="$ROOT_DIR/docker/wechat.deb"

case "$(uname -m)" in
  x86_64)        ARCH_SUFFIX="x86_64" ;;
  aarch64|arm64) ARCH_SUFFIX="arm64" ;;
  *)
    echo "Unknown architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

URL="https://dldir1v6.qq.com/weixin/Universal/Linux/WeChatLinux_${ARCH_SUFFIX}.deb"

if [ -f "$OUT" ]; then
  echo "wechat.deb already exists. Delete docker/wechat.deb to re-download."
  ls -lh "$OUT"
  exit 0
fi

echo "Downloading WeChat for ${ARCH_SUFFIX}..."
curl -L -o "$OUT" "$URL"
echo "Saved to docker/wechat.deb ($(du -h "$OUT" | cut -f1))"
