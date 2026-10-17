import { expect, test } from 'vitest';
import { jsonDialect, recognizedLanguage } from './language-policy';
import { languageSupport, resourceLanguageRoutes, type LanguageRoute } from './language-support';

test('disabled providers retain language recognition without becoming connection candidates', () => {
  const routes: LanguageRoute[] = [{ server: 'example', languageId: 'example', monacoId: 'python', extensions: ['.custom.py'], enabled: false }];
  expect(recognizedLanguage('/project/main.custom.py', [], routes)).toBe('python');
  expect(languageSupport('/project/main.custom.py', routes)).toBeNull();
  expect(recognizedLanguage('/project/unknown.xyz', [], routes)).toBe('plaintext');
});

test('C++ identity and first-line recognition survive the absence of every server', () => {
  const languages = [{ id: 'cpp', extensions: ['.cpp'] }, { id: 'c', extensions: ['.c'] },
    { id: 'python', firstLine: '^#!.*python' }];
  expect(recognizedLanguage('/project/main.C', languages, [])).toBe('cpp');
  expect(recognizedLanguage('/project/main.c', languages, [])).toBe('c');
  expect(recognizedLanguage('/project/tool', languages, [], '#!/usr/bin/env python3')).toBe('python');
});

test('project routing respects directory boundaries, nested scopes and unrelated resources', () => {
  const routes: LanguageRoute[] = [{ server: 'tool', languageId: 'json', extensions: ['.json'], role: 'primary', formatting: true,
    scopes: [{ root: '/work/app/packages', formatting: true }, { root: '/work/app', role: 'supplementary', formatting: false }] }];
  expect(resourceLanguageRoutes(routes, '/work/app/main.json')[0]).toMatchObject({ role: 'supplementary', formatting: false });
  expect(resourceLanguageRoutes(routes, '/work/app/packages/lib/main.json')[0]).toMatchObject({ role: 'supplementary', formatting: true });
  expect(resourceLanguageRoutes(routes, '/work/application/main.json')[0]).toMatchObject({ role: 'primary', formatting: true });
  expect(routes[0]).toMatchObject({ role: 'primary', formatting: true });
});

test('Windows resource routing uses directory boundaries too', () => {
  const routes: LanguageRoute[] = [{ server: 'tool', languageId: 'json', extensions: ['.json'], formatting: false,
    scopes: [{ root: 'C:\\work\\app\\', formatting: true }] }];
  expect(resourceLanguageRoutes(routes, 'C:\\work\\app\\main.json')[0].formatting).toBe(true);
  expect(resourceLanguageRoutes(routes, 'C:\\work\\application\\main.json')[0].formatting).toBe(false);
});

test('JSONC and JSON Lines are resource dialects, without weakening ordinary JSON', () => {
  for (const file of ['/app/tsconfig.json', '/app/tsconfig.build.json', 'C:\\app\\.vscode\\settings.json', '/app/settings.jsonc', '/app/example.code-workspace'])
    expect(jsonDialect(file)).toBe('jsonc');
  expect(jsonDialect('/app/data.jsonl')).toBe('jsonl');
  for (const file of ['/app/package.json', '/app/settings.json', '/app/data.json']) expect(jsonDialect(file)).toBe('json');
});
