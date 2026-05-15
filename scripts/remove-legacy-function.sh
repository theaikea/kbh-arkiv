#!/usr/bin/env bash
# Removes the old HTTPS function name so it cannot block Firestore deploys.
# Safe to run every deploy — exits 0 if the function does not exist.
set -euo pipefail
LEGACY_NAME="enrichImageWithOpenAI"
REGION="us-central1"

if command -v firebase >/dev/null 2>&1; then
  if firebase functions:delete "$LEGACY_NAME" --region "$REGION" --force >/dev/null 2>&1; then
    echo "Removed legacy HTTPS function: $LEGACY_NAME"
  else
    echo "No legacy function $LEGACY_NAME (OK)."
  fi
else
  echo "firebase CLI not found — skip legacy function cleanup."
fi
