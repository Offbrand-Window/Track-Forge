#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-Offbrand-Window/Track-Forge}"
TAG="${2:-v1.0.0}"
TITLE="${3:-Track Forge ${TAG}}"

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required. Install it, then run: gh auth login"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Run: gh auth login"
  exit 1
fi

git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/${REPO}.git"
git push -u origin main

gh release create "$TAG" \
  --repo "$REPO" \
  --title "$TITLE" \
  --notes "Initial bundled macOS release for Track Forge." \
  "outputs/TrackForge-macOS.zip" \
  "outputs/Track Forge README.txt"
