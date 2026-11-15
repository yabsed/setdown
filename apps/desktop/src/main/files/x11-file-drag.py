"""An XDND drag source for a folder tab's files on a Wayland desktop.

Setdown is an XWayland client there. Chromium's own X11 drag source cannot hand
files to a native Wayland application through Mutter's XDND bridge: it looks for
drop targets only in _NET_CLIENT_LIST_STACKING, which never lists the
compositor's proxy window, and it sends XDND messages from a window that does
not own XdndSelection, which the bridge ignores. This source owns the selection
with the window it speaks from and finds the proxy, so X11 and Wayland
applications both receive the files.

It takes no pointer or keyboard grab. The button is already held in a Setdown
window, so the pointer is polled, and the drag ends when the button goes up.
Input: one JSON line {"paths": [...], "icon": {"width", "height", "bgra"}} (the
picture beside the pointer, premultiplied BGRA rows in base64); a
later "cancel" line, or end of input, abandons the drag. Output: JSON lines
{"state": "started" | "released" | "dropped" | "cancelled"}.
ABI: Xlib.h (XEvent, XSetWindowAttributes, XWindowAttributes), Xutil.h (XVisualInfo).
"""
import base64
import ctypes as C
import json
import select
import sys
import time
from urllib.parse import quote

BUTTONS = (1 << 8) | (1 << 9) | (1 << 10)
POLL_SECONDS = .008
STATUS_WAIT_SECONDS = .4
FINISH_WAIT_SECONDS = 15
PROPERTY_NOTIFY, SELECTION_CLEAR, SELECTION_REQUEST, SELECTION_NOTIFY, CLIENT_MESSAGE = 28, 29, 30, 31, 33


class ClientMessage(C.Structure):
    _fields_ = [('type', C.c_int), ('serial', C.c_ulong), ('send_event', C.c_int), ('display', C.c_void_p),
                ('window', C.c_ulong), ('message_type', C.c_ulong), ('format', C.c_int), ('l', C.c_long * 5)]


class SelectionRequest(C.Structure):
    _fields_ = [('type', C.c_int), ('serial', C.c_ulong), ('send_event', C.c_int), ('display', C.c_void_p),
                ('owner', C.c_ulong), ('requestor', C.c_ulong), ('selection', C.c_ulong), ('target', C.c_ulong),
                ('property', C.c_ulong), ('time', C.c_ulong)]


class SelectionNotify(C.Structure):
    _fields_ = [('type', C.c_int), ('serial', C.c_ulong), ('send_event', C.c_int), ('display', C.c_void_p),
                ('requestor', C.c_ulong), ('selection', C.c_ulong), ('target', C.c_ulong),
                ('property', C.c_ulong), ('time', C.c_ulong)]


class PropertyEvent(C.Structure):
    _fields_ = [('type', C.c_int), ('serial', C.c_ulong), ('send_event', C.c_int), ('display', C.c_void_p),
                ('window', C.c_ulong), ('atom', C.c_ulong), ('time', C.c_ulong), ('state', C.c_int)]


class Event(C.Union):
    _fields_ = [('type', C.c_int), ('client', ClientMessage), ('request', SelectionRequest),
                ('notify', SelectionNotify), ('property', PropertyEvent), ('pad', C.c_long * 24)]


class WindowAttributes(C.Structure):
    _fields_ = [('x', C.c_int), ('y', C.c_int), ('width', C.c_int), ('height', C.c_int), ('border_width', C.c_int),
                ('depth', C.c_int), ('visual', C.c_void_p), ('root', C.c_ulong), ('window_class', C.c_int),
                ('bit_gravity', C.c_int), ('win_gravity', C.c_int), ('backing_store', C.c_int),
                ('backing_planes', C.c_ulong), ('backing_pixel', C.c_ulong), ('save_under', C.c_int),
                ('colormap', C.c_ulong), ('map_installed', C.c_int), ('map_state', C.c_int),
                ('all_event_masks', C.c_long), ('your_event_mask', C.c_long), ('do_not_propagate_mask', C.c_long),
                ('override_redirect', C.c_int), ('screen', C.c_void_p)]


class SetWindowAttributes(C.Structure):
    _fields_ = [('background_pixmap', C.c_ulong), ('background_pixel', C.c_ulong), ('border_pixmap', C.c_ulong),
                ('border_pixel', C.c_ulong), ('bit_gravity', C.c_int), ('win_gravity', C.c_int),
                ('backing_store', C.c_int), ('backing_planes', C.c_ulong), ('backing_pixel', C.c_ulong),
                ('save_under', C.c_int), ('event_mask', C.c_long), ('do_not_propagate_mask', C.c_long),
                ('override_redirect', C.c_int), ('colormap', C.c_ulong), ('cursor', C.c_ulong)]


class VisualInfo(C.Structure):
    _fields_ = [('visual', C.c_void_p), ('visualid', C.c_ulong), ('screen', C.c_int), ('depth', C.c_int),
                ('visual_class', C.c_int), ('red_mask', C.c_ulong), ('green_mask', C.c_ulong),
                ('blue_mask', C.c_ulong), ('colormap_size', C.c_int), ('bits_per_rgb', C.c_int)]


def bind(x):
    P, W, I, U, L = C.c_void_p, C.c_ulong, C.c_int, C.c_uint, C.c_long
    signatures = {
        'XOpenDisplay': ([C.c_char_p], P), 'XCloseDisplay': ([P], I), 'XDefaultRootWindow': ([P], W),
        'XDefaultScreen': ([P], I), 'XConnectionNumber': ([P], I), 'XPending': ([P], I), 'XFlush': ([P], I),
        'XSync': ([P, I], I), 'XNextEvent': ([P, C.POINTER(Event)], I), 'XFree': ([P], I),
        'XInternAtom': ([P, C.c_char_p, I], W), 'XSetErrorHandler': ([P], P),
        'XSetSelectionOwner': ([P, W, W, W], I), 'XGetSelectionOwner': ([P, W], W),
        'XSelectInput': ([P, W, L], I),
        'XQueryPointer': ([P, W, C.POINTER(W), C.POINTER(W), C.POINTER(I), C.POINTER(I), C.POINTER(I),
                           C.POINTER(I), C.POINTER(U)], I),
        'XTranslateCoordinates': ([P, W, W, I, I, C.POINTER(I), C.POINTER(I), C.POINTER(W)], I),
        'XQueryTree': ([P, W, C.POINTER(W), C.POINTER(W), C.POINTER(C.POINTER(W)), C.POINTER(U)], I),
        'XGetWindowAttributes': ([P, W, C.POINTER(WindowAttributes)], I),
        'XGetWindowProperty': ([P, W, W, L, L, I, W, C.POINTER(W), C.POINTER(I), C.POINTER(W), C.POINTER(W),
                                C.POINTER(C.POINTER(C.c_ulong))], I),
        'XChangeProperty': ([P, W, W, W, I, I, C.c_void_p, I], I),
        'XSendEvent': ([P, W, I, L, C.POINTER(Event)], I),
        'XCreateWindow': ([P, W, I, I, U, U, U, I, U, P, W, C.POINTER(SetWindowAttributes)], W),
        'XDestroyWindow': ([P, W], I), 'XMapRaised': ([P, W], I), 'XMoveWindow': ([P, W, I, I], I),
        'XMatchVisualInfo': ([P, I, I, I, C.POINTER(VisualInfo)], I),
        'XCreateColormap': ([P, W, P, I], W), 'XCreatePixmap': ([P, W, U, U, U], W),
        'XCreateGC': ([P, W, W, P], P), 'XFreeGC': ([P, P], I),
        'XCreateImage': ([P, P, U, I, I, C.c_char_p, U, U, I, I], P),
        'XPutImage': ([P, W, P, P, I, I, I, I, U, U], I),
        'XMaxRequestSize': ([P], L), 'XExtendedMaxRequestSize': ([P], L),
        'XChangeWindowAttributes': ([P, W, W, C.POINTER(SetWindowAttributes)], I),
    }
    for name, (arguments, result) in signatures.items():
        function = getattr(x, name)
        function.argtypes, function.restype = arguments, result


class Source:
    def __init__(self, x, display, paths, icon):
        self.x, self.display = x, display
        self.root = x.XDefaultRootWindow(display)
        self.atoms = {}
        self.uris = ''.join('file://' + quote(path, safe="/") + '\r\n' for path in paths).encode()
        attributes = SetWindowAttributes(event_mask=1 << 22)  # PropertyChangeMask
        # The selection owner and the XDND source must be one window (Mutter checks it).
        self.window = x.XCreateWindow(display, self.root, -10, -10, 1, 1, 0, 0, 2, None, 1 << 11, C.byref(attributes))
        actions = (C.c_ulong * 2)(self.atom('XdndActionCopy'), self.atom('XdndActionLink'))
        x.XChangeProperty(display, self.window, self.atom('XdndActionList'), 4, 32, 0, actions, 2)
        types = (C.c_ulong * 1)(self.atom('text/uri-list'))
        x.XChangeProperty(display, self.window, self.atom('XdndTypeList'), 4, 32, 0, types, 1)
        self.server_time, self.clock = self.timestamp(), time.monotonic()
        self.properties = {}
        self.proxies = self.compositor_proxies()
        self.icon = self.icon_window(icon) if icon else 0
        self.target = None  # (window that receives messages, window named in them, XDND version)
        self.accepted = self.waiting = self.pending = False
        self.finished = False
        self.position = None

    def atom(self, name):
        if name not in self.atoms:
            self.atoms[name] = self.x.XInternAtom(self.display, name.encode(), 0)
        return self.atoms[name]

    def now(self):
        return (self.server_time + int((time.monotonic() - self.clock) * 1000)) & 0xffffffff

    def timestamp(self):
        """A server time for ownership and messages; CurrentTime would lose to any later owner."""
        x, event = self.x, Event()
        x.XChangeProperty(self.display, self.window, self.atom('_SETDOWN_TIME'), 4, 32, 2, None, 0)
        deadline = time.monotonic() + 1
        while time.monotonic() < deadline:
            x.XNextEvent(self.display, C.byref(event))
            if event.type == PROPERTY_NOTIFY and event.property.window == self.window:
                return event.property.time
        return 0

    def property(self, window, name, cache=True):
        """A 32-bit property's values, or None. Cached: a target's XDND properties do not change mid-drag."""
        key = (window, name)
        if cache and key in self.properties:
            return self.properties[key]
        kind, size, count, rest, data = C.c_ulong(), C.c_int(), C.c_ulong(), C.c_ulong(), C.POINTER(C.c_ulong)()
        values = None
        if (self.x.XGetWindowProperty(self.display, window, self.atom(name), 0, 16, 0, 0, C.byref(kind),
                                      C.byref(size), C.byref(count), C.byref(rest), C.byref(data)) == 0 and kind.value):
            values = [data[index] for index in range(count.value)] if size.value == 32 else []
        if data:
            self.x.XFree(data)
        if cache:
            self.properties[key] = values
        return values

    def attributes(self, window):
        attributes = WindowAttributes()
        return attributes if self.x.XGetWindowAttributes(self.display, window, C.byref(attributes)) else None

    def compositor_proxies(self):
        """Mutter (and KWin) receive XDND for Wayland windows on unlisted input-only root windows."""
        root, parent, children, count = C.c_ulong(), C.c_ulong(), C.POINTER(C.c_ulong)(), C.c_uint()
        if not self.x.XQueryTree(self.display, self.root, C.byref(root), C.byref(parent), C.byref(children), C.byref(count)):
            return []
        proxies = []
        for index in range(count.value):
            window = children[index]
            attributes = self.attributes(window)
            if (attributes and window != self.window and attributes.window_class == 2 and attributes.override_redirect
                    and self.property(window, 'XdndAware')):
                proxies.append(window)
        if children:
            self.x.XFree(children)
        return proxies

    def icon_window(self, icon):
        """The dragged file's name tag beside the pointer. It takes no input, so it is never a drop target."""
        x, display = self.x, self.display
        width, height, pixels = int(icon['width']), int(icon['height']), base64.b64decode(icon['bgra'])
        visual = VisualInfo()
        if not (0 < width <= 1024 and 0 < height <= 256 and len(pixels) == width * height * 4
                and x.XMatchVisualInfo(display, x.XDefaultScreen(display), 32, 4, C.byref(visual))):
            return 0
        attributes = SetWindowAttributes(border_pixel=0, override_redirect=1,
                                         colormap=x.XCreateColormap(display, self.root, visual.visual, 0))
        window = x.XCreateWindow(display, self.root, -1000, -1000, width, height, 0, 32, 1, visual.visual,
                                 (1 << 3) | (1 << 9) | (1 << 13), C.byref(attributes))
        pixmap = x.XCreatePixmap(display, window, width, height, 32)
        context = x.XCreateGC(display, pixmap, 0, None)
        self.pixels = C.create_string_buffer(pixels, len(pixels))  # XCreateImage keeps the pointer.
        image = x.XCreateImage(display, visual.visual, 32, 2, 0, self.pixels, width, height, 32, 0)
        if image:
            x.XPutImage(display, pixmap, context, image, 0, 0, 0, 0, width, height)
        x.XFreeGC(display, context)
        background = SetWindowAttributes(background_pixmap=pixmap)
        x.XChangeProperty(display, window, self.atom('_NET_WM_WINDOW_TYPE'), 4, 32, 0,
                          (C.c_ulong * 1)(self.atom('_NET_WM_WINDOW_TYPE_DND')), 1)
        x.XChangeWindowAttributes(display, window, 1, C.byref(background))
        try:
            shape = C.CDLL('libXext.so.6')
            shape.XShapeCombineRectangles.argtypes = [C.c_void_p, C.c_ulong, C.c_int, C.c_int, C.c_int, C.c_void_p,
                                                      C.c_int, C.c_int, C.c_int]
            shape.XShapeCombineRectangles(display, window, 2, 0, 0, None, 0, 0, 0)  # ShapeInput: empty
        except OSError:
            pass
        x.XMapRaised(display, window)
        return window

    def pointer(self):
        root, child = C.c_ulong(), C.c_ulong()
        root_x, root_y, x, y, mask = C.c_int(), C.c_int(), C.c_int(), C.c_int(), C.c_uint()
        if not self.x.XQueryPointer(self.display, self.root, C.byref(root), C.byref(child), C.byref(root_x),
                                    C.byref(root_y), C.byref(x), C.byref(y), C.byref(mask)):
            return None
        return root_x.value, root_y.value, mask.value, child.value

    def aware(self, window):
        """(destination, named window, version) when the window, or its XdndProxy, takes XDND 3+."""
        proxy = self.property(window, 'XdndProxy')
        destination = proxy[0] if proxy and self.property(proxy[0], 'XdndProxy') == proxy else window
        version = self.property(destination, 'XdndAware')
        return (destination, window, min(5, version[0])) if version and version[0] >= 3 else None

    def find_target(self, x, y, child):
        # The compositor shows its proxy exactly while the pointer is over a Wayland window.
        # Where it shows it says nothing: on a scaled monitor Mutter places it in its own
        # coordinates, which are smaller than X11's, so the pointer is rarely inside it.
        for proxy in self.proxies:
            attributes = self.attributes(proxy)
            if attributes and attributes.map_state == 2:
                return self.aware(proxy)
        # An X11 application: its client window (WM_STATE) may sit inside a decoration frame.
        candidates, window = [], child
        for _ in range(8):
            if not window or window in (self.window, self.icon):
                break
            target = self.aware(window)
            if target:
                if self.property(window, 'WM_STATE') is not None:
                    return target
                candidates.append(target)
            inner_x, inner_y, inner = C.c_int(), C.c_int(), C.c_ulong()
            if not self.x.XTranslateCoordinates(self.display, self.root, window, x, y, C.byref(inner_x),
                                                C.byref(inner_y), C.byref(inner)):
                break
            window = inner.value
        return candidates[0] if candidates else None

    def send(self, message, first=0, second=0, third=0, fourth=0):
        destination, named, _ = self.target
        event = Event()
        event.client.type, event.client.window, event.client.format = CLIENT_MESSAGE, named, 32
        event.client.message_type = self.atom(message)
        event.client.l[0], event.client.l[1], event.client.l[2] = self.window, first, second
        event.client.l[3], event.client.l[4] = third, fourth
        self.x.XSendEvent(self.display, destination, 0, 0, C.byref(event))

    def send_position(self):
        x, y = self.position
        self.send('XdndPosition', 0, (x << 16) | (y & 0xffff), self.now(), self.atom('XdndActionCopy'))
        self.waiting, self.waiting_since, self.pending = True, time.monotonic(), False

    def retarget(self, target):
        if target == self.target:
            return
        if self.target:
            self.send('XdndLeave')
        self.target, self.accepted, self.waiting, self.pending = target, False, False, False
        if target:
            self.send('XdndEnter', target[2] << 24, self.atom('text/uri-list'))

    def move(self, x, y, child):
        if self.icon:
            self.x.XMoveWindow(self.display, self.icon, x + 14, y + 14)
        moved = self.position != (x, y)
        self.position = (x, y)
        previous = self.target
        self.retarget(self.find_target(x, y, child))
        if not self.target:
            return
        # One position at a time: a target answers each with XdndStatus (XDND flow control).
        if self.waiting and time.monotonic() - self.waiting_since > 1:
            self.waiting = False
        if moved or self.target != previous:
            if self.waiting:
                self.pending = True
            else:
                self.send_position()

    def answer(self, request):
        """Serve the dragged files. Nothing else is offered; DELETE (a "move") is refused."""
        x, display = self.x, self.display
        target, where = request.target, request.property or request.target
        limit = (x.XExtendedMaxRequestSize(display) or x.XMaxRequestSize(display)) * 4 - 1024
        done = 0
        if request.selection == self.atom('XdndSelection') and request.owner == self.window:
            if target == self.atom('text/uri-list') and len(self.uris) <= limit:
                x.XChangeProperty(display, request.requestor, where, target, 8, 0, self.uris, len(self.uris))
                done = where
            elif target == self.atom('TARGETS'):
                targets = (C.c_ulong * 2)(self.atom('TARGETS'), self.atom('text/uri-list'))
                x.XChangeProperty(display, request.requestor, where, 4, 32, 0, targets, 2)
                done = where
        event = Event()
        event.notify.type, event.notify.requestor = SELECTION_NOTIFY, request.requestor
        event.notify.selection, event.notify.target = request.selection, request.target
        event.notify.property, event.notify.time = done, request.time
        x.XSendEvent(display, request.requestor, 0, 0, C.byref(event))

    def handle_events(self):
        """False when another source took the selection: this drag is over."""
        x, event = self.x, Event()
        while x.XPending(self.display):
            x.XNextEvent(self.display, C.byref(event))
            if event.type == SELECTION_REQUEST:
                self.answer(event.request)
                self.served = time.monotonic()
            elif event.type == SELECTION_CLEAR:
                return False
            elif event.type == CLIENT_MESSAGE and event.client.format == 32:
                kind, sender = event.client.message_type, event.client.l[0] & 0xffffffff
                if kind == self.atom('XdndStatus') and self.target and sender in self.target[:2]:
                    self.accepted, self.waiting = bool(event.client.l[1] & 1), False
                    if self.pending:
                        self.send_position()
                elif kind == self.atom('XdndFinished'):
                    self.finished = True
        return True

    def wait(self, seconds, done):
        deadline = time.monotonic() + seconds
        descriptor = self.x.XConnectionNumber(self.display)
        while time.monotonic() < deadline:
            self.x.XFlush(self.display)
            if not self.handle_events() or done():
                return
            select.select([descriptor], [], [], .01)

    def drop(self):
        """True when a target took the files."""
        x = self.x
        if self.icon:
            x.XDestroyWindow(self.display, self.icon)
            self.icon = 0
        if self.target and (self.waiting or self.pending):
            self.wait(STATUS_WAIT_SECONDS, lambda: not self.waiting and not self.pending)
        if not self.target or not self.accepted:
            self.cancel()
            return False
        self.send('XdndDrop', 0, self.now())
        # The target reads the selection after the drop; owning it until XdndFinished keeps the files readable.
        self.served = time.monotonic()
        self.wait(FINISH_WAIT_SECONDS, lambda: self.finished or time.monotonic() - self.served > FINISH_WAIT_SECONDS / 3)
        return True

    def cancel(self):
        if self.target:
            self.send('XdndLeave')
            self.target = None
            # The target may still answer the leave; stay for it instead of vanishing under its reply.
            self.wait(.08, lambda: False)


def main():
    request = json.loads(sys.stdin.readline())
    paths = [path for path in request.get('paths', []) if isinstance(path, str) and path.startswith('/')]
    if not paths:
        raise ValueError('No files to drag')
    x = C.CDLL('libX11.so.6')
    bind(x)
    display = x.XOpenDisplay(None)
    if not display:
        raise RuntimeError('X11 display unavailable')
    # A target window can disappear at any moment; its errors are not ours to die from.
    handler = C.CFUNCTYPE(C.c_int, C.c_void_p, C.c_void_p)(lambda _display, _error: 0)
    x.XSetErrorHandler(handler)
    state = 'cancelled'
    try:
        source = Source(x, display, paths, request.get('icon'))
        pointer = source.pointer()
        if not pointer or not pointer[2] & BUTTONS:
            state = 'released'  # The button went up before the drag could begin.
            return
        held = pointer[2] & BUTTONS
        x.XSetSelectionOwner(display, source.atom('XdndSelection'), source.window, source.server_time)
        x.XSync(display, 0)
        if x.XGetSelectionOwner(display, source.atom('XdndSelection')) != source.window:
            raise RuntimeError('Could not own the drag selection')
        print(json.dumps({'state': 'started'}), flush=True)
        descriptor = x.XConnectionNumber(display)
        while True:
            x.XFlush(display)
            ready, _, _ = select.select([descriptor, sys.stdin], [], [], POLL_SECONDS)
            if sys.stdin in ready:
                # Either "cancel" or the end of input: Setdown gave the drag up, or exited.
                sys.stdin.readline()
                source.cancel()
                return
            if not source.handle_events():
                return
            pointer = source.pointer()
            if not pointer:
                source.cancel()
                return
            source.move(pointer[0], pointer[1], pointer[3])
            if not pointer[2] & held:
                state = 'dropped' if source.drop() else 'cancelled'
                return
    finally:
        # Closing the connection destroys the windows and gives the selection up.
        x.XCloseDisplay(display)
        print(json.dumps({'state': state}), flush=True)


if __name__ == '__main__':
    main()
