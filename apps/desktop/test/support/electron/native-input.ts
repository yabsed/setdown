import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** OS input preserves the actual focused WebContents; locator typing can mask
 * a native focus loss by targeting the shell directly. */
export async function nativeInput(input: {
  click?: { x: number; y: number }; text?: string; keys?: string[];
  pointer?: { x: number; y: number }[]; button?: 'down' | 'up';
}) {
  if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1' || !process.env.DISPLAY) throw Error('Native input requires isolated Xvfb.');
  await promisify(execFile)('python3', ['-c', `
import ctypes, ctypes.util, json, sys, time
x=ctypes.CDLL(ctypes.util.find_library('X11')); t=ctypes.CDLL(ctypes.util.find_library('Xtst'))
x.XOpenDisplay.restype=ctypes.c_void_p
x.XFlush.argtypes=[ctypes.c_void_p]; x.XCloseDisplay.argtypes=[ctypes.c_void_p]
x.XStringToKeysym.argtypes=[ctypes.c_char_p]; x.XStringToKeysym.restype=ctypes.c_ulong
x.XKeysymToKeycode.argtypes=[ctypes.c_void_p,ctypes.c_ulong]; x.XKeysymToKeycode.restype=ctypes.c_uint
t.XTestFakeMotionEvent.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_ulong]
t.XTestFakeButtonEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
t.XTestFakeKeyEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
d=x.XOpenDisplay(None)
if not d: raise RuntimeError('No isolated X display')
data=json.loads(sys.argv[1])
for p in data.get('pointer',[]):
 t.XTestFakeMotionEvent(d,-1,round(p['x']),round(p['y']),0); x.XFlush(d); time.sleep(.04)
if 'button' in data:
 t.XTestFakeButtonEvent(d,1,int(data['button']=='down'),0); x.XFlush(d)
if 'click' in data:
 p=data['click']; t.XTestFakeMotionEvent(d,-1,round(p['x']),round(p['y']),0)
 t.XTestFakeButtonEvent(d,1,1,0); t.XTestFakeButtonEvent(d,1,0,0); x.XFlush(d)
for name in data.get('keys',[]):
 key=x.XKeysymToKeycode(d,x.XStringToKeysym(name.encode()))
 if not key: raise ValueError('Unknown X11 key: '+name)
 t.XTestFakeKeyEvent(d,key,1,0); t.XTestFakeKeyEvent(d,key,0,0); x.XFlush(d)
for c in data.get('text',''):
 if not ('a' <= c <= 'z'): raise ValueError('This helper types lowercase ASCII only')
 key=x.XKeysymToKeycode(d,x.XStringToKeysym(c.encode()))
 t.XTestFakeKeyEvent(d,key,1,0); t.XTestFakeKeyEvent(d,key,0,0); x.XFlush(d); time.sleep(.14)
x.XCloseDisplay(d)
`, JSON.stringify(input)]);
}
