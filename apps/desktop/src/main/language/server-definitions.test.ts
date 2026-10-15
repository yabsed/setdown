import { afterEach, expect, test, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { languageSupport } from '../../core/document/language-support';
import { documentLanguage } from '../../core/document/document-profile';
import { ClangdSettings } from './clangd-settings';
import { serverProfiles, standaloneLanguageRoot } from './server-definitions';

const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
test('routing includes C++ headers/templates and preserves uppercase .C', () => {
  for (const extension of ['cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx', 'ipp', 'inl', 'tpp', 'cppm', 'C']) {
    const file = `main.${extension}`;
    expect(languageSupport(file)).toEqual({ server: 'clangd', languageId: 'cpp' });
    expect(documentLanguage(file, [{ id: 'cpp' }, { id: 'c', extensions: ['.c', '.h'] }])).toBe('cpp');
    expect(serverProfiles.clangd.watches(file)).toBe(true);
  }
  expect(languageSupport('main.c')?.languageId).toBe('c');
  expect(languageSupport('helper.h')?.server).toBe('clangd');
  expect(languageSupport('main.py')?.server).toBe('pyright');
  expect(languageSupport('readme.md')).toBeNull();
  for (const file of ['.clangd', 'build/compile_commands.json', 'compile_flags.txt', '.clang-format'])
    expect(serverProfiles.clangd.watches(file)).toBe(true);
  expect(serverProfiles.clangd.watches('large.o')).toBe(false);
});
test('standalone nested source and header discover the same project boundary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-root-')); roots.push(root);
  await mkdir(path.join(root, 'src')); await mkdir(path.join(root, 'include'));
  await writeFile(path.join(root, '.clangd'), 'CompileFlags: {}');
  expect(standaloneLanguageRoot(path.join(root, 'src/main.cpp'), 'clangd')).toBe(root);
  expect(standaloneLanguageRoot(path.join(root, 'include/helper.h'), 'clangd')).toBe(root);
  expect(standaloneLanguageRoot(path.join(root, 'src/main.py'), 'pyright')).toBe(path.join(root, 'src'));
});
test('clangd settings persist the selected absolute executable and handle spaces without a shell', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-clangd-settings-')); roots.push(root);
  const file = path.join(root, 'config', 'clangd.json');
  const settings = new ClangdSettings(file);
  vi.stubEnv('SETDOWN_CLANGD_PATH', '/custom/clangd');
  expect(settings.executable()).toBe('/custom/clangd');
  const executable = path.join(root, 'clangd with spaces');
  await writeFile(executable, 'fixture'); await chmod(executable, 0o755);
  await settings.set(executable);
  expect(new ClangdSettings(file).executable()).toBe(executable);
  await expect(settings.set(root)).rejects.toThrow();
  await expect(settings.set('relative-clangd')).rejects.toThrow();
  expect(new ClangdSettings(file).executable()).toBe(executable);
});
