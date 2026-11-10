import { afterEach, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ZedProjectSettings } from './zed-project-settings';
import { ServerRegistry } from './server-registry';

const roots: string[] = [], readers: ZedProjectSettings[] = [];
afterEach(async () => { readers.splice(0).forEach(reader => reader.dispose()); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(changed?: () => void) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'setdown-zed-settings-')); roots.push(home);
  const reader = new ZedProjectSettings({ home, env: {}, platform: 'linux', changed }); readers.push(reader);
  const registry = new ServerRegistry(home, undefined, (definition, file) => reader.options(definition, file));
  const save = async (relative: string, data: unknown) => { const file = path.join(home, relative); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, typeof data === 'string' ? data : JSON.stringify(data)); return file; };
  return { home, reader, registry, save };
}
test('Zed user, home and nested project JSONC settings inherit by server ID, with arrays replaced and explicit Setdown settings retained', async () => {
  const f = await fixture();
  await f.save('.config/zed/settings.json', { lsp: { 'yaml-language-server': { settings: { yaml: { validate: true, customTags: ['!Global scalar'] } }, initialization_options: { test: { global: true } } } } });
  await f.save('.zed/settings.json', { lsp: { 'yaml-language-server': { settings: { yaml: { hover: true } } } } });
  await f.save('project/.zed/settings.json', `{// CloudFormation tags, shared with Zed\n"lsp":{"yaml-language-server":{"settings":{"yaml":{"customTags":["!Sub scalar","!Sub sequence",],},},},},}`);
  await f.save('project/nested/.zed/settings.json', { lsp: { 'yaml-language-server': { settings: { yaml: { completion: false } }, initialization_options: { test: { local: true } } } } });
  const file = path.join(f.home, 'project/nested/template.yaml');
  expect(f.registry.options('yaml-language-server', file)).toMatchObject({ settings: { yaml: { validate: true, hover: true, completion: false, customTags: ['!Sub scalar', '!Sub sequence'] } }, initializationOptions: { test: { global: true, local: true } } });
  expect(f.registry.options('yaml-language-server', path.join(f.home, 'other/template.yaml')).settings).toMatchObject({ yaml: { customTags: ['!Global scalar'] } });
  f.registry.configure('yaml-language-server', { settings: { yaml: { validate: false } } });
  expect(f.registry.options('yaml-language-server', file).settings).toMatchObject({ yaml: { validate: false, customTags: ['!Sub scalar', '!Sub sequence'] } });
  expect(JSON.parse(await readFile(f.registry.file, 'utf8')).servers['yaml-language-server'].settings).toEqual({ yaml: { validate: false } });
});
test('new, edited and removed settings are observed; malformed saves keep the last valid configuration', async () => {
  const changed = vi.fn(), f = await fixture(changed), resource = path.join(f.home, 'project/template.yaml');
  expect(f.registry.options('yaml-language-server', resource).settings).toBeUndefined();
  const file = await f.save('project/.zed/settings.json', { lsp: { 'yaml-language-server': { settings: { yaml: { customTags: ['!Sub scalar', '!Sub sequence'] } } } } });
  await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce(), { timeout: 4000 });
  expect(f.registry.options('yaml-language-server', resource).settings).toMatchObject({ yaml: { customTags: ['!Sub scalar', '!Sub sequence'] } });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await writeFile(file, '{ "lsp":');
    await vi.waitFor(() => expect(warning).toHaveBeenCalled(), { timeout: 4000 });
    expect(changed).toHaveBeenCalledOnce();
    expect(f.registry.options('yaml-language-server', resource).settings).toMatchObject({ yaml: { customTags: ['!Sub scalar', '!Sub sequence'] } });
    await rm(file);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2), { timeout: 4000 });
    expect(f.registry.options('yaml-language-server', resource).settings).toBeUndefined();
  } finally { warning.mockRestore(); }
});
test('extension adapter IDs and initialization_options work without language-specific branches', async () => {
  const f = await fixture();
  await f.save('.config/zed/settings.json', { lsp: { future_server: { settings: { arbitrary: { key: 42 } }, initialization_options: { arbitrary: true } } } });
  const definition = { ...f.registry.definition('yaml-language-server'), id: 'zed.future.server', provenance: undefined };
  expect(f.reader.options(definition, undefined, 'future_server')).toEqual({ settings: { arbitrary: { key: 42 } }, initializationOptions: { arbitrary: true } });
});
