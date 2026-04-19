#!/usr/bin/env bash
set -euo pipefail

# 默认 8877，避免与 parasite-slide-learn 等占用 8767 的旧服务冲突
PORT="${1:-8877}"
echo "Serving on http://127.0.0.1:${PORT}"
python3 -m http.server "${PORT}"
