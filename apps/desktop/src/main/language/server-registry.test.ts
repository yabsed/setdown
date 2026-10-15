import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ServerRegistry } from './server-registry';
import { languageSupport } from '../../core/document/language-support';
import { validateLanguageDefinition } from '../../core/document/language-definition';
import { standaloneLanguageRoot } from './server-definitions';
import { configurationSection } from './server-session';
import { textSynchronization } from '../../protocol/language';
const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function directory() { const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-registry-')); roots.push(root); return root; }
const definition = { id: 'user-server', name: 'User server', launch: { kind: 'native', command: 'custom-server', args: ['--stdio'] },
  languages: [{ languageId: 'python', extensions: ['.py', '.pyi'] }], rootMarkers: ['custom.project'],
  settings: { custom: { diagnostics: true } }, initializationOptions: { indexing: false } };

test('custom definitions, active selection, settings and fingerprints survive restart without language branches', async () => {
  const root = await directory();
  let registry = new ServerRegistry(root);
  expect(registry.routes().some(route => route.server === 'gopls')).toBe(true);
  registry.add(definition);
  expect(languageSupport('main.py', registry.routes())?.server).toBe('pyright');
  registry.setEnabled('user-server', true);
  expect(languageSupport('main.py', registry.routes())?.server).toBe('user-server');
  const fingerprint = registry.fingerprint('user-server');
  registry.configure('user-server', { args: ['--stdio', '--verbose'], settings: { custom: { diagnostics: false } }, initializationOptions: { mode: 1 } });
  expect(registry.fingerprint('user-server')).not.toBe(fingerprint);
  registry = new ServerRegistry(root);
  expect(languageSupport('main.py', registry.routes())?.server).toBe('user-server');
  expect(registry.launch('user-server', false).args).toEqual(['--stdio', '--verbose']);
  expect(registry.options('user-server').settings).toEqual({ custom: { diagnostics: false } });
  registry.setEnabled('pyright', true);
  expect(languageSupport('main.py', registry.routes())?.server).toBe('pyright');
  registry.setEnabled('pyright', false);
  expect(languageSupport('main.py', registry.routes())?.server).toBe('user-server');
  registry.remove('user-server');
  expect(languageSupport('main.py', registry.routes())).toBeNull();
  expect(new ServerRegistry(root).definitions().some(d => d.id === 'user-server')).toBe(false);
});

test('legacy clangd selection wins over the environment until the generic chooser overrides it', async () => {
  const root = await directory();
  await writeFile(path.join(root, 'clangd.json'), JSON.stringify({ executable: '/earlier/clangd' }));
  vi.stubEnv('SETDOWN_CLANGD_PATH', '/environment/clangd');
  const registry = new ServerRegistry(root);
  expect(registry.executable('clangd')).toBe('/earlier/clangd');
  await registry.chooseExecutable('clangd', process.execPath);
  expect(new ServerRegistry(root).executable('clangd')).toBe(process.execPath);
  expect(JSON.parse(await readFile(path.join(root, 'clangd.json'), 'utf8')).executable).toBe('/earlier/clangd');
});

test('definitions cannot replace bundled launchers, inject shells, or escape root-marker names', async () => {
  const registry = new ServerRegistry(await directory());
  for (const id of ['pyright', 'clangd']) expect(() => registry.add({ ...definition, id })).toThrow(/built-in/);
  for (const id of ['__proto__', 'constructor', 'prototype']) expect(() => registry.add({ ...definition, id })).toThrow();
  expect(() => registry.setEnabled('unregistered', true)).toThrow(/Unknown/);
  expect(() => validateLanguageDefinition({ ...definition, rootMarkers: ['../other'] })).toThrow();
  expect(() => validateLanguageDefinition({ ...definition, launch: { kind: 'bundledNode', module: 'anything', args: [] } })).toThrow();
  registry.add({ ...definition, launch: { kind: 'native', command: 'server.cmd', args: [] } });
  expect(() => registry.launch('user-server', false)).toThrow(/shell launchers/);
  registry.add(definition);
  vi.stubEnv('NODE_OPTIONS', '--require=untrusted'); vi.stubEnv('ELECTRON_RUN_AS_NODE', '1');
  const launch = registry.launch('user-server', false);
  expect(launch.env?.NODE_OPTIONS).toBeUndefined(); expect(launch.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
});

test('a new definition discovers its own root and longer extensions win', async () => {
  const root = await directory(); await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'custom.project'), '');
  const custom = validateLanguageDefinition(definition);
  expect(standaloneLanguageRoot(path.join(root, 'src/main.py'), custom)).toBe(root);
  expect(languageSupport('main.custom.py', [
    { server: 'one', languageId: 'python', extensions: ['.py'] },
    { server: 'two', languageId: 'custom', extensions: ['.custom.py'] },
  ])?.server).toBe('two');
});

test('malformed settings are reported and failed persistence does not change in-memory routing', async () => {
  const root = await directory(), file = path.join(root, 'language-servers.json');
  await writeFile(file, '{invalid'); expect(() => new ServerRegistry(root)).toThrow();
  await rm(file); const registry = new ServerRegistry(root);
  await mkdir(file + '.tmp');
  expect(() => registry.setEnabled('pyright', false)).toThrow();
  expect(registry.enabled('pyright')).toBe(true);
});

test('configuration sections and sync negotiation honor the protocol without claiming unsupported modes', () => {
  const settings = { python: { analysis: { typeCheckingMode: 'basic' } } };
  expect(configurationSection(settings)).toEqual(settings);
  expect(configurationSection(settings, 'python.analysis')).toEqual({ typeCheckingMode: 'basic' });
  expect(configurationSection(settings, 'python.missing')).toBeNull();
  expect(configurationSection(settings, 'constructor')).toBeNull();
  expect(textSynchronization({ textDocumentSync: 1 })).toEqual({ change: 1, openClose: true, save: false });
  expect(textSynchronization({ textDocumentSync: { change: 2, openClose: true, save: { includeText: true } } }))
    .toEqual({ change: 2, openClose: true, save: { includeText: true } });
  expect(textSynchronization({ textDocumentSync: { save: true } }).save).toEqual({});
  expect(textSynchronization({})).toEqual({ change: 0, openClose: false, save: false });
});

test('automatic Fortran routes need no user settings and explicit disabling survives reload', async () => {
  const root = await directory(), registry = new ServerRegistry(root);
  expect(languageSupport('hello.F90', registry.routes())).toEqual({ server: 'fortls', languageId: 'fortran' });
  expect(registry.automatic('fortls')).toBe(true);
  expect(registry.definition('fortls').launch.args).toContain('--disable_autoupdate');
  registry.setEnabled('fortls', false);
  expect(languageSupport('hello.f90', new ServerRegistry(root).routes())).toBeNull();
});

test('a pre-existing custom fortls profile shadows the new default and preserves user arguments', async () => {
  const root = await directory();
  await writeFile(path.join(root, 'language-servers.json'), JSON.stringify({ version: 1, preferred: { fortran: 'fortls' },
    servers: { fortls: { enabled: true } }, custom: [{ ...definition, id: 'fortls',
      languages: [{ languageId: 'fortran', extensions: ['.f90'] }], launch: { kind: 'native', command: '/my/fortls', args: ['--custom'] } }] }));
  const registry = new ServerRegistry(root);
  expect(registry.definitions().filter(d => d.id === 'fortls')).toHaveLength(1);
  expect(registry.isCustom('fortls')).toBe(true); expect(registry.launch('fortls', false).args).toEqual(['--custom']);
  registry.setEnabled('fortls', false); expect(new ServerRegistry(root).executable('fortls')).toBe('/my/fortls');
});

test('returning to automatic detection clears a manual or legacy override without changing enablement', async () => {
  const root = await directory(), registry = new ServerRegistry(root);
  await writeFile(path.join(root, 'clangd.json'), JSON.stringify({ executable: '/legacy/clangd' }));
  await registry.chooseExecutable('clangd', process.execPath); registry.setEnabled('clangd', false);
  registry.useAutomatic('clangd');
  const restored = new ServerRegistry(root);
  expect(restored.executable('clangd')).toBe('clangd'); expect(restored.enabled('clangd')).toBe(false);
});
