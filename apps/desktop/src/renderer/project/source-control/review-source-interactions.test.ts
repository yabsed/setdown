import assert from 'node:assert/strict';
import { test } from 'vitest';
import { observeReviewSourceInput } from './review-source-interactions';

function fixture() {
  const handlers = new Map<string, EventListener>();
  let active: string | null = 'review'; const interrupted: string[] = [];
  const source = {
    addEventListener(name: string, fn: EventListener, options: AddEventListenerOptions) {
      assert.equal(options.capture, true); assert.equal(options.passive, true); handlers.set(name, fn);
    },
    removeEventListener(name: string, fn: EventListener, capture: boolean) {
      assert.equal(capture, true); if (handlers.get(name) === fn) handlers.delete(name);
    },
  } as unknown as EventTarget;
  const stop = observeReviewSourceInput(source, () => active, (id) => interrupted.push(id));
  return { interrupted, handlers, stop,
    inactive() { active = null; },
    send(type: string, key = '', isComposing = false) {
      const event = new Event(type, { cancelable: true }); Object.assign(event, { key, isComposing });
      handlers.get(type)?.(event); assert.equal(event.defaultPrevented, false, 'input must reach Monaco/IME');
    },
  };
}
test('typing, composition, mouse, touch, wheel and clipboard operations cancel without consuming input', () => {
  const f = fixture();
  for (const event of ['beforeinput', 'input', 'compositionstart', 'pointerdown', 'wheel', 'touchstart', 'paste', 'cut', 'drop']) f.send(event);
  f.send('keydown', 'ArrowLeft'); f.send('keydown', 'a');
  assert.equal(f.interrupted.length, 11); assert.ok(f.interrupted.every((id) => id === 'review'));
  f.stop();
});
test('Escape, its delayed keyup and layout/scroll notifications are not fresh editing', () => {
  const f = fixture();
  for (const key of ['Escape', 'Shift', 'Control', 'Alt', 'Meta']) f.send('keydown', key);
  for (const event of ['keyup', 'scroll', 'resize', 'pointerup']) f.send(event, 'Escape');
  assert.equal(f.interrupted.length, 0); f.stop();
});
test('an Escape owned by composition cancels pending handoff without swallowing the IME key', () => {
  const f = fixture(); f.send('keydown', 'Escape', true); assert.equal(f.interrupted.length, 1); f.stop();
});
test('events from inactive source surfaces cannot cancel another tab', () => {
  const f = fixture(); f.inactive(); f.send('beforeinput'); f.send('keydown', 'a');
  assert.equal(f.interrupted.length, 0); f.stop();
});
test('disposing the surface removes all listeners', () => {
  const f = fixture(); f.stop(); assert.equal(f.handlers.size, 0); f.send('input'); assert.equal(f.interrupted.length, 0);
});
