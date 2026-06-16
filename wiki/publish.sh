#!/usr/bin/env bash
# Publish the Markdown pages in this folder to the GitHub wiki.
#
# The GitHub wiki is a separate git repository (<repo>.wiki.git) that this CI
# environment cannot reach, so publishing is done from a machine that has GitHub
# access (your laptop). Run this from the repository root:
#
#   bash wiki/publish.sh
#
# Prerequisites:
#   - git, with push access to the repository's wiki.
#   - The wiki must be initialised once (create any page in the GitHub web UI:
#     repo -> Wiki -> Create the first page), otherwise the wiki repo does not
#     exist yet and the clone below will fail.
set -euo pipefail

REPO_WIKI="https://github.com/unmaykr-a/taskrr.wiki.git"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Cloning wiki: $REPO_WIKI"
git clone "$REPO_WIKI" "$TMP_DIR/wiki"

echo "Copying pages"
cp "$SRC_DIR"/*.md "$TMP_DIR/wiki"/

cd "$TMP_DIR/wiki"
git add -A
if git diff --cached --quiet; then
  echo "No changes to publish."
  exit 0
fi
git commit -m "Update wiki documentation"
git push origin HEAD
echo "Wiki updated."
