import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OFFICE_VIEWER_PACKAGES, PRESENTATION_EDITOR_PACKAGES, WORD_EDITOR_PACKAGES, officeViewerClosure, officeViewerNotices, presentationEditorClosure, wordEditorClosure } from './office-viewer-notices.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

test('Office viewer notices cover the bundled File Viewer packages and their engines', () => {
  const closure = officeViewerClosure(root);
  const names = closure.map(item => item.name);
  for (const name of [...OFFICE_VIEWER_PACKAGES, '@file-viewer/core', '@file-viewer/docx', '@file-viewer/doc', '@file-viewer/pptx', '@file-viewer/ppt',
    '@ssabrojs/hwpxjs', 'styled-exceljs', 'e-virt-table', 'jszip']) assert.ok(names.includes(name), `${name} is missing from the closure`);
  // Every File Viewer package is pinned to one release line, matching the submodule checkout.
  const versions = new Set(closure.filter(item => /^@file-viewer\/(core|web|renderer-)/.test(item.name)).map(item => item.version));
  assert.equal(versions.size, 1);
  const notices = officeViewerNotices(root);
  for (const item of closure) assert.ok(notices.includes(`=== ${item.name}@${item.version} (`), `${item.name} has no section`);
  for (const name of OFFICE_VIEWER_PACKAGES) assert.match(notices, new RegExp(`--- ${name.replace('/', '\\/')}@[\\d.]+: LICENSE ---\\n\\s*Apache License`));
  assert.match(notices, /--- @file-viewer\/pptx@[\d.]+: dist\/worker\.THIRD_PARTY_LICENSES\.txt ---/);
});

test('Word editor notices cover the engine, its fonts and their licenses, and no Pro package is installed', () => {
  const closure = wordEditorClosure(root);
  const names = closure.map(item => item.name);
  for (const name of [...WORD_EDITOR_PACKAGES, '@docx-editor.dev/i18n', 'harfbuzzjs', 'fflate', 'fast-xml-parser', 'prosemirror-model', 'prosemirror-view'])
    assert.ok(names.includes(name), `${name} is missing from the closure`);
  // The engine holds module-level state, so every one of its packages is pinned to one release.
  const versions = new Set(closure.filter(item => /^@docx-editor\.dev\//.test(item.name)).map(item => item.version));
  assert.equal(versions.size, 1);
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const name of WORD_EDITOR_PACKAGES) assert.equal(manifest.dependencies[name], [...versions][0], `${name} must be pinned exactly`);
  // The separately licensed packages may not be evaluated in, or distributed with, a GPL application.
  for (const name of ['pro', 'editor-api', 'docx-to-pdf', 'telemetry']) {
    assert.ok(!names.includes(`@docx-editor.dev/${name}`), `@docx-editor.dev/${name} must not be bundled`);
    assert.equal(manifest.dependencies[`@docx-editor.dev/${name}`], undefined);
    assert.ok(!existsSync(new URL(`../../../node_modules/@docx-editor.dev/${name}/package.json`, import.meta.url)), `@docx-editor.dev/${name} must not be installed`);
  }
  // Everything bundled is permissively licensed and may be conveyed with a GPL-3.0 application. The fonts are separate
  // files with their own terms: OFL-1.1, the GUST Font License, and CC-BY-4.0 for the emoji art of Twemoji Mozilla,
  // whose attribution is the notice reproduced below.
  const permissive = new Set(['Apache-2.0', 'MIT', '(MIT AND Zlib)', 'Apache-2.0 AND OFL-1.1 AND CC-BY-4.0 AND LicenseRef-GUST-Font-License', 'Apache-2.0 AND OFL-1.1']);
  for (const item of closure) assert.ok(permissive.has(item.license), `${item.name} has an unexpected license: ${item.license}`);
  const notices = officeViewerNotices(root);
  for (const item of closure) assert.ok(notices.includes(`=== ${item.name}@${item.version} (`), `${item.name} has no section`);
  assert.match(notices, /--- @docx-editor\.dev\/core@[\d.]+: LICENSE ---\n[\s\S]{0,400}Apache License/);
  assert.match(notices, /--- @docx-editor\.dev\/core@[\d.]+: licenses\/HarfBuzz-COPYING\.txt ---/);
  assert.match(notices, /--- @docx-editor\.dev\/core@[\d.]+: licenses\/MaterialSymbols-NOTICE\.md ---/);
  for (const font of ['OFL-Carlito.txt', 'OFL-Caladea.txt', 'LICENSE-Liberation.txt', 'OFL-Selawik.txt', 'GUST-FONT-LICENSE.txt', 'TwemojiMozilla-LICENSE.md', 'NotoSansCJK-OFL.txt'])
    assert.ok(notices.includes(`: licenses/${font} ---`), `${font} is missing`);
});

test('presentation editor notices cover the engine and what it bundles, and only its Apache-2.0 package is installed', () => {
  const closure = presentationEditorClosure(root);
  const names = closure.map(item => item.name);
  for (const name of [...PRESENTATION_EDITOR_PACKAGES, '@pptx-editor.dev/i18n', '@docx-editor.dev/fonts', 'bidi-js', 'emf-converter', 'fflate', 'fast-xml-parser'])
    assert.ok(names.includes(name), `${name} is missing from the closure`);
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const engine = closure.find(item => item.name === '@pptx-editor.dev/core');
  assert.equal(manifest.dependencies['@pptx-editor.dev/core'], engine.version, 'the engine must be pinned exactly');
  // It draws with the fonts package the Word editor pins, never a second copy of it.
  assert.equal(closure.find(item => item.name === '@docx-editor.dev/fonts').version, manifest.dependencies['@docx-editor.dev/fonts']);
  assert.equal(closure.filter(item => item.name === '@docx-editor.dev/fonts').length, 1);
  // Only `core` and the message catalogue it depends on are Apache-2.0 and part of Setdown.
  const scope = new URL('../../../node_modules/@pptx-editor.dev/', import.meta.url);
  assert.deepEqual(readdirSync(scope).sort(), ['core', 'i18n']);
  for (const name of Object.keys(manifest.dependencies)) if (name.startsWith('@pptx-editor.dev/')) assert.equal(name, '@pptx-editor.dev/core');
  const permissive = new Set(['Apache-2.0', 'MIT', '(MIT AND Zlib)', 'Apache-2.0 AND OFL-1.1 AND CC-BY-4.0 AND LicenseRef-GUST-Font-License']);
  for (const item of closure) assert.ok(permissive.has(item.license), `${item.name} has an unexpected license: ${item.license}`);
  const notices = officeViewerNotices(root);
  for (const item of closure) assert.ok(notices.includes(`=== ${item.name}@${item.version} (`), `${item.name} has no section`);
  assert.match(notices, /--- @pptx-editor\.dev\/core@[\d.]+: LICENSE ---\n[\s\S]{0,400}Apache License/);
  assert.match(notices, /--- @pptx-editor\.dev\/core@[\d.]+: THIRD_PARTY_NOTICES\.md ---/);
  assert.match(notices, /--- @pptx-editor\.dev\/core@[\d.]+: licenses\/HarfBuzz-COPYING\.txt ---/);
});
