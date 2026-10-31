"""Persistent virtual input device for the private headless Mutter test runner."""
import ctypes
import ctypes.util
import json
import os
import sys
import time
from gi.repository import Gio, GLib

if (os.environ.get('SETDOWN_ISOLATED_DISPLAY') != '1'
        or not os.environ.get('XDG_RUNTIME_DIR', '').startswith('/tmp/setdown-display-runtime.')
        or (os.environ.get('DISPLAY') and os.environ.get('SETDOWN_TEST_DISPLAY') != 'xwayland')
        or not os.environ.get('WAYLAND_DISPLAY')):
    raise RuntimeError('Isolated Wayland required')

bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
destination = 'org.gnome.Mutter.RemoteDesktop'


def call(path, interface, method, args=None):
    return bus.call_sync(destination, path, interface, method, args, None,
                         Gio.DBusCallFlags.NONE, 10000, None).unpack()


session = call('/org/gnome/Mutter/RemoteDesktop', destination, 'CreateSession')[0]
interface = destination + '.Session'
call(session, interface, 'Start')


def invoke(method, signature, args):
    call(session, interface, method, GLib.Variant(signature, args))


# Clamp to the private monitor's top-left, then maintain its known position.
# Electron's global window coordinates are unavailable on Wayland.
invoke('NotifyPointerMotionRelative', '(dd)', (-10000., -10000.))
point = [0., 0.]
xkb = ctypes.CDLL(ctypes.util.find_library('xkbcommon'))
xkb.xkb_keysym_from_name.argtypes = [ctypes.c_char_p, ctypes.c_int]
xkb.xkb_keysym_from_name.restype = ctypes.c_uint


def key(name, down):
    code = xkb.xkb_keysym_from_name(name.encode(), 0)
    if not code:
        raise ValueError('Unknown key ' + name)
    invoke('NotifyKeyboardKeysym', '(ub)', (code, down))


def move(position):
    x, y = float(position['x']), float(position['y'])
    invoke('NotifyPointerMotionRelative', '(dd)', (x - point[0], y - point[1]))
    point[:] = [x, y]


print(json.dumps({'ready': True}), flush=True)
try:
    for line in sys.stdin:
        try:
            data = json.loads(line)
            if data.get('resetPointer'):
                # A fullscreen transition can warp the compositor cursor.
                # Rebase our relative coordinates before the next gesture.
                invoke('NotifyPointerMotionRelative', '(dd)', (-10000., -10000.))
                point[:] = [0., 0.]
                time.sleep(.04)
            for name in data.get('keyDown', []):
                key(name, True)
            for position in data.get('pointer', []):
                move(position)
                time.sleep(data.get('pointerIntervalMs', 40) / 1000)
            if 'button' in data:
                invoke('NotifyPointerButton', '(ib)', (272, data['button'] == 'down'))
            if 'click' in data:
                move(data['click'])
                invoke('NotifyPointerButton', '(ib)', (272, True))
                invoke('NotifyPointerButton', '(ib)', (272, False))
            for name in data.get('keys', []):
                key(name, True)
                key(name, False)
            for name in data.get('keyUp', []):
                key(name, False)
            print(json.dumps({'ok': True}), flush=True)
        except Exception as error:
            print(json.dumps({'error': str(error)}), flush=True)
finally:
    call(session, interface, 'Stop')
