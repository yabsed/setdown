import { afterEach, expect, test, vi } from 'vitest';
import { promises as fs, watchFile, unwatchFile } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { atomicWrite } from '../../apps/desktop/src/main/documents/file-system';
import { DocumentManager } from '../../apps/desktop/src/main/documents/document-manager';
import { rewriteDraftAssetReferences, saveDraftBundle } from '../../apps/desktop/src/main/documents/draft-assets';
import { GitService, parseGitDiffHunks } from '../../apps/desktop/src/main/project/git-service';
import { GitCli } from '../../apps/desktop/src/main/project/engines/git-cli';
import { ProjectPaths } from '../../apps/desktop/src/main/project/project-paths';
import { copyExclusive } from '../../apps/desktop/src/main/project/file-transfer';
import { indexVisibleHtml, searchVisibleText } from '../../apps/desktop/src/main/project/visible-search';
import { NotebookDocument } from '../../apps/desktop/src/core/notebook/notebook-document';
import { retainUnsavedRevision } from '../../apps/desktop/src/core/document/document-save';
import { savePastedPng } from '../../apps/desktop/src/main/documents/pasted-image';
import { markdownDestinationForFile } from '../../apps/desktop/src/main/documents/markdown-link';
import { ExplorerService } from '../../apps/desktop/src/main/project/explorer-service';
import { readHwp } from '../../apps/desktop/src/main/documents/hwp-file';
import { ServerItems } from '../../apps/desktop/src/main/language/server-items';
import { AutoSaveController } from '../../apps/desktop/src/renderer/workspace/auto-save';
import { readGitDocument } from '../../apps/desktop/src/main/project/git-text';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { readerMarkdown } from '../../apps/desktop/src/core/browser/reader-export';
import type { WindowState } from '../../apps/desktop/src/main/windows/window-state';

const electron = vi.hoisted(() => ({ save: vi.fn(), message: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, clipboard: {},
  dialog: { showSaveDialog: electron.save, showMessageBox: electron.message }, shell: {} }));
const roots: string[] = [], watched: string[] = [];
async function writable(directory: string) {
  await fs.chmod(directory, 0o700);
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) if (entry.isDirectory()) await writable(path.join(directory, entry.name));
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const file of watched.splice(0)) unwatchFile(file);
  for (const root of roots.splice(0)) { await writable(root); await fs.rm(root, { recursive: true, force: true }); }
});
async function temp() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'setdown-audit-')); roots.push(root); return root; }
function state(root: string): WindowState {
  return { projectRoot: root, watchedPath: null, currentDocument: null,
    window: { webContents: { send: vi.fn() } } } as unknown as WindowState;
}
async function repository() {
  const root = await temp();
  await GitCli.run(root, ['init']);
  await GitCli.run(root, ['config', 'user.name', 'Audit']);
  await GitCli.run(root, ['config', 'user.email', 'audit@example.invalid']);
  return { root, service: new GitService(new ProjectPaths()), state: state(root) };
}
async function commit(root: string) { await GitCli.run(root, ['add', '-A']); await GitCli.run(root, ['commit', '-qm', 'fixture']); }

// Assertions describe the required behavior. Failures are the audit evidence,
// not tests to weaken or invert into green tests.
test('F01 stopping one window watcher must preserve another window watcher', async () => {
  const root = await temp(), file = path.join(root, 'note.md');
  await fs.writeFile(file, 'before'); watched.push(file);
  const manager = new DocumentManager(() => {}), a = state(root), b = state(root);
  a.currentDocument = await manager.read(file); b.currentDocument = await manager.read(file);
  manager.watch(a); manager.watch(b);
  const probe = () => {};
  const watcher = watchFile(file, probe); unwatchFile(file, probe);
  expect(watcher.listenerCount('change')).toBe(2);
  manager.stopWatching(a);
  expect(watcher.listenerCount('change')).toBe(1);
});

test('F02 deleting the watched file must publish an external change', async () => {
  const root = await temp(), file = path.join(root, 'note.md');
  await fs.writeFile(file, 'before'); watched.push(file);
  const manager = new DocumentManager(() => {}), owner = state(root);
  owner.currentDocument = await manager.read(file); manager.watch(owner);
  const probe = () => {}; const watcher = watchFile(file, probe); unwatchFile(file, probe);
  await fs.unlink(file);
  // The zeroed stat is exactly the missing-file branch delivered by fs.watchFile.
  watcher.emit('change', { nlink: 0, mtimeMs: 0, size: 0 }, { nlink: 1 });
  expect(owner.window.webContents.send).toHaveBeenCalled();
});

test('F03 same-millisecond atomic saves must not share a temporary file', async () => {
  const root = await temp(), file = path.join(root, 'note.txt');
  await fs.writeFile(file, 'base'); vi.spyOn(Date, 'now').mockReturnValue(123456);
  const results = await Promise.allSettled([atomicWrite(file, 'first'), atomicWrite(file, 'second')]);
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
});

test('F04 saving must preserve original group write permissions under umask', async () => {
  const root = await temp(), file = path.join(root, 'note.txt');
  await fs.writeFile(file, 'base'); await fs.chmod(file, 0o666);
  expect(process.umask() & 0o022).not.toBe(0);
  await atomicWrite(file, 'changed');
  expect((await fs.stat(file)).mode & 0o777).toBe(0o666);
});

test('F05 Save As to a symbolic link must update its target and keep the link', async () => {
  const root = await temp(), original = path.join(root, 'original.md');
  const target = path.join(root, 'target.md'), link = path.join(root, 'link.md');
  await fs.writeFile(original, 'source'); await fs.writeFile(target, 'target'); await fs.symlink(target, link);
  const manager = new DocumentManager(() => {}), owner = state(root);
  owner.currentDocument = await manager.read(original);
  watched.push(link);
  electron.save.mockResolvedValue({ canceled: false, filePath: link });
  const result = await manager.saveAs(owner, 'new content', 1);
  expect(result.canceled).toBe(false);
  expect({ link: (await fs.lstat(link)).isSymbolicLink(), text: await fs.readFile(target, 'utf8') })
    .toEqual({ link: true, text: 'new content' });
});

test('F06 draft relocation must not rewrite code and external URLs', () => {
  const original = 'Example: `Untitled.assets/a.png`\nhttps://example.test/Untitled.assets/b.png\n![x](<Untitled.assets/a.png>)';
  expect(rewriteDraftAssetReferences(original, 'Untitled.assets', 'report.assets'))
    .toBe('Example: `Untitled.assets/a.png`\nhttps://example.test/Untitled.assets/b.png\n![x](<report.assets/a.png>)');
});

test('F07 draft relocation must update percent-encoded local asset links', async () => {
  const root = await temp(), drafts = path.join(root, 'drafts'), source = path.join(drafts, 'id', 'Untitled 2.md');
  await fs.mkdir(path.join(path.dirname(source), 'Untitled 2.assets'), { recursive: true });
  await fs.writeFile(path.join(path.dirname(source), 'Untitled 2.assets', 'image.png'), 'fixture');
  const destination = path.join(root, 'saved.md');
  const result = await saveDraftBundle(drafts, source, destination, '![x](Untitled%202.assets/image.png)');
  expect(result.text).toBe('![x](saved.assets/image.png)');
});

test('F08 Git changed content beginning with -- or ++ must remain in the hunk', () => {
  const patch = '--- a/a.md\n+++ b/a.md\n@@ -1,2 +1,2 @@\n---old\n+++new\n tail\n';
  expect(parseGitDiffHunks(patch)).toEqual([{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 }]);
});

test('F09 staged rename must read HEAD from the old pathname', async () => {
  const f = await repository();
  await fs.writeFile(path.join(f.root, 'old.md'), 'unchanged body\n'); await commit(f.root);
  await GitCli.run(f.root, ['mv', 'old.md', 'new.md']);
  const diff = await f.service.diff(f.state, path.join(f.root, 'new.md'), true);
  expect(diff.originalText).toBe('unchanged body\n');
});

test('F10 stage and discard must treat Git metacharacters as a literal filename', async () => {
  const f = await repository();
  for (const name of ['[ab].txt', 'a.txt', 'b.txt']) await fs.writeFile(path.join(f.root, name), 'base');
  await commit(f.root);
  for (const name of ['[ab].txt', 'a.txt', 'b.txt']) await fs.writeFile(path.join(f.root, name), 'changed');
  await f.service.stage(f.state, [path.join(f.root, '[ab].txt')]);
  const staged = (await GitCli.run(f.root, ['diff', '--cached', '--name-only'])).trim().split('\n');
  for (const name of ['[ab].txt', 'a.txt', 'b.txt']) await fs.writeFile(path.join(f.root, name), 'new unsaved work');
  await f.service.discard(f.state, [path.join(f.root, '[ab].txt')]);
  expect({ staged, unselected: await fs.readFile(path.join(f.root, 'a.txt'), 'utf8') })
    .toEqual({ staged: ['[ab].txt'], unselected: 'new unsaved work' });
});

test('F11 externally initialized repositories must be detected by refresh', async () => {
  const root = await temp(), owner = state(root), service = new GitService(new ProjectPaths());
  expect((await service.status(owner)).repository).toBe(false);
  await GitCli.run(root, ['init']);
  expect((await service.status(owner)).repository).toBe(true);
});

test('F12 stage and discard must operate on a symlink entry, not the linked file', async () => {
  const f = await repository();
  const target = path.join(f.root, 'target.txt'), other = path.join(f.root, 'other.txt'), link = path.join(f.root, 'link.txt');
  await fs.writeFile(target, 'target'); await fs.writeFile(other, 'other'); await fs.symlink(target, link); await commit(f.root);
  await fs.unlink(link); await fs.symlink(other, link); await fs.writeFile(other, 'modified target');
  await f.service.stage(f.state, [link]);
  const staged = (await GitCli.run(f.root, ['diff', '--cached', '--name-only'])).trim();
  await fs.writeFile(other, 'new target work');
  await f.service.discard(f.state, [link]);
  expect({ staged, target: await fs.readFile(other, 'utf8') }).toEqual({ staged: 'link.txt', target: 'new target work' });
});

test('F13 Unicode case folding must preserve source offsets across text nodes', () => {
  const index = indexVisibleHtml('<p data-source-line="1">İ</p><p data-source-line="2">x</p>');
  const matches = searchVisibleText(index, 'x', 10);
  expect(matches.map(({ line, column }) => ({ line, column }))).toEqual([{ line: 2, column: 1 }]);
});

test('F14 copying a read-only directory tree must complete and preserve its mode', async () => {
  const root = await temp(), source = path.join(root, 'source'), destination = path.join(root, 'copy');
  await fs.mkdir(source); await fs.writeFile(path.join(source, 'note.txt'), 'data'); await fs.chmod(source, 0o555);
  try { await copyExclusive(source, destination); }
  finally { await fs.chmod(source, 0o755); if (await fs.stat(destination).catch(() => null)) await fs.chmod(destination, 0o755); }
  expect(await fs.readFile(path.join(destination, 'note.txt'), 'utf8')).toBe('data');
});

test('F15 markdown-to-code conversion must not keep a markdown-only attachments field', async () => {
  const notebook = new NotebookDocument(JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [
    { id: 'one', cell_type: 'markdown', metadata: {}, source: '![x](attachment:x.png)', attachments: { 'x.png': { 'image/png': 'aGVsbG8=' } } },
  ] }));
  notebook.convert('one', 'code');
  const serialized = notebook.serialize();
  await fs.writeFile(new URL('./converted-code-cell.ipynb', import.meta.url), serialized);
  expect(JSON.parse(serialized).cells[0]).not.toHaveProperty('attachments');
});

test('F16 a Markdown read must not associate stale contents with a newer disk version', async () => {
  const root = await temp(), file = path.join(root, 'note.md');
  await fs.writeFile(file, 'old');
  const readFile = fs.readFile.bind(fs);
  // Deterministically inject the external write between readFile and diskVersion.
  vi.spyOn(fs, 'readFile').mockImplementation(async (...args: any[]) => {
    const result = await (readFile as any)(...args);
    if (args[0] === file) await fs.writeFile(file, 'new external content');
    return result;
  });
  const manager = new DocumentManager(() => {});
  const snapshot = await manager.read(file);
  vi.restoreAllMocks();
  const result = await manager.saveSnapshot(state(root), snapshot, 'edited old content', 1, true);
  expect(result.canceled).toBe(true);
});

test('F17 an edit during first draft save must retain relocated asset references', async () => {
  const root = await temp(), drafts = path.join(root, 'drafts'), source = path.join(drafts, 'id', 'Untitled.md');
  await fs.mkdir(path.join(path.dirname(source), 'Untitled.assets'), { recursive: true });
  await fs.writeFile(path.join(path.dirname(source), 'Untitled.assets', 'image.png'), 'fixture');
  const destination = path.join(root, 'saved.md'), oldText = '![x](<Untitled.assets/image.png>)';
  const saved = await saveDraftBundle(drafts, source, destination, oldText);
  const manager = new DocumentManager(() => {}), snapshot = { ...await manager.read(destination), revision: 1, savedRevision: 1 };
  const current = retainUnsavedRevision(snapshot, oldText + '\nnew typing', 2);
  expect(current.text).toBe(saved.text + '\nnew typing');
});

test('F18 pasted image and local link paths must encode URL delimiters in filenames', async () => {
  const root = await temp(), file = path.join(root, 'notes#1.md');
  const image = await savePastedPng(file, new Uint8Array([1, 2, 3]));
  const link = markdownDestinationForFile(file, path.join(root, 'reference#2.pdf'));
  expect({ image: fileURLToPath(new URL(image.markdownPath, pathToFileURL(file))),
    link: fileURLToPath(new URL(link, pathToFileURL(file))) }).toEqual({ image: image.absolutePath, link: path.join(root, 'reference#2.pdf') });
});

test('F19 New File for a supported HWPX document must create an openable document', async () => {
  const root = await temp(), service = new ExplorerService(new ProjectPaths());
  const result = await service.create(state(root), root, 'new.hwpx', 'file');
  await expect(new DocumentManager(() => {}).read(result.path)).resolves.toMatchObject({ kind: 'hwp' });
});

test('F20 discarded language completion commands must not exhaust the item budget forever', () => {
  const items = new ServerItems(4096);
  expect(() => {
    for (let version = 1; version <= 30; version++) {
      const origin = { document: 'doc', generation: 'generation', version };
      const reply = items.remember('textDocument/completion', [{ label: 'x', command: { title: 'after insert', command: 'server.afterInsert' } }], origin) as any[];
      items.release([reply[0].$setdownItem, reply[0].command.$setdownItem], origin);
      // Exactly the ordinary language:change path. No suggestion was accepted.
      items.forget('doc', false);
    }
  }).not.toThrow();
});

test('F21 a non-regular HWP file must fail before waiting for a FIFO writer', async () => {
  const root = await temp(), file = path.join(root, 'pipe.hwp');
  execFileSync('mkfifo', [file]);
  let settled = false;
  const reading = readHwp(file).then(() => { settled = true; }, () => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 100));
  const rejectedBeforeWriter = settled;
  // Unblock our own reader and cleanly close both descriptors, even on failure.
  if (!settled) { const writer = await fs.open(file, constants.O_WRONLY | constants.O_NONBLOCK); await writer.close(); }
  await reading;
  expect(rejectedBeforeWriter).toBe(true);
});

test('F22 disabling auto save must cancel saves still waiting in its queue', async () => {
  const tabs = ['a', 'b'].map(id => ({ id, document: { path: `/${id}.txt`, isUntitled: false }, revision: 1 }));
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const writes: string[] = [];
  const controller = new AutoSaveController({ tabs, activeId: () => 'a', text: () => 'dirty', dirty: () => true,
    desktop: { saveTabDocument: async (doc: any) => { writes.push(doc.path); if (doc.path === '/a.txt') await gate; return { canceled: true }; } },
    acceptSaved: async () => {}, saved: () => {} } as any);
  controller.setEnabled(true);
  await vi.waitFor(() => expect(writes).toEqual(['/a.txt']));
  controller.setEnabled(false); finish();
  // Drain without introducing hold()'s additional pause behavior.
  await (controller as any).queue;
  expect(writes).toEqual(['/a.txt']);
});

test('F23 a Markdown Git blob above 4 MB must not be presented as an empty version', async () => {
  const f = await repository(), file = path.join(f.root, 'large.md');
  const content = 'a'.repeat(4_100_000);
  await fs.writeFile(file, content); await commit(f.root);
  const git = await GitCli.connect(f.root);
  const result = await readGitDocument(git!, 'HEAD:large.md', file);
  expect(result === null || result === content).toBe(true);
});

test('F24 reader Markdown export must preserve IDs attached to headings themselves', () => {
  const result = readerMarkdown({ url: 'https://example.test/article', title: 'Article', byline: null, siteName: null,
    content: '<a href="#section-123">Jump</a><h2 id="section-123">Heading</h2><p>Body</p>' });
  expect(result).toContain('<a id="section-123"></a>');
});

test('F25 visible search must exclude text hidden with an important inline declaration', () => {
  const index = indexVisibleHtml('<p style="display: none !important" data-source-line="1">secret</p><p data-source-line="2">shown</p>');
  expect(searchVisibleText(index, 'secret', 10)).toEqual([]);
});
