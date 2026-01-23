#!/bin/bash

set -e

if [ "$VERCEL_URL" != "" ] && ! command -v go &>/dev/null; then
  curl https://raw.githubusercontent.com/canha/golang-tools-install-script/refs/heads/master/goinstall.sh | bash
  source "$HOME/.bashrc"
fi

PIDS=()
go build -o pty-tunnel-server -ldflags "-w" &
PIDS+=($!)
GOOS="linux" GOARCH="amd64" go build -o public/linux-x86_64 -ldflags "-w" &
PIDS+=($!)
GOOS="linux" GOARCH="arm64" go build -o public/linux-arm64 -ldflags "-w" &
PIDS+=($!)

for PID in "${PIDS[@]}"; do
  wait "$PID"
done
