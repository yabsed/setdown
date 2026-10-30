#!/usr/bin/env bash
set -euo pipefail

if [[ $# == 0 ]]; then
  echo 'usage: with-isolated-display.sh <command> [args...]' >&2
  exit 2
fi

# Reuse this runner's display for nested npm scripts and both benchmark apps.
if [[ ${SETDOWN_ISOLATED_DISPLAY:-} == 1 && ${XDG_RUNTIME_DIR:-} == /tmp/setdown-display-runtime.* ]]; then
  if [[ -n ${DISPLAY:-} && -z ${WAYLAND_DISPLAY:-} ]] || [[ -S ${XDG_RUNTIME_DIR}/${WAYLAND_DISPLAY:-missing} && ( -z ${DISPLAY:-} || ${SETDOWN_TEST_DISPLAY:-} == xwayland ) ]]; then
    exec "$@"
  fi
fi

command -v dbus-run-session >/dev/null || { echo 'dbus-run-session is required for isolated GUI execution.' >&2; exit 1; }
if [[ ${SETDOWN_TEST_DISPLAY:-} == wayland || ${SETDOWN_TEST_DISPLAY:-} == xwayland ]] && ! command -v mutter >/dev/null; then
  echo 'The Wayland test suite requires headless Mutter.' >&2; exit 1
fi
if ! command -v xvfb-run >/dev/null && ! command -v mutter >/dev/null; then
  echo 'No isolated display available: install Xvfb (xvfb-run) or Mutter.' >&2
  exit 1
fi

setdown_runtime=$(mktemp -d /tmp/setdown-display-runtime.XXXXXX)
cleanup() {
  # Portal services can mount private FUSE directories in this runtime.
  for name in doc gvfs; do
    if command -v mountpoint >/dev/null && mountpoint -q "$setdown_runtime/$name"; then
      fusermount3 -u "$setdown_runtime/$name" || true
    fi
  done
  rm -rf -- "$setdown_runtime" || true
}
trap cleanup EXIT
chmod 700 "$setdown_runtime"
# Xvfb alone is insufficient when Electron inherits the desktop Wayland socket.
unset DISPLAY WAYLAND_DISPLAY WAYLAND_SOCKET DBUS_SESSION_BUS_ADDRESS
export XDG_RUNTIME_DIR="$setdown_runtime" GIO_USE_VFS=local

run_wayland_display() {
  set -euo pipefail
  if [[ ${SETDOWN_TEST_DISPLAY:-} == xwayland ]]; then
    # Mutter gives its child the private XWayland DISPLAY and authorization.
    # Never reuse the caller's desktop X server or guess its display number.
    mutter --headless --wayland --wayland-display "$WAYLAND_DISPLAY" --virtual-monitor 1920x1080 \
      -- env SETDOWN_ISOLATED_DISPLAY=1 "$@"
    return
  fi
  # Preserve the headless Mutter fallback; its socket lives only in our runtime.
  mutter --headless --wayland --no-x11 --wayland-display "$WAYLAND_DISPLAY" --virtual-monitor 1920x1080 \
    >"$XDG_RUNTIME_DIR/mutter.log" 2>&1 &
  setdown_compositor=$!
  stop_compositor() { kill "$setdown_compositor" 2>/dev/null || true; wait "$setdown_compositor" 2>/dev/null || true; }
  trap stop_compositor EXIT
  for _ in {1..100}; do
    [[ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]] && break
    kill -0 "$setdown_compositor" 2>/dev/null || { cat "$XDG_RUNTIME_DIR/mutter.log" >&2; exit 1; }
    sleep .1
  done
  [[ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]] || { echo 'Headless Mutter display did not appear.' >&2; exit 1; }
  export SETDOWN_ISOLATED_DISPLAY=1
  "$@"
}
export -f run_wayland_display

# Start D-Bus after selecting the display so activated services inherit it too.
if [[ ${SETDOWN_TEST_DISPLAY:-} != wayland && ${SETDOWN_TEST_DISPLAY:-} != xwayland ]] && command -v xvfb-run >/dev/null; then
  export XDG_SESSION_TYPE=x11 ELECTRON_OZONE_PLATFORM_HINT=x11 GDK_BACKEND=x11 QT_QPA_PLATFORM=xcb
  xvfb-run -a -s '-screen 0 1920x1080x24 -nolisten tcp' \
    dbus-run-session -- env SETDOWN_ISOLATED_DISPLAY=1 "$@"
else
  # Native cross-window drag tests need the real Wayland compositor. Keep its
  # keybindings/profile private as well as its display and D-Bus session.
  export XDG_CONFIG_HOME="$setdown_runtime/config" XDG_CACHE_HOME="$setdown_runtime/cache" GSETTINGS_BACKEND=keyfile
  mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"
  gsettings set org.gnome.mutter.keybindings toggle-tiled-left "['<Super>Left']"
  gsettings set org.gnome.mutter.keybindings toggle-tiled-right "['<Super>Right']"
  export XDG_SESSION_TYPE=wayland ELECTRON_OZONE_PLATFORM_HINT=wayland GDK_BACKEND=wayland QT_QPA_PLATFORM=wayland
  export WAYLAND_DISPLAY="setdown-wayland-$$"
  dbus-run-session -- bash -c 'run_wayland_display "$@"' setdown-isolated "$@"
fi
