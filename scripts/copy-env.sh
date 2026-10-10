#!/bin/sh
# Copy the repo's env files into Klair's data folder.
#
# A packaged Klair.app starts with cwd "/", so it can't see .env.local in the repo and
# reads <userData>/.env.local and <userData>/.env instead (src/main/env.ts).
# Copies, not symlinks: a link into a protected folder (~/Downloads, ~/Documents,
# ~/Desktop) makes macOS hold Klair's startup on a folder-access prompt.
# `pnpm app` runs this on every build, so the copies stay current.
set -eu

DATA="$HOME/Library/Application Support/Klair"
mkdir -p "$DATA"
for f in .env.local .env; do
  if [ -f "$f" ]; then
    rm -f "$DATA/$f"
    cp "$f" "$DATA/$f"
    chmod 600 "$DATA/$f"
    echo "copied $f → $DATA/$f"
  fi
done
