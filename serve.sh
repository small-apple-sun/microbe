#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-8767}"
echo "Serving on http://127.0.0.1:${PORT}"
python3 -m http.server "${PORT}"
