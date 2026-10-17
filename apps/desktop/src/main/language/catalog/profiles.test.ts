import { expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { builtinLanguageServers, languageCatalog, packageDiscovery } from './profiles';
import data from './profiles.json';
import mason from './mason.json';
import { validateLanguageDefinition } from '../../../core/document/language-definition';
import { languageSupport } from '../../../core/document/language-support';
import { ServerRegistry } from '../server-registry';

test('TypeScript and CSS workspace settings are delivered separately from initialization options', () => {
  const ts = builtinLanguageServers.find(d => d.id === 'typescript-language-server')!;
  expect(ts.settings.typescript).toMatchObject({ inlayHints: { includeInlayParameterNameHints: 'all' } });
  expect(ts.initializationOptions).not.toHaveProperty('typescript');
  const css = builtinLanguageServers.find(d => d.id === 'css-lsp')!;
  for (const language of ['css', 'scss', 'less']) {
    expect(css.settings[language]).toMatchObject({ validate: true, lint: {} });
    expect(css.initializationOptions).not.toHaveProperty(language);
  }
});

test('every catalog entry has explicit coverage and generated native profiles satisfy the connection schema', () => {
  expect(new Set(data.coverage.map(c => c.id))).toEqual(new Set(mason.packages.map(p => p.id)));
  expect(new Set(languageCatalog.map(p => p.id)).size).toBe(languageCatalog.length);
  expect(builtinLanguageServers.length).toBeGreaterThan(150);
  for (const definition of builtinLanguageServers) {
    if (definition.launch.kind === 'native') expect(() => validateLanguageDefinition(definition), definition.id).not.toThrow();
    if (definition.enabledByDefault) expect(['npx', 'npm', 'pixi', 'cs', 'ncat']).not.toContain(definition.launch.kind === 'native' && definition.launch.command);
  }
  expect(packageDiscovery('json-lsp')).toEqual({ python: false, npmPackage: 'vscode-langservers-extracted' });
  expect(packageDiscovery('fortls').python).toBe(true);
});

test('upstream profiles route actual names, compound suffixes, variants and Windows paths without enabling writing servers', () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'setdown-profile-test-'));
  try {
    const registry = new ServerRegistry(folder), routes = registry.routes();
    const cases = [
      ['src/main.ts', 'typescript'], ['src/component.tsx', 'typescriptreact'], ['src/view.jsx', 'javascriptreact'],
      ['C:\\project\\Dockerfile', 'dockerfile'], ['CMakeLists.txt', 'cmake'], ['Cargo.toml', 'toml'],
      ['.config/.bashrc', 'bash'], ['project/go.mod', 'gomod'], ['project/tsconfig.json', 'jsonc'],
      ['project/docker-compose.yaml', 'dockercompose'], ['project/main.C', 'cpp'], ['project/main.c', 'c'], ['project/hello.F90', 'fortran'],
    ];
    for (const [file, languageId] of cases) expect(languageSupport(file, routes)?.languageId, file).toBe(languageId);
    expect(languageSupport('README.md', routes)).toBeNull();
    expect(languageSupport('unrecognized.extension', routes)).toBeNull();
    expect(registry.candidates('src/main.ts').map(c => c.server)).toContain('typescript-language-server');
    expect(registry.candidates('src/main.ts').map(c => c.server)).not.toContain('eslint-lsp');
    registry.setEnabled('typescript-language-server', true);
    expect(registry.candidates('src/main.ts')).toEqual([{ server: 'typescript-language-server', languageId: 'typescript' }]);
    registry.setEnabled('typescript-language-server', false);
    expect(new ServerRegistry(folder).candidates('src/main.ts').map(c => c.server)).not.toContain('typescript-language-server');
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('different launch variants retain their identities and specific globs win over broad associations', () => {
  expect(builtinLanguageServers.find(d => d.id === 'ada-gpr-language-server')?.launch.args).toEqual(['--language-gpr']);
  expect(builtinLanguageServers.find(d => d.id === 'ada-language-server')?.launch.args).toEqual([]);
  expect(languageSupport('/workspace/.vscode/settings.json', [
    { server: 'generic', languageId: 'json', extensions: [], filenamePatterns: ['*.json'] },
    { server: 'specific', languageId: 'jsonc', extensions: [], filenamePatterns: ['.vscode/*.json'] },
  ])).toEqual({ server: 'specific', languageId: 'jsonc' });
});
