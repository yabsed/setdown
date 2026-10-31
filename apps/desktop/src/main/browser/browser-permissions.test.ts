import { afterEach, expect, test, vi } from 'vitest';
import type { Session, WebContents } from 'electron';
import { BrowserPermissions } from './browser-permissions';

function fixture() {
  vi.useFakeTimers();
  const contents = { getURL: () => 'https://example.com/page', isDestroyed: () => false } as WebContents;
  const page = { id: 'tab', owner: 1, contents, visible: true };
  let request: Parameters<Session['setPermissionRequestHandler']>[0];
  let check: Parameters<Session['setPermissionCheckHandler']>[0];
  const changed = vi.fn();
  const permissions = new BrowserPermissions(wc => wc === contents ? page : undefined, changed);
  permissions.install({ setPermissionRequestHandler: fn => { request = fn; }, setPermissionCheckHandler: fn => { check = fn; } } as Session);
  const ask = (permission = 'notifications', details = {}) => {
    const callback = vi.fn();
    request!(contents, permission as 'notifications', callback, { requestingUrl: contents.getURL(), isMainFrame: true, ...details });
    return callback;
  };
  return { permissions, changed, page, contents, ask,
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
test('rejects unsupported, opaque, cross-origin, subframe and null-worker requests', () => {
  const f = fixture();
  for (const permission of ['clipboard-read', 'display-capture', 'serial', 'usb', 'unknown']) expect(f.ask(permission)).toHaveBeenCalledWith(false);
  for (const requestingUrl of ['https://other.example.com/', 'http://example.com/', 'https://example.com:8443/', 'data:text/html,hello']) {
    expect(f.ask('notifications', { requestingUrl })).toHaveBeenCalledWith(false);
  }
  expect(f.ask('notifications', { isMainFrame: false })).toHaveBeenCalledWith(false);
  expect(f.check('notifications', undefined, {}, null)).toBe(false);
  expect(f.permissions.requests('tab')).toHaveLength(0);
});
test('automatic fullscreen, pointer lock and sanitized write remain limited to visible owned pages', () => {
  const f = fixture();
  for (const permission of ['fullscreen', 'pointerLock', 'clipboard-sanitized-write']) {
    expect(f.ask(permission)).toHaveBeenCalledWith(true); expect(f.check(permission)).toBe(true);
  }
  f.page.visible = false;
  expect(f.ask('fullscreen')).toHaveBeenCalledWith(false); expect(f.check('clipboard-sanitized-write')).toBe(false);
});
test('fullscreen permits embedded web players without granting other cross-origin permissions', () => {
  const f = fixture(), origin = 'https://player.example.net';
  expect(f.ask('fullscreen', { requestingUrl: origin, isMainFrame: false })).toHaveBeenCalledExactlyOnceWith(true);
  expect(f.check('fullscreen', origin, { isMainFrame: false })).toBe(true);
  for (const permission of ['notifications', 'media', 'pointerLock', 'clipboard-sanitized-write']) {
    expect(f.ask(permission, { requestingUrl: origin, isMainFrame: false })).toHaveBeenCalledExactlyOnceWith(false);
    expect(f.check(permission, origin, { isMainFrame: false })).toBe(false);
  }
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
