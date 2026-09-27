#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKTREE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

PORT=$(acquire-port --wait)
export DSH_HOME="/root/.dsh-e2e"
export DSH_TOKEN="e2etest"

# Ensure plugin link in e2e profile points to this worktree
ln -snf "${WORKTREE_DIR}" "/root/.dsh-e2e/profiles/web/node_modules/dsh-live2d-voice"

echo "=========================================================="
echo "DSH Worktree Instance Ready:"
echo "URL: http://127.0.0.1:${PORT}/?token=${DSH_TOKEN}"
echo "Live Standalone URL: http://127.0.0.1:${PORT}/live2d-voice/app?session=session-660c2454-5ea1-48a7-8962-d73a1881e536"
echo "=========================================================="

exec dsh web --port "$PORT" --no-open
