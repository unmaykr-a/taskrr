#!/usr/bin/env bash
# Publish the Markdown pages in this folder to the GitHub wiki.
#
# The GitHub wiki is a separate git repository (<repo>.wiki.git). Run this from a
# machine that has push access to the repo (for example your server), from the
# repository root:
#
#   bash wiki/publish.sh
#
# GitHub no longer accepts a password over HTTPS, so use ONE of these:
#
#   1. gh CLI (easiest if installed and logged in):
#        gh auth login          # once
#        bash wiki/publish.sh   # this script runs `gh auth setup-git` for you
#
#   2. SSH key registered with GitHub:
#        WIKI_REMOTE=git@github.com:unmaykr-a/taskrr.wiki.git bash wiki/publish.sh
#
#   3. A personal access token (classic or fine-grained) with repo write:
#        WIKI_TOKEN=ghp_your_token bash wiki/publish.sh
#
# Prerequisite: the wiki must be initialised once (repo -> Wiki -> create any
# first page) so that taskrr.wiki.git exists.
set -euo pipefail

OWNER_REPO="unmaykr-a/taskrr"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Pick the remote URL based on which auth method is available.
if [ -n "${WIKI_REMOTE:-}" ]; then
  REMOTE="$WIKI_REMOTE"                                            # explicit (e.g. SSH)
elif [ -n "${WIKI_TOKEN:-}" ]; then
  REMOTE="https://${WIKI_TOKEN}@github.com/${OWNER_REPO}.wiki.git" # token in URL
else
  REMOTE="https://github.com/${OWNER_REPO}.wiki.git"              # rely on a credential helper
  if command -v gh >/dev/null 2>&1; then
    gh auth setup-git >/dev/null 2>&1 || true                     # wire gh as the helper
  fi
fi

echo "Cloning wiki"
git clone "$REMOTE" "$TMP_DIR/wiki"

echo "Copying pages"
cp "$SRC_DIR"/*.md "$TMP_DIR/wiki"/

cd "$TMP_DIR/wiki"
git add -A
if git diff --cached --quiet; then
  echo "No changes to publish."
  exit 0
fi
git commit -m "Update wiki documentation"
if ! git push origin HEAD; then
  cat >&2 <<'MSG'

Push failed. GitHub does not accept password auth over HTTPS. Use one of:
  - gh CLI:  run `gh auth login`, then re-run this script
  - SSH:     WIKI_REMOTE=git@github.com:unmaykr-a/taskrr.wiki.git bash wiki/publish.sh
  - token:   WIKI_TOKEN=<personal-access-token> bash wiki/publish.sh
MSG
  exit 1
fi
echo "Wiki updated."
