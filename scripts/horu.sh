#!/usr/bin/env bash
# Horu on macOS/Linux (what Horu.exe does on Windows): starts the laptop service in the background and
# restarts it if it stops.
#   scripts/horu.sh start | stop | status | pair | run
# `run` keeps it in the foreground (used by launchd/systemd).

root="$(cd "$(dirname "$0")/.." && pwd)"
pidfile="$root/data/horu.pid"
mkdir -p "$root/data"

supervise() {
  while true; do
    node "$root/server/src/main.ts" >>"$root/data/horu.log" 2>&1
    echo "Horu stopped ($?), restarting in 3 s" >>"$root/data/horu.log"
    sleep 3
  done
}

running() { [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; }

case "${1:-start}" in
  run) supervise ;;
  start)
    if running; then echo "Horu is already running."; exit 0; fi
    nohup "$0" run >/dev/null 2>&1 &
    echo $! >"$pidfile"
    echo "Horu started: http://localhost:7317"
    ;;
  stop)
    if running; then
      pid="$(cat "$pidfile")"
      pkill -P "$pid" 2>/dev/null
      kill "$pid" 2>/dev/null
      rm -f "$pidfile"
      echo "Horu stopped."
    else
      echo "Horu is not running."
    fi
    ;;
  status) if running; then echo "Horu is running."; else echo "Horu is not running."; fi ;;
  pair)
    url="http://localhost:7317/pair"
    if command -v open >/dev/null 2>&1; then open "$url"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url"; else echo "$url"; fi
    ;;
  *) echo "Usage: scripts/horu.sh start | stop | status | pair | run"; exit 1 ;;
esac
