import { afterEach, expect, test, vi } from 'vitest';
import type { Session, WebContents } from 'electron';
import { asksEachTime, BrowserPermissions, type PermissionMemory } from './browser-permissions';
import type { PermissionChoice } from './site-permissions';

function fixture(remembered = new Map<string, PermissionChoice>()) {
  vi.useFakeTimers();
  const contents = { getURL: () => 'https://example.com/page', isDestroyed: () => false } as WebContents;
  const page = { id: 'tab', owner: 1, contents, visible: true };
  let request: Parameters<Session['setPermissionRequestHandler']>[0];
  let check: Parameters<Session['setPermissionCheckHandler']>[0];
  const changed = vi.fn();
  const memory: PermissionMemory = { get: (scope, permission) => remembered.get(`${scope}|${permission}`),
    set: (scope, names, choice) => { for (const name of names) remembered.set(`${scope}|${name}`, choice); } };
  const permissions = new BrowserPermissions(wc => wc === contents ? page : undefined, changed, memory);
  permissions.install({ setPermissionRequestHandler: fn => { request = fn; }, setPermissionCheckHandler: fn => { check = fn; } } as Session);
  const ask = (permission = 'notifications', details = {}) => {
    const callback = vi.fn();
    request!(contents, permission as 'notifications', callback, { requestingUrl: contents.getURL(), isMainFrame: true, ...details });
    return callback;
  };
  return { permissions, changed, page, contents, ask, remembered,
    check: (permission: string, origin = 'https://example.com', details = {}, wc: WebContents | null = contents) => check!(wc, permission as 'notifications', origin, { isMainFrame: true, ...details }) };
}
afterEach(() => { vi.useRealTimers(); });

test('coalesces notifications, scopes answers to the owner, settles once, and remembers denial for the document', () => {
  const f = fixture(), first = f.ask(), second = f.ask();
  expect(first).not.toHaveBeenCalled(); expect(f.permissions.requests('tab')).toHaveLength(1);
  const { token } = f.permissions.requests('tab')[0];
  f.permissions.respond(2, 'tab', token, true); expect(first).not.toHaveBeenCalled();
  f.permissions.respond(1, 'tab', token, false); f.permissions.respond(1, 'tab', token, true);
  expect(first).toHaveBeenCalledExactlyOnceWith(false); expect(second).toHaveBeenCalledExactlyOnceWith(false);
  expect(f.ask()).toHaveBeenCalledExactlyOnceWith(false); expect(f.permissions.requests('tab')).toHaveLength(0);
});
test('separates microphone and camera grants in both request and check handlers', () => {
  const f = fixture(), audio = f.ask('media', { mediaTypes: ['audio'] });
  f.permissions.respond(1, 'tab', f.permissions.requests('tab')[0].token, true);
  expect(audio).toHaveBeenCalledExactlyOnceWith(true);
  expect(f.check('media', undefined, { mediaType: 'audio' })).toBe(true);
  expect(f.check('media', undefined, { mediaType: 'video' })).toBe(false);
  expect(f.check('media', undefined, { mediaType: 'unknown' })).toBe(false);
  const camera = f.ask('media', { mediaTypes: ['audio', 'video'] }); expect(camera).not.toHaveBeenCalled();
  f.permissions.clear(1, 'tab'); expect(camera).toHaveBeenCalledExactlyOnceWith(false);
  expect(f.check('media', undefined, { mediaType: 'audio' })).toBe(false);
});
test('rejects unsupported, opaque, mismatched main-frame and null-worker requests', () => {
  const f = fixture();
  for (const permission of ['serial', 'usb', 'hid', 'midi', 'idle-detection', 'unknown']) expect(f.ask(permission)).toHaveBeenCalledWith(false);
  for (const requestingUrl of ['https://other.example.com/', 'http://example.com/', 'https://example.com:8443/', 'data:text/html,hello']) {
    expect(f.ask('notifications', { requestingUrl })).toHaveBeenCalledWith(false);
    expect(f.ask('media', { requestingUrl, mediaTypes: ['audio'] })).toHaveBeenCalledWith(false);
  }
  for (const requestingUrl of ['data:text/html,frame', 'file:///frame.html', 'about:blank']) {
    expect(f.ask('media', { requestingUrl, isMainFrame: false, mediaTypes: ['audio'] })).toHaveBeenCalledWith(false);
  }
  expect(f.check('notifications', undefined, {}, null)).toBe(false);
  expect(f.check('media', 'https://other.example.com', { mediaType: 'audio' })).toBe(false);
  expect(f.permissions.requests('tab')).toHaveLength(0);
});
test('clipboard reading is asked like any other capability', () => {
  const f = fixture(), read = f.ask('clipboard-read');
  expect(read).not.toHaveBeenCalled(); expect(f.check('clipboard-read')).toBe(false);
  expect(f.permissions.requests('tab')).toMatchObject([{ origin: 'https://example.com', permissions: ['clipboard-read'], label: 'Clipboard' }]);
  f.permissions.respond(1, 'tab', f.permissions.requests('tab')[0].token, true);
  expect(read).toHaveBeenCalledExactlyOnceWith(true); expect(f.check('clipboard-read')).toBe(true);
  expect(f.remembered.size).toBe(0);
});
test('a same-origin frame asks as its page; an embedded site asks under both names and never for notifications', () => {
  const f = fixture(), embedded = 'https://meet.example.net';
  const own = f.ask('geolocation', { isMainFrame: false });
  expect(f.permissions.requests('tab')).toEqual([expect.objectContaining({ origin: 'https://example.com', permissions: ['geolocation'], label: 'Location' })]);
  expect(f.permissions.requests('tab')[0]).not.toHaveProperty('embedder');
  f.permissions.respond(1, 'tab', f.permissions.requests('tab')[0].token, true);
  expect(own).toHaveBeenCalledExactlyOnceWith(true);
  expect(f.ask('geolocation-approximate')).toHaveBeenCalledExactlyOnceWith(true);
  expect(f.check('geolocation', undefined, { isMainFrame: false })).toBe(true);
  // The page's grant is not the embedded site's.
  expect(f.check('geolocation', embedded, { isMainFrame: false })).toBe(false);
  const camera = f.ask('media', { requestingUrl: `${embedded}/room`, isMainFrame: false, mediaTypes: ['video'] });
  expect(camera).not.toHaveBeenCalled();
  expect(f.permissions.requests('tab')).toEqual([expect.objectContaining({ origin: embedded, embedder: 'https://example.com', permissions: ['video'], label: 'Camera' })]);
  f.permissions.respond(1, 'tab', f.permissions.requests('tab')[0].token, true);
  expect(camera).toHaveBeenCalledExactlyOnceWith(true);
  expect(f.check('media', embedded, { isMainFrame: false, mediaType: 'video' })).toBe(true);
  expect(f.check('media', undefined, { mediaType: 'video' })).toBe(false);
  expect(f.check('media', 'https://another.example.net', { isMainFrame: false, mediaType: 'video' })).toBe(false);
  expect(f.ask('notifications', { requestingUrl: embedded, isMainFrame: false })).toHaveBeenCalledExactlyOnceWith(false);
  expect(f.check('notifications', embedded, { isMainFrame: false })).toBe(false);
});
test('pointer lock and sanitized clipboard writes need no stored answer in visible pages and their frames', () => {
  const f = fixture(), embedded = 'https://meet.example.net';
  for (const permission of ['pointerLock', 'clipboard-sanitized-write']) {
    expect(f.ask(permission)).toHaveBeenCalledExactlyOnceWith(true);
    expect(f.ask(permission, { requestingUrl: embedded, isMainFrame: false })).toHaveBeenCalledExactlyOnceWith(true);
    expect(f.check(permission, embedded, { isMainFrame: false })).toBe(true);
  }
  expect(f.permissions.requests('tab')).toHaveLength(0); expect(f.remembered.size).toBe(0);
  f.page.visible = false;
  for (const permission of ['pointerLock', 'clipboard-sanitized-write']) {
    expect(f.ask(permission)).toHaveBeenCalledExactlyOnceWith(false);
    expect(f.ask(permission, { requestingUrl: embedded, isMainFrame: false })).toHaveBeenCalledExactlyOnceWith(false);
  }
});
test('screen sharing is asked every time: an allowance answers one request and is never kept', () => {
  // Electron reports getDisplayMedia and the old whole-screen getUserMedia constraint under one name,
  // so an earlier answer must not let the second kind through.
  const f = fixture(), first = f.ask('display-capture', { mediaTypes: ['video'] });
  expect(first).not.toHaveBeenCalled(); expect(f.check('display-capture')).toBe(false);
  expect(f.permissions.requests('tab')).toMatchObject([{ origin: 'https://example.com', permissions: ['display-capture'], label: 'Screen Sharing' }]);
  expect(asksEachTime(f.permissions.requests('tab')[0].permissions)).toBe(true); expect(asksEachTime(['audio', 'video'])).toBe(false);
  // Even "remember" keeps no allowance.
  f.permissions.respond(1, 'tab', f.permissions.requests('tab')[0].token, true, true);
  expect(first).toHaveBeenCalledExactlyOnceWith(true); expect(f.remembered.size).toBe(0);
  expect(f.check('display-capture')).toBe(false);
  // Sharing in progress keeps its tab awake.
  expect(f.permissions.protects('tab')).toBe(true);
  const second = f.ask('display-capture', { mediaTypes: ['video'] });
  expect(second).not.toHaveBeenCalled(); expect(f.permissions.requests('tab')).toHaveLength(1);
  // A refusal ends that request only.
  f.permissions.respond(1, 'tab', f.permissions.requests('tab')[0].token, false);
  expect(second).toHaveBeenCalledExactlyOnceWith(false);
  const third = f.ask('display-capture'); expect(third).not.toHaveBeenCalled();
  // A standing block is kept, and a planted allowance is not believed.
  f.permissions.respond(1, 'tab', f.permissions.requests('tab')[0].token, false, true);
  expect(third).toHaveBeenCalledExactlyOnceWith(false);
  expect([...f.remembered]).toEqual([['https://example.com|display-capture', 'deny']]);
  expect(f.ask('display-capture')).toHaveBeenCalledExactlyOnceWith(false); expect(f.permissions.requests('tab')).toHaveLength(0);
  const planted = fixture(new Map([['https://example.com|display-capture', 'allow' as const]]));
  expect(planted.ask('display-capture')).not.toHaveBeenCalled(); expect(planted.check('display-capture')).toBe(false);
  // An embedded site asks under both names; a hidden page is asked about nothing it cannot show.
  const embedded = planted.ask('display-capture', { requestingUrl: 'https://meet.example.net/room', isMainFrame: false });
  expect(embedded).not.toHaveBeenCalled();
  expect(planted.permissions.requests('tab')[1]).toMatchObject({ origin: 'https://meet.example.net', embedder: 'https://example.com', label: 'Screen Sharing' });
});
test('a remembered choice answers later documents, other tabs of the site and restarts without asking', () => {
  const f = fixture(), first = f.ask('media', { mediaTypes: ['audio', 'video'] });
  f.permissions.respond(1, 'tab', f.permissions.requests('tab')[0].token, true, true);
  expect(first).toHaveBeenCalledExactlyOnceWith(true);
  expect([...f.remembered]).toEqual([['https://example.com|audio', 'allow'], ['https://example.com|video', 'allow']]);
  f.permissions.clear(1, 'tab');
  expect(f.permissions.protects('tab')).toBe(false);
  expect(f.check('media', undefined, { mediaType: 'audio' })).toBe(true);
  expect(f.ask('media', { mediaTypes: ['video'] })).toHaveBeenCalledExactlyOnceWith(true);
  // A capability in use keeps the tab awake even though nobody was asked.
  expect(f.permissions.protects('tab')).toBe(true); expect(f.permissions.requests('tab')).toHaveLength(0);
  const restarted = fixture(f.remembered);
  expect(restarted.ask('media', { mediaTypes: ['audio'] })).toHaveBeenCalledExactlyOnceWith(true);
  const notify = restarted.ask();
  restarted.permissions.respond(1, 'tab', restarted.permissions.requests('tab')[0].token, false, true);
  expect(notify).toHaveBeenCalledExactlyOnceWith(false);
  restarted.permissions.clear(1, 'tab');
  expect(restarted.ask()).toHaveBeenCalledExactlyOnceWith(false); expect(restarted.check('notifications')).toBe(false);
  expect(restarted.permissions.requests('tab')).toHaveLength(0);
});
test('remembering an embedded site binds the choice to the embedding page, and a standing block outranks a page grant', () => {
  const f = fixture(), embedded = 'https://meet.example.net';
  const microphone = f.ask('media', { requestingUrl: embedded, isMainFrame: false, mediaTypes: ['audio'] });
  f.permissions.respond(1, 'tab', f.permissions.requests('tab')[0].token, true, true);
  expect(microphone).toHaveBeenCalledExactlyOnceWith(true);
  expect([...f.remembered.keys()]).toEqual([`${embedded} https://example.com|audio`]);
  expect(f.ask('media', { mediaTypes: ['audio'] })).not.toHaveBeenCalled();
  f.permissions.respond(1, 'tab', f.permissions.requests('tab')[0].token, true);
  expect(f.check('media', undefined, { mediaType: 'audio' })).toBe(true);
  // Another tab of the site blocks it for good: this document's grant no longer answers.
  f.remembered.set('https://example.com|audio', 'deny');
  expect(f.check('media', undefined, { mediaType: 'audio' })).toBe(false);
  expect(f.ask('media', { mediaTypes: ['audio'] })).toHaveBeenCalledExactlyOnceWith(false);
  expect(f.check('media', embedded, { isMainFrame: false, mediaType: 'audio' })).toBe(true);
});
test('automatic fullscreen, pointer lock and sanitized write remain limited to visible owned pages', () => {
  const f = fixture();
  for (const permission of ['fullscreen', 'pointerLock', 'clipboard-sanitized-write']) {
    expect(f.ask(permission)).toHaveBeenCalledWith(true); expect(f.check(permission)).toBe(true);
  }
  f.page.visible = false;
  expect(f.ask('fullscreen')).toHaveBeenCalledWith(false); expect(f.check('clipboard-sanitized-write')).toBe(false);
});
test('fullscreen permits embedded web players without granting them what must be asked', () => {
  const f = fixture(), origin = 'https://player.example.net';
  expect(f.ask('fullscreen', { requestingUrl: origin, isMainFrame: false })).toHaveBeenCalledExactlyOnceWith(true);
  expect(f.check('fullscreen', origin, { isMainFrame: false })).toBe(true);
  for (const permission of ['notifications', 'media', 'usb']) {
    expect(f.ask(permission, { requestingUrl: origin, isMainFrame: false })).toHaveBeenCalledExactlyOnceWith(false);
    expect(f.check(permission, origin, { isMainFrame: false })).toBe(false);
  }
  for (const permission of ['geolocation', 'clipboard-read']) expect(f.check(permission, origin, { isMainFrame: false })).toBe(false);
  for (const requestingUrl of ['data:text/html,player', 'file:///player.html', 'null']) {
    expect(f.ask('fullscreen', { requestingUrl })).toHaveBeenCalledExactlyOnceWith(false);
    expect(f.check('fullscreen', requestingUrl)).toBe(false);
  }
  expect(f.check('fullscreen', origin, {}, null)).toBe(false);
  f.page.visible = false;
  expect(f.ask('fullscreen', { requestingUrl: origin })).toHaveBeenCalledExactlyOnceWith(false);
  expect(f.check('fullscreen', origin)).toBe(false);
  f.page.visible = true; f.contents.isDestroyed = () => true;
  expect(f.ask('fullscreen')).toHaveBeenCalledExactlyOnceWith(false);
  expect(f.check('fullscreen')).toBe(false);
});
test('overlapping media answers keep request and check decisions consistent', () => {
  const f = fixture(), audio = f.ask('media', { mediaTypes: ['audio'] });
  const combined = f.ask('media', { mediaTypes: ['audio', 'video'] });
  const [microphone, cameraAndMicrophone] = f.permissions.requests('tab');
  f.permissions.respond(1, 'tab', microphone.token, true);
  expect(audio).toHaveBeenCalledExactlyOnceWith(true);
  f.permissions.respond(1, 'tab', cameraAndMicrophone.token, false);
  expect(combined).toHaveBeenCalledExactlyOnceWith(false);
  expect(f.check('media', undefined, { mediaType: 'audio' })).toBe(false);
  expect(f.ask('media', { mediaTypes: ['audio'] })).toHaveBeenCalledExactlyOnceWith(false);
});
test('bounds callbacks and expires quiet requests; navigation invalidates old tokens and decisions', () => {
  const f = fixture(), callbacks = Array.from({ length: 12 }, () => f.ask());
  expect(callbacks.filter(cb => cb.mock.calls.length)).toHaveLength(4);
  const token = f.permissions.requests('tab')[0].token;
  vi.advanceTimersByTime(90_000);
  for (const callback of callbacks) expect(callback).toHaveBeenCalledExactlyOnceWith(false);
  f.permissions.clear(1, 'tab');
  const next = f.ask();
  f.permissions.respond(1, 'tab', token, true); expect(next).not.toHaveBeenCalled();
  f.permissions.clear(1, 'tab'); expect(next).toHaveBeenCalledExactlyOnceWith(false);
  expect(vi.getTimerCount()).toBe(0);
});
