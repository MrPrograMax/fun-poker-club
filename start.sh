#!/bin/sh
set -eu

# Resolve files and saved games relative to this launcher, even when opened elsewhere.
APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$APP_DIR"

if [ -f ./until-morning ]; then
  APP_BINARY=./until-morning
elif [ -f ./go.mod ]; then
  if ! command -v go >/dev/null 2>&1; then
    printf '%s\n' 'Go 1.24+ is needed to run the source code.' \
      'For a ready-to-run app without Go, download an archive from:' \
      'https://github.com/MrPrograMax/fun-poker-club/releases/latest'
    exit 1
  fi
  printf '%s\n' 'Building Until Morning...'
  mkdir -p .local
  go build -o .local/until-morning .
  APP_BINARY=./.local/until-morning
else
  printf '%s\n' 'App binary is missing. Extract the entire release archive and try again.'
  exit 1
fi

printf '%s\n' 'Until Morning — open the address printed below in your browser.' \
  'Keep this window open while playing. Press Ctrl+C to stop.'
exec "$APP_BINARY"
