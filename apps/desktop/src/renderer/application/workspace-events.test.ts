import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import type { AppCommand } from '../../protocol/desktop-api';
import type { DesktopPort } from '../ports/desktop-port';
import { CompositionGuard } from '../editor/composition-guard';
import { installWorkspaceEvents } from './workspace-events';

let cleanup = () => {};
let input: CompositionGuard | undefined;
afterEach(() => { cleanup(); input?.dispose(); vi.unstubAllGlobals(); });

function fixture() {
  const target = new EventTarget();
  vi.stubGlobal('window', target);
  let command!: (value: AppCommand) => void;
  const desktop = new Proxy({}, {
    get: (_, name) => (callback: (value: AppCommand) => void) => {
      if (name === 'onCommand') command = callback;
      return () => {};
    },
  }) as DesktopPort;
  const keys: string[] = [];
  const commands: AppCommand[] = [];
  const handlers = new Proxy({}, { get: (_, name) => name === 'keydown'
    ? (event: KeyboardEvent) => { keys.push(event.key); event.preventDefault(); }
    : name === 'command' ? (value: AppCommand) => commands.push(value) : () => {},
  }) as Parameters<typeof installWorkspaceEvents>[1];
  cleanup = installWorkspaceEvents(desktop, handlers);
  return { target, keys, commands, command };
}

test('IME Escape is not consumed or converted into a workspace command', () => {
  const f = fixture();
  const event = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape', isComposing: true });
  f.target.dispatchEvent(event);
  assert.deepEqual(f.keys, []);
  assert.equal(event.defaultPrevented, false);
});

test('native EditContext guard also blocks unflagged DOM and IPC Escape', async () => {
  const f = fixture();
  input = new CompositionGuard(() => {});
  input.start();
  f.target.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape', isComposing: false }));
  f.command('escape');
  input.end();
  f.command('escape'); // termination task is still protected
  assert.deepEqual(f.commands, []);
  assert.deepEqual(f.keys, []);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  f.command('escape');
  assert.deepEqual(f.commands, ['escape']);
});

test('save commands still see the live composition text; listener cleanup works', () => {
  const f = fixture();
  input = new CompositionGuard(() => {});
  input.start();
  f.command('save');
  assert.deepEqual(f.commands, ['save']);
  input.dispose();
  cleanup();
  f.target.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
  assert.deepEqual(f.keys, []);
});
