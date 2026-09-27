#!/usr/bin/env bash
set -euo pipefail

WORKTREE_DIR="$(pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

if [ "$WORKTREE_DIR" != "$REPO_ROOT" ] && [ ! -e "$WORKTREE_DIR/node_modules" ]; then
    if [ -d "$REPO_ROOT/node_modules" ]; then
        ln -s "$REPO_ROOT/node_modules" "$WORKTREE_DIR/node_modules"
        echo "[init-worktree] Linked node_modules from $REPO_ROOT"
    fi
fi
