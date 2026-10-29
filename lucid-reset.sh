#!/bin/bash
# lucid-reset — wipe Lucid Browser's local identity so the next launch is a
# brand-new user (fresh device UUID → fresh 30-day trial).
#
# This only clears LOCAL state. The old device's record still exists in the
# backend, harmlessly orphaned; the app just generates a new UUID next launch.
#
# Usage:
#   ./lucid-reset.sh          # reset to a fresh trial user
#   ./lucid-reset.sh rebuild  # reset, then rebuild and open the app

APP_SUPPORT="$HOME/Library/Application Support/lucid-browser"
LICENSE_FILE="$APP_SUPPORT/license.json"
PROJECT_DIR="$HOME/projects/ray-browser-app"

if [ -f "$LICENSE_FILE" ]; then
  rm "$LICENSE_FILE"
  echo "Cleared local identity — next launch starts a fresh 30-day trial."
else
  echo "No local identity found (already clean)."
fi

if [ "$1" == "rebuild" ]; then
  echo "Rebuilding…"
  cd "$PROJECT_DIR" || { echo "Project dir not found: $PROJECT_DIR"; exit 1; }
  rm -rf dist
  npm run build && open dist/mac
fi
