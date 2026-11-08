"""Read XI 2.4 pinch events on one owned window, never global/raw input.

Chromium's X11 backend does not translate these events. XWayland already forwards
Wayland pointer gestures to XI2, so no device access or pointer grab is needed.
ABI: libXi's XInput2.h (XIGesturePinchEvent), Xlib.h (XGenericEventCookie).
"""
import ctypes as C
import json
import math
import select
import sys


class Modifiers(C.Structure):
    _fields_ = [(name, C.c_int) for name in ('base', 'latched', 'locked', 'effective')]


class Cookie(C.Structure):
    _fields_ = [('type', C.c_int), ('serial', C.c_ulong), ('send_event', C.c_int),
                ('display', C.c_void_p), ('extension', C.c_int), ('evtype', C.c_int),
                ('cookie', C.c_uint), ('data', C.c_void_p)]


class Event(C.Union):
    _fields_ = [('cookie', Cookie), ('pad', C.c_long * 24)]


class Pinch(C.Structure):
    _fields_ = Cookie._fields_[:6] + [('time', C.c_ulong)] + [
        (name, C.c_int) for name in ('deviceid', 'sourceid', 'detail')
    ] + [(name, C.c_ulong) for name in ('root', 'event', 'child')] + [
        (name, C.c_double) for name in ('root_x', 'root_y', 'event_x', 'event_y',
                                      'delta_x', 'delta_y', 'delta_unaccel_x',
                                      'delta_unaccel_y', 'scale', 'delta_angle')
    ] + [('flags', C.c_int), ('mods', Modifiers), ('group', Modifiers)]


class Mask(C.Structure):
    _fields_ = [('deviceid', C.c_int), ('mask_len', C.c_int), ('mask', C.POINTER(C.c_ubyte))]


def main():
    window = int(sys.argv[1])
    x = C.CDLL('libX11.so.6')
    xi = C.CDLL('libXi.so.6')
    x.XOpenDisplay.argtypes = [C.c_char_p]
    x.XOpenDisplay.restype = C.c_void_p
    for name in ('XCloseDisplay', 'XConnectionNumber', 'XPending', 'XFlush'):
        getattr(x, name).argtypes = [C.c_void_p]
    x.XQueryExtension.argtypes = [C.c_void_p, C.c_char_p, C.POINTER(C.c_int), C.POINTER(C.c_int), C.POINTER(C.c_int)]
    x.XNextEvent.argtypes = [C.c_void_p, C.POINTER(Event)]
    x.XGetEventData.argtypes = [C.c_void_p, C.POINTER(Cookie)]
    x.XFreeEventData.argtypes = [C.c_void_p, C.POINTER(Cookie)]
    xi.XIQueryVersion.argtypes = [C.c_void_p, C.POINTER(C.c_int), C.POINTER(C.c_int)]
    xi.XISelectEvents.argtypes = [C.c_void_p, C.c_ulong, C.POINTER(Mask), C.c_int]
    display = x.XOpenDisplay(None)
    if not display:
        raise RuntimeError('X11 display unavailable')
    try:
        opcode, event_base, error_base = C.c_int(), C.c_int(), C.c_int()
        major, minor = C.c_int(2), C.c_int(4)
        if (not x.XQueryExtension(display, b'XInputExtension', C.byref(opcode), C.byref(event_base), C.byref(error_base))
                or xi.XIQueryVersion(display, C.byref(major), C.byref(minor))
                or (major.value, minor.value) < (2, 4)):
            print(json.dumps({'ready': False}), flush=True)
            return
        bits = (C.c_ubyte * 4)()
        for kind in (27, 28, 29):  # XI_GesturePinchBegin/Update/End
            bits[kind >> 3] |= 1 << (kind & 7)
        mask = Mask(1, len(bits), bits)  # XIAllMasterDevices; no duplicate slave events
        xi.XISelectEvents(display, window, C.byref(mask), 1)
        x.XFlush(display)
        print(json.dumps({'ready': True}), flush=True)
        event = Event()
        while True:
            if not x.XPending(display):
                ready, _, _ = select.select([x.XConnectionNumber(display), sys.stdin], [], [])
                if sys.stdin in ready and not sys.stdin.buffer.read(1):
                    return  # Parent exited, including an interrupted application.
            while x.XPending(display):
                x.XNextEvent(display, C.byref(event))
                cookie = event.cookie
                if cookie.type != 35 or cookie.extension != opcode.value or cookie.evtype not in (27, 28, 29):
                    continue
                if not x.XGetEventData(display, C.byref(cookie)):
                    continue
                try:
                    pinch = C.cast(cookie.data, C.POINTER(Pinch)).contents
                    if (pinch.send_event or pinch.event != window or pinch.detail != 2
                            or not all(math.isfinite(n) for n in (pinch.scale, pinch.root_x, pinch.root_y))):
                        continue
                    print(json.dumps({'type': {27: 'begin', 28: 'update', 29: 'end'}[pinch.evtype],
                                      'device': pinch.deviceid, 'scale': pinch.scale,
                                      'x': pinch.root_x, 'y': pinch.root_y,
                                      'cancelled': bool(pinch.flags & 1)}), flush=True)
                finally:
                    x.XFreeEventData(display, C.byref(cookie))
    finally:
        x.XCloseDisplay(display)


if __name__ == '__main__':
    main()
