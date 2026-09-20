import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { decodeTextBytes, encodedText, MAX_TEXT_FILE_BYTES } from '../../core/document/text-codec';
import { documentLanguage, documentProfile, documentSurface } from '../../core/document/document-profile';
import { prepareDocumentSave } from '../../core/document/document-save';
import { searchSource } from '../../core/search/source-search';
import { readTextFile } from './text-file';
import { atomicWrite } from './file-system';
import { documentPathFromArgs } from './document-args';
import { GitCli } from '../project/engines/git-cli';
import { readGitDocument, readWorkingDocument } from '../project/git-text';
import type { DocumentSnapshot } from '../../core/document/document';

async function temporary(run: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'setdown-text-'));
  try { await run(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}
const document = (filePath: string, loaded: Awaited<ReturnType<typeof readTextFile>>): DocumentSnapshot => ({
  ...loaded, path: filePath, name: path.basename(filePath), savedText: loaded.text,
  revision: 0, savedRevision: 0, isUntitled: false,
});

for (const bom of [false, true]) for (const eol of ['\n', '\r\n']) {
  test(`real file no-op save preserves ${bom ? 'BOM' : 'UTF8'} ${eol === '\n' ? 'LF' : 'CRLF'} and final newline`, async () => {
    await temporary(async root => {
      const file = path.join(root, 'source.cpp');
      const bytes = Buffer.from(`${bom ? '\uFEFF' : ''}// 한글${eol}\tint x = 1;  ${eol}`, 'utf8');
      await fs.writeFile(file, bytes);
      const loaded = await readTextFile(file);
      assert.equal(loaded.encoding, bom ? 'utf8-bom' : 'utf8');
      assert.equal(loaded.eol, eol === '\n' ? 'lf' : 'crlf');
      const output = prepareDocumentSave(document(file, loaded), loaded.text, file);
      await atomicWrite(file, output.bytes);
      assert.deepEqual(await fs.readFile(file), bytes);
    });
  });
}
for (const [name, bytes] of [
  ['invalid UTF8', Buffer.from([0xc3, 0x28])],
  ['UTF16', Buffer.from([0xff, 0xfe, 0x61, 0])],
  ['NUL', Buffer.from('a\0b')],
  ['mixed endings', Buffer.from('a\r\nb\n')],
  ['bare CR', Buffer.from('a\rb')],
  ['binary controls', Buffer.from([1, 2, 3])],
] as const) test(`reject ${name} without touching bytes`, async () => {
  await temporary(async root => {
    const file = path.join(root, 'unknown.custom');
    await fs.writeFile(file, bytes);
    await assert.rejects(readTextFile(file));
    assert.deepEqual(await fs.readFile(file), bytes);
  });
});

test('new text loader rejects binary formats, directories and oversized files before allocation', async () => {
  await temporary(async root => {
    const binary = path.join(root, 'image.png');
    await fs.writeFile(binary, 'not editable even though ASCII');
    await assert.rejects(readTextFile(binary));
    await assert.rejects(readTextFile(root));
    const large = path.join(root, 'large.txt');
    await fs.writeFile(large, '');
    await fs.truncate(large, MAX_TEXT_FILE_BYTES + 1);
    await assert.rejects(readTextFile(large), /limit/);
  });
});

test('small search read limit and no-final-newline metadata are respected', async () => {
  await temporary(async root => {
    const file = path.join(root, 'LICENSE');
    await fs.writeFile(file, 'a\t b  ');
    await assert.rejects(readTextFile(file, 3));
    const loaded = await readTextFile(file);
    assert.equal(loaded.text, 'a\t b  ');
    assert.equal(encodedText(loaded.text, loaded.encoding), 'a\t b  ');
  });
});

test('Save As validates a text destination without imposing text limits on Markdown', () => {
  const doc = { path: '/project/note.md' } as DocumentSnapshot;
  assert.throws(() => prepareDocumentSave(doc, 'a\r\nb\n', '/project/note.txt'));
  assert.throws(() => prepareDocumentSave(doc, 'a', '/project/note.pdf'));
  const large = 'a'.repeat(MAX_TEXT_FILE_BYTES + 1);
  assert.equal(prepareDocumentSave(doc, large, '/project/note.md').text.length, large.length);
  assert.throws(() => prepareDocumentSave(doc, large, '/project/note.txt'));
});

test('text kind is independent of its contents and unknown language support', () => {
  assert.equal(documentSurface('notes.txt', 'viewer'), 'editor');
  assert.equal(documentProfile('notes.txt').preview, null);
  assert.equal(documentProfile('notes.md').preview, 'markdown');
  assert.equal(documentLanguage('notes.unknown', []), 'plaintext');
  assert.equal(documentLanguage('notes.MD', []), 'markdown');
});

test('existing Monaco registry determines C++, exact filenames, longest suffix and first line', () => {
  const languages = [
    { id: 'cpp', extensions: ['.cpp', '.hpp'] },
    { id: 'javascript', extensions: ['.js'] },
    { id: 'typescript', extensions: ['.ts', '.d.ts'] },
    { id: 'dockerfile', filenames: ['Dockerfile'] },
    { id: 'shell', firstLine: '^#!.*\\bsh$' },
  ];
  assert.equal(documentLanguage('MAIN.CPP', languages), 'cpp');
  assert.equal(documentLanguage('x.d.ts', languages), 'typescript');
  assert.equal(documentLanguage('Dockerfile', languages), 'dockerfile');
  assert.equal(documentLanguage('script', languages, '#!/bin/sh'), 'shell');
});

test('CLI skips executable and dev entry and supports text after --', () => {
  const yes = () => true;
  assert.equal(documentPathFromArgs(['/bin/setdown', '/tmp/memo.txt'], true, yes), '/tmp/memo.txt');
  assert.equal(documentPathFromArgs(['/bin/electron', '.', '/tmp/main.cpp'], false, yes), '/tmp/main.cpp');
  assert.equal(documentPathFromArgs(['/bin/electron', '.'], false, yes), undefined);
  assert.equal(documentPathFromArgs(['/bin/setdown', '--trace-warnings', '/tmp/note.txt'], true, yes), '/tmp/note.txt');
  assert.equal(documentPathFromArgs(['/bin/setdown', '--', '-note.txt'], true, yes), path.resolve('-note.txt'));
});

test('literal source search uses Monaco UTF16 columns and respects limits', () => {
  assert.deepEqual(searchSource('😀Alpha alpha\r\n[a+b]', 'alpha', 1).map(x => [x.line, x.column]), [[1, 3]]);
  assert.equal(searchSource('[a+b]', '[a+b]', 10).length, 1);
  assert.equal(searchSource('a', '', 10).length, 0);
});

test('real Git HEAD/Index/Working Tree text versions preserve EOL and strip only the BOM', async () => {
  await temporary(async root => {
    await GitCli.run(root, ['init']);
    await GitCli.run(root, ['config', 'user.name', 'Setdown Test']);
    await GitCli.run(root, ['config', 'user.email', 'setdown@example.test']);
    await GitCli.run(root, ['config', 'core.autocrlf', 'false']);
    const file = path.join(root, 'main.cpp');
    await fs.writeFile(file, '\uFEFF// HEAD 한글\r\n');
    await GitCli.run(root, ['add', '--', 'main.cpp']);
    await GitCli.run(root, ['commit', '-m', 'base']);
    await fs.writeFile(file, '\uFEFF// INDEX\r\n');
    await GitCli.run(root, ['add', '--', 'main.cpp']);
    await fs.writeFile(file, '\uFEFF// WORKTREE\r\n');
    const repo = await GitCli.connect(root);
    assert.ok(repo);
    assert.equal(await readGitDocument(repo, 'HEAD:main.cpp', file), '// HEAD 한글\r\n');
    assert.equal(await readGitDocument(repo, ':main.cpp', file), '// INDEX\r\n');
    assert.equal(await readWorkingDocument(file), '// WORKTREE\r\n');
    assert.equal(await readGitDocument(repo, 'HEAD:missing.txt', path.join(root, 'missing.txt')), '');
  });
});

test('real Git undecodable blobs are unsupported, never silently empty or replacement text', async () => {
  await temporary(async root => {
    await GitCli.run(root, ['init']);
    const file = path.join(root, 'bad.txt');
    await fs.writeFile(file, Buffer.from([0xff, 0x61]));
    await GitCli.run(root, ['add', '--', 'bad.txt']);
    const repo = await GitCli.connect(root);
    assert.ok(repo);
    assert.equal(await readGitDocument(repo, ':bad.txt', file), null);
    assert.equal(await readWorkingDocument(file), null);
    assert.equal(await readWorkingDocument(path.join(root, 'missing.txt')), '');
    assert.throws(() => decodeTextBytes(Buffer.from([0xff, 0x61])));
  });
});
