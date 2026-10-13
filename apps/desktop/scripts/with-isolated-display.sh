#!/usr/bin/env bash
# Run a command on an isolated virtual display so GUI/Electron tests never
# open windows on (or steal focus from) the user's desktop. Prefers Xvfb;
# on Wayland desktops without it, falls back to a headless Mutter compositor
# with a virtual monitor in a throwaway runtime directory. Fails closed:
# it never falls back to the user's own display.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: with-isolated-display.sh <command> [args...]" >&2
  exit 2
fi

if command -v xvfb-run >/dev/null 2>&1; then
  exec xvfb-run -a --server-args="-screen 0 1920x1080x24" "$@"
fi

if command -v mutter >/dev/null 2>&1; then
  # Mutter and Chromium both expect a session bus; give this run its own.
  if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && command -v dbus-run-session >/dev/null 2>&1; then
    exec dbus-run-session -- "$0" "$@"
  fi
  runtime_dir="$(mktemp -d /tmp/setdown-isolated-display.XXXXXX)"
  chmod 700 "$runtime_dir"
  display_name="wayland-$$"
  XDG_RUNTIME_DIR="$runtime_dir" mutter --headless --wayland --no-x11 \
    --wayland-display "$display_name" --virtual-monitor 1920x1080 \
    >"$runtime_dir/mutter.log" 2>&1 &
  mutter_pid=$!
  cleanup() {
    kill "$mutter_pid" 2>/dev/null || true
    wait "$mutter_pid" 2>/dev/null || true
    rm -rf "$runtime_dir"
  }
  trap cleanup EXIT
  for _ in $(seq 1 100); do
    [ -S "$runtime_dir/$display_name" ] && break
    kill -0 "$mutter_pid" 2>/dev/null || {
      echo "headless mutter exited early:" >&2
      cat "$runtime_dir/mutter.log" >&2
      exit 1
    }
    sleep 0.1
  done
  [ -S "$runtime_dir/$display_name" ] || { echo "headless mutter display did not appear" >&2; exit 1; }
  status=0
  env -u DISPLAY XDG_RUNTIME_DIR="$runtime_dir" WAYLAND_DISPLAY="$display_name" "$@" || status=$?
  exit "$status"
fi

echo "no isolated display available: install Xvfb (xvfb-run) or mutter" >&2
exit 1
