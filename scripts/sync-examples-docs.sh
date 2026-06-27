#!/usr/bin/env bash
set -euo pipefail

# Copy docs and README from a checked-out macp-playground repo into
# docs-content/macp-playground/ for rendering by the /docs route.
#
# Usage:
#   ./scripts/sync-examples-docs.sh [EXAMPLES_SERVICE_DIR]
#
# If EXAMPLES_SERVICE_DIR is not given, it defaults to the sibling directory
# ../macp-playground (relative to this script's repo root).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_DIR="${1:-$(cd "$REPO_ROOT/.." && pwd)/macp-playground}"
TARGET_DIR="$REPO_ROOT/docs-content/macp-playground"

if [ ! -d "$SOURCE_DIR" ]; then
  echo "Error: Examples Service directory not found at $SOURCE_DIR"
  exit 1
fi

echo "Syncing from: $SOURCE_DIR"
echo "Syncing to:   $TARGET_DIR"

mkdir -p "$TARGET_DIR"

# Wipe existing .md files so deletions in the source are reflected.
# Preserve _readme.md handling below (overwritten next).
find "$TARGET_DIR" -maxdepth 1 -type f -name '*.md' -delete

# Copy docs/*.md as-is.
if [ -d "$SOURCE_DIR/docs" ]; then
  copied=0
  for file in "$SOURCE_DIR"/docs/*.md; do
    [ -f "$file" ] || continue
    cp "$file" "$TARGET_DIR/$(basename "$file")"
    copied=$((copied + 1))
  done
  echo "Copied $copied doc(s) from docs/"
else
  echo "Warning: $SOURCE_DIR/docs not found; skipping"
fi

# Copy README.md as _readme.md so it won't collide with a potential
# README.md doc slug, and the loader can recognise it specially.
if [ -f "$SOURCE_DIR/README.md" ]; then
  cp "$SOURCE_DIR/README.md" "$TARGET_DIR/_readme.md"
  echo "Copied README.md → _readme.md"
fi

echo "Done."
