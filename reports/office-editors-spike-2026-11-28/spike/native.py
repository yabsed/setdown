# Real X11 input on the isolated display: a click, named keys, or lowercase letters typed one by one.
import ctypes, ctypes.util, json, sys, time
x = ctypes.CDLL(ctypes.util.find_library('X11')); t = ctypes.CDLL(ctypes.util.find_library('Xtst'))
x.XOpenDisplay.restype = ctypes.c_void_p
x.XFlush.argtypes = [ctypes.c_void_p]; x.XCloseDisplay.argtypes = [ctypes.c_void_p]
x.XStringToKeysym.argtypes = [ctypes.c_char_p]; x.XStringToKeysym.restype = ctypes.c_ulong
x.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]; x.XKeysymToKeycode.restype = ctypes.c_uint
t.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
t.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
t.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
d = x.XOpenDisplay(None)
if not d: raise RuntimeError('No X display')
data = json.loads(sys.argv[1])
def key(name):
    code = x.XKeysymToKeycode(d, x.XStringToKeysym(name.encode()))
    if not code: raise ValueError('Unknown X11 key: ' + name)
    t.XTestFakeKeyEvent(d, code, 1, 0); t.XTestFakeKeyEvent(d, code, 0, 0); x.XFlush(d)
if 'click' in data:
    p = data['click']; t.XTestFakeMotionEvent(d, -1, round(p['x']), round(p['y']), 0); x.XFlush(d); time.sleep(.05)
    t.XTestFakeButtonEvent(d, 1, 1, 0); t.XTestFakeButtonEvent(d, 1, 0, 0); x.XFlush(d)
for step in data.get('steps', []):
    if step.startswith('key:'): key(step[4:]); time.sleep(.2)
    else:
        for c in step: key(c); time.sleep(.14)
x.XCloseDisplay(d)
