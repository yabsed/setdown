import assert from 'node:assert/strict';
import { beforeEach, afterEach, test, vi } from 'vitest';
import { createWorkspaceTab, createTabSession, WorkspaceState } from '../../core/workspace/workspace-state';
import type { DocumentSnapshot } from '../../core/document/document';
import { TabController } from './tab-controller';
import { SurfaceController } from '../application/surface-controller';
import { PreviewSession } from '../reader/preview-session';
import { browserURL } from '../../core/browser/browser-url';
import type { BrowserPage } from '../../core/browser/browser-state';
import { fileURLToPath } from 'node:url';
import type { WebHistory } from '../../core/workspace/tab-navigation';

vi.mock('../view-state.svelte', () => ({ view: {} }));
vi.mock('../shell/layout-session', () => ({ restoredOutlineOpen: () => false }));
const anchor = { sourceLine: 1, yRatio: .372, reason: 'empty-document', confidence: 'fallback' } as const;
const calls: string[] = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('window', { setTimeout: () => { calls.push('timer'); return 1; }, clearTimeout() {}, dispatchEvent: () => true });
  vi.stubGlobal('document', { title: '' });
});
afterEach(() => vi.unstubAllGlobals());
const snapshot = (path: string, text = 'body\r\n'): DocumentSnapshot => ({ path, name: path.split('/').at(-1)!,
  text, savedText: text, revision: 0, savedRevision: 0, diskVersion: { mtimeMs: 0, size: 0 }, isUntitled: false,
  encoding: 'utf8-bom', eol: 'crlf' });
const browserPage = (id: string, url: string): BrowserPage => ({ id, url, title: 'Web page',
  startPage: url === 'about:blank', loading: false, canGoBack: false, canGoForward: false,
  audible: false, muted: false, error: null, protection: 'ready' });
function fixture() {
  const workspace = new WorkspaceState();
  const session = createTabSession(() => workspace.active, anchor);
  const preview = { readyRevision: null as number | null,
    newSession() { this.readyRevision = null; calls.push('session'); },
    reset() { this.readyRevision = null; calls.push('reset'); },
    schedule() { calls.push('schedule'); }, ensure: async () => { calls.push('ensure'); return true; },
    position: async () => { calls.push('position'); return true; }, updateUi() {},
  };
  const options = {
    workspace, session, preview, shell: { dataset: {} },
    desktop: { updateText() {}, updateTabState() {}, activateDocument: async (doc: DocumentSnapshot) => doc,
      readDocumentLocation: async (path: string) => snapshot(path.startsWith('file:') ? fileURLToPath(path) : path),
      saveTabDocument: async (doc: DocumentSnapshot, text: string, revision: number) => ({ canceled: false,
        document: { ...doc, text, savedText: text, revision, savedRevision: revision } }),
      browser: { create: async (id: string, input: string, _history?: WebHistory) => browserPage(id, browserURL(input)),
        navigate: async () => {}, command: async (): Promise<boolean | void> => {}, close: async () => true,
        history: async (id: string) => {
          const tab = workspace.find(id);
          return { index: 0, entries: [{ url: tab?.kind === 'web' ? tab.page.url : 'about:blank', title: 'Web page' }] };
        } },
      closeEmptyWindow() {}, discardDocument: async () => {}, adoptTabTransfer: async () => true,
      completeTabTransfer() {} },
    editor: { loaded: true, text: (tab: { text: string }) => tab.text, load: async () => {}, activate() {}, selectGroup() {}, saveView() {},
      layout() {}, dispose() {}, clear() {}, reveal() {}, exportView: () => ({ cursor: 7 }), importView() {},
      retarget() { calls.push('retarget'); }, replace() { calls.push('replace'); },
      setText: (tab: { text: string }, text: string) => { tab.text = text; return false; }, lineCount: () => 2 },
    reader: { themeId: 'paper', create() { calls.push('create'); }, destroy() { calls.push('destroy'); },
      send() { calls.push('send'); }, syncView() {}, setSuspended(value: boolean) { calls.push(`suspended:${value}`); }, awaiting: false },
    surfaces: { set(surface: 'viewer' | 'editor') { session.surface = surface; }, publishAnchor() {} },
    confirmClose: async (): Promise<'save' | 'discard' | 'cancel'> => 'discard', shouldSchedulePreview: () => true, workspaceChanged() {},
  };
  const controller = new TabController(options as unknown as ConstructorParameters<typeof TabController>[0]);
  return { controller, workspace, session, preview, options };
}
const previewOpen = (controller: TabController, document: DocumentSnapshot) =>
  controller.show(document, 'viewer', 'document', undefined, { pinned: false });

test('Explorer browsing replaces its preview and releases the outgoing model and reader', async () => {
  const f = fixture();
  const dispose = vi.spyOn(f.options.editor, 'dispose');
  await f.controller.show(snapshot('/project/keep.txt'));
  const keep = f.workspace.activeDocument!;
  await previewOpen(f.controller, snapshot('/project/first.md'));
  const previous = f.workspace.activeDocument!;
  await f.controller.activate(keep.id);
  await previewOpen(f.controller, snapshot('/project/second.txt'));
  assert.deepEqual(f.workspace.documents.map(tab => tab.document.path), ['/project/keep.txt', '/project/second.txt']);
  assert.equal(dispose.mock.calls.length, 1);
  assert.deepEqual(dispose.mock.calls[0], [previous.id]);
  assert.equal(calls.filter(call => call === 'destroy').length, 1);
  assert.equal(f.workspace.groups.focused.previewId, f.workspace.activeId);
  assert.ok(f.workspace.find(keep.id));
});

test('editing pins previews permanently through save and Undo', async () => {
  const f = fixture();
  await previewOpen(f.controller, snapshot('/project/edit.txt'));
  const edited = f.workspace.activeDocument!;
  f.controller.editorChanged(edited, 'changed');
  await f.controller.acceptSaved(edited, { ...edited.document, text: 'changed', savedText: 'changed', revision: 1, savedRevision: 1 });
  assert.equal(f.controller.dirty(edited), false);
  await previewOpen(f.controller, snapshot('/project/undo.txt'));
  const undone = f.workspace.activeDocument!;
  f.controller.editorChanged(undone, 'changed');
  f.controller.editorChanged(undone, undone.document.savedText);
  assert.equal(f.controller.dirty(undone), false);
  await previewOpen(f.controller, snapshot('/project/next.txt'));
  assert.deepEqual(f.workspace.documents.map(tab => tab.document.name), ['edit.txt', 'undo.txt', 'next.txt']);
  assert.equal(f.workspace.groups.isPinned(edited.id), true);
  assert.equal(f.workspace.groups.isPinned(undone.id), true);
});

test('explicit open promotes an existing preview and subsequent browsing never demotes it', async () => {
  const f = fixture();
  const doc = snapshot('/project/promote.txt');
  await previewOpen(f.controller, doc);
  const promoted = f.workspace.activeDocument!;
  await f.controller.show(doc);
  await previewOpen(f.controller, doc);
  await previewOpen(f.controller, snapshot('/project/next.txt'));
  assert.equal(f.workspace.tabs.length, 2);
  assert.equal(f.workspace.find(promoted.id), promoted);
  assert.equal(f.workspace.groups.isPinned(promoted.id), true);
});

test('shared Working Tree edits and dirty buffers cannot be replaced', async () => {
  const f = fixture();
  await previewOpen(f.controller, snapshot('/project/shared.txt'));
  const shared = f.workspace.activeDocument!;
  f.controller.acceptWorkingTreeBuffer(shared.document.path, 'review edit');
  await previewOpen(f.controller, snapshot('/project/dirty.txt'));
  const dirty = f.workspace.activeDocument!;
  // Defend even when a borrowed model changed before its UI notification.
  dirty.text = 'unreported edit';
  const confirm = vi.spyOn(f.options, 'confirmClose');
  await previewOpen(f.controller, snapshot('/project/next.txt'));
  assert.equal(f.workspace.tabs.length, 3);
  assert.equal(shared.text, 'review edit');
  assert.equal(dirty.text, 'unreported edit');
  assert.equal(confirm.mock.calls.length, 0);
});

test('replacing the only preview does not collapse its split or activate a neighbor', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/left.txt'));
  const left = f.workspace.activeDocument!;
  await f.controller.show(snapshot('/project/right.txt'));
  const right = f.workspace.activeDocument!;
  f.workspace.groups.move(right.id, 'group-0', 'right');
  await f.controller.activate(right.id);
  await previewOpen(f.controller, snapshot('/project/first.txt'));
  await f.controller.close(right.id);
  const groupId = f.workspace.groups.focusedId;
  const tree = structuredClone(f.workspace.groups.tree);
  const activate = vi.spyOn(f.options.desktop, 'activateDocument');
  await previewOpen(f.controller, snapshot('/project/next.txt'));
  assert.equal(f.workspace.groups.groups.length, 2);
  assert.equal(f.workspace.groups.focusedId, groupId);
  assert.deepEqual(f.workspace.groups.tree, tree);
  assert.equal(f.workspace.groups.groups[0].activeId, left.id);
  assert.equal(activate.mock.calls.length, 1);
});

for (const extension of ['txt', 'cpp', 'json', 'custom']) test(`open/edit/transfer/close .${extension} never creates or schedules a preview`, async () => {
  const f = fixture();
  await f.controller.show(snapshot(`/project/file.${extension}`));
  const tab = f.workspace.activeDocument!;
  assert.equal(tab.surface, 'editor');
  f.controller.editorChanged(tab, 'changed\r\n');
  f.controller.acceptWorkingTreeBuffer(tab.document.path, 'working tree\r\n');
  const transfer = f.controller.transferable(tab);
  assert.notEqual(transfer.kind, 'web');
  if (transfer.kind === 'web') throw new Error('Expected a document transfer');
  assert.equal(transfer.document.encoding, 'utf8-bom');
  assert.equal(transfer.document.eol, 'crlf');
  assert.equal(transfer.previewUrl, null);
  await f.controller.close(tab.id, true);
  for (const operation of ['create', 'destroy', 'schedule', 'ensure', 'position', 'send']) {
    assert.ok(!calls.includes(operation), operation);
  }
});
test('warm Markdown → text → Markdown preserves page identity without another render', async () => {
  const f = fixture();
  const md = createWorkspaceTab('md', snapshot('/project/report.md'), 'viewer', anchor);
  Object.assign(md, { previewUrl: 'marktex-preview://document/keep', previewRevision: 0, previewTheme: 'paper' });
  f.workspace.add(md); f.workspace.activeId = md.id; f.preview.readyRevision = 0;
  await f.controller.show(snapshot('/project/main.cpp'));
  assert.equal(md.previewUrl, 'marktex-preview://document/keep');
  await f.controller.activate(md.id);
  assert.equal(md.previewUrl, 'marktex-preview://document/keep');
  assert.equal(md.surface, 'viewer');
  assert.ok(!calls.includes('ensure'));
  assert.ok(!calls.includes('destroy'));
});
test('Save As changes capabilities without replacing an unchanged model', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/notes.txt'));
  const tab = f.workspace.activeDocument!;
  calls.length = 0;
  await f.controller.acceptSaved(tab, { ...tab.document, path: '/project/notes.md', name: 'notes.md' });
  assert.equal(calls.filter(x => x === 'create').length, 1);
  assert.ok(calls.includes('schedule'));
  assert.ok(!calls.includes('replace'));
  calls.length = 0;
  await f.controller.acceptSaved(tab, { ...tab.document, path: '/project/notes.txt', name: 'notes.txt' });
  assert.equal(tab.surface, 'editor');
  assert.equal(calls.filter(x => x === 'destroy').length, 1);
  assert.ok(!calls.includes('schedule'));
  assert.ok(!calls.includes('replace'));
});
test('saving an older revision retains new input and a correct saved baseline', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/note.txt'));
  const tab = f.workspace.activeDocument!;
  tab.text = 'new\r\n'; tab.revision = 3;
  await f.controller.acceptSaved(tab, { ...tab.document, text: 'saved\r\n', savedText: 'saved\r\n', revision: 2, savedRevision: 2 });
  assert.equal(tab.text, 'new\r\n');
  assert.equal(tab.revision, 3);
  assert.equal(tab.document.savedText, 'saved\r\n');
  assert.equal(f.controller.dirty(tab), true);
});
test('text transfer cannot reintroduce an advertised Viewer or a stale preview URL', async () => {
  const f = fixture();
  const doc = snapshot('/project/main.cpp');
  await f.controller.installTransferred({ transferId: 'move', tab: { id: 'text', document: doc,
    text: doc.text, revision: 0, surface: 'viewer', anchor, editorViewState: {},
    viewerScrollRatio: .8, previewUrl: 'marktex-preview://document/stale', previewRevision: 0,
    previewTheme: 'paper', tocOpen: true } });
  assert.equal(f.workspace.activeDocument!.surface, 'editor');
  assert.equal(f.workspace.activeDocument!.previewUrl, null);
  assert.ok(!calls.includes('ensure'));
  assert.ok(!calls.includes('create'));
});
test('text Esc, scroll and explicit preview calls do no Markdown work', async () => {
  const f = fixture();
  const tab = createWorkspaceTab('text', snapshot('/project/note.txt'), 'viewer', anchor);
  f.workspace.add(tab); f.workspace.activeId = tab.id;
  const surfaces = new SurfaceController(f.options as unknown as ConstructorParameters<typeof SurfaceController>[0]);
  await surfaces.enterViewer(); surfaces.toggle(); surfaces.requestViewerAnchor(); surfaces.editorScrolled();
  const preview = new PreviewSession({ active: () => tab, activeId: () => tab.id, tabs: [tab],
    desktop: {}, text: () => tab.text, lineCount: () => 2, reader: {} } as unknown as ConstructorParameters<typeof PreviewSession>[0]);
  preview.schedule(0);
  assert.equal(await preview.ensure(0), false);
  assert.equal(await preview.position(anchor, 0), false);
  assert.deepEqual(calls, []);
});

test('first Working Tree activation binds the document without ordinary preview work', async () => {
  const f = fixture();
  const present = vi.spyOn(f.options.surfaces, 'set');
  const loadEditor = vi.spyOn(f.options.editor, 'load');
  await f.controller.show(snapshot('/project/review.md'), 'viewer', 'review');
  assert.equal(f.session.document?.path, '/project/review.md');
  assert.equal(f.workspace.activeDocument!.surface, 'viewer');
  assert.ok(calls.includes('suspended:true'));
  assert.equal(present.mock.calls.length, 0);
  assert.equal(loadEditor.mock.calls.length, 0);
  for (const operation of ['ensure', 'position', 'timer', 'send']) assert.ok(!calls.includes(operation), operation);
  f.controller.acceptWorkingTreeBuffer('/project/review.md', 'unsaved review edit');
  assert.equal(f.controller.currentText(), 'unsaved review edit');
  await f.controller.activate(f.workspace.activeId!);
  assert.ok(calls.includes('ensure'), 'ordinary reader prepares only when explicitly opened');
});

test('review activation preserves an existing document surface, position and unsaved text', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/review.md'), 'editor');
  const tab = f.workspace.activeDocument!;
  tab.text = 'unsaved';
  tab.anchor = { ...anchor, sourceLine: 2 };
  await f.controller.show(snapshot('/project/other.txt'));
  calls.length = 0;
  const present = vi.spyOn(f.options.surfaces, 'set');
  assert.equal(await f.controller.activateWorkingTreePath(tab.document.path), true);
  assert.equal(f.workspace.activeId, tab.id);
  assert.equal(tab.surface, 'editor');
  assert.equal(tab.anchor.sourceLine, 2);
  assert.equal(f.controller.currentText(), 'unsaved');
  assert.equal(present.mock.calls.length, 0);
  assert.ok(!calls.includes('ensure'));
  assert.ok(!calls.includes('position'));
});

test('returning from a first review to a saved editor surface loads the ordinary editor', async () => {
  const f = fixture();
  const load = vi.spyOn(f.options.editor, 'load');
  await f.controller.show(snapshot('/project/review.md'), 'editor', 'review');
  assert.equal(load.mock.calls.length, 0);
  await f.controller.activate(f.workspace.activeId!);
  assert.equal(load.mock.calls.length, 1);
  assert.equal(f.session.surface, 'editor');
});

test('address navigation replaces resources in the same tab and split without activating neighbors', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/left.txt'));
  const left = f.workspace.activeId!;
  await f.controller.show(snapshot('/project/right.md'));
  const id = f.workspace.activeId!;
  f.workspace.groups.move(id, 'group-0', 'right');
  await f.controller.activate(id);
  const tree = structuredClone(f.workspace.groups.tree);
  const order = f.workspace.tabs.map(tab => tab.id);
  assert.equal(await f.controller.navigateLocation(id, 'https://example.org'), true);
  assert.equal(f.workspace.find(id)!.kind, 'web');
  const nativeClose = vi.spyOn(f.options.desktop.browser, 'close').mockImplementation(async () => {
    f.controller.browserClosed(id); // Native destroyed arrives before close resolves.
    return true;
  });
  assert.equal(await f.controller.navigateLocation(id, '/outside/a.pdf'), true);
  f.controller.browserClosed(id); // A delayed old browser event must not remove a file.
  assert.deepEqual(f.workspace.tabs.map(tab => tab.id), order);
  assert.deepEqual(f.workspace.groups.tree, tree);
  assert.equal(f.workspace.groups.groups[0].activeId, left);
  assert.equal(f.workspace.activeDocument!.document.path, '/outside/a.pdf');
  assert.equal(f.workspace.activeDocument!.surface, 'pdf');
  assert.equal(nativeClose.mock.calls.length, 1);
  assert.equal(await f.controller.navigateLocation(id, '/outside/next.md'), true);
  assert.equal(f.workspace.activeDocument!.surface, 'viewer');
  assert.equal(f.workspace.activeDocument!.previewUrl, null);
});

test('invalid addresses, failed reads and canceled unsaved navigation retain the original document', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/edit.txt'));
  const tab = f.workspace.activeDocument!;
  f.controller.editorChanged(tab, 'unsaved');
  vi.spyOn(f.options, 'confirmClose').mockResolvedValue('cancel');
  assert.equal(await f.controller.navigateLocation(tab.id, 'https://example.org'), false);
  assert.equal(f.workspace.active, tab);
  assert.equal(tab.text, 'unsaved');
  vi.spyOn(f.options.desktop, 'readDocumentLocation').mockRejectedValue(Error('ENOENT'));
  await assert.rejects(f.controller.navigateLocation(tab.id, '/missing.md'), /ENOENT/);
  await assert.rejects(f.controller.navigateLocation(tab.id, 'javascript:alert(1)'));
  assert.equal(f.workspace.active, tab);
  assert.equal(f.controller.dirty(tab), true);
});

test('saving before address navigation preserves edits, while newer edits abort replacement', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/save.txt'));
  const tab = f.workspace.activeDocument!;
  f.controller.editorChanged(tab, 'save this');
  vi.spyOn(f.options, 'confirmClose').mockResolvedValue('save');
  const save = vi.spyOn(f.options.desktop, 'saveTabDocument');
  assert.equal(await f.controller.navigateLocation(tab.id, 'https://example.org'), true);
  assert.equal(save.mock.calls[0][1], 'save this');
  await f.controller.navigateLocation(tab.id, '/project/new.txt');
  const next = f.workspace.activeDocument!;
  f.controller.editorChanged(next, 'revision one');
  save.mockImplementation(async (doc, text, revision) => {
    f.controller.editorChanged(next, 'new input during save');
    return { canceled: false, document: { ...doc, text, savedText: text, revision, savedRevision: revision } };
  });
  assert.equal(await f.controller.navigateLocation(tab.id, 'https://example.org'), false);
  assert.equal(f.workspace.active, next);
  assert.equal(next.text, 'new input during save');
  assert.equal(f.controller.dirty(next), true);
});

test('rejected web beforeunload and failed native creation leave the current resource alive', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/start.txt'));
  const tab = f.workspace.active!;
  const create = vi.spyOn(f.options.desktop.browser, 'create').mockRejectedValueOnce(Error('create failed'));
  await assert.rejects(f.controller.navigateLocation(tab.id, 'https://example.org'), /create failed/);
  assert.equal(f.workspace.active, tab);
  create.mockImplementation(async (id, url) => browserPage(id, url));
  await f.controller.navigateLocation(tab.id, 'https://example.org');
  const web = f.workspace.active!;
  vi.spyOn(f.options.desktop.browser, 'close').mockResolvedValue(false);
  assert.equal(await f.controller.navigateLocation(tab.id, '/project/end.txt'), false);
  assert.equal(f.workspace.active, web);
});

test('superseded reads and reads for closed tabs cannot replace a later address', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/start.txt'));
  const id = f.workspace.activeId!;
  let complete!: (doc: DocumentSnapshot) => void;
  vi.spyOn(f.options.desktop, 'readDocumentLocation').mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const old = f.controller.navigateLocation(id, '/project/slow.md');
  const latest = f.controller.navigateLocation(id, 'https://example.org');
  complete(snapshot('/project/slow.md'));
  assert.equal(await old, false);
  assert.equal(await latest, true);
  const pending = f.controller.navigateLocation(id, '/project/end.txt');
  await f.controller.close(id, true);
  assert.equal(await pending, false);
  assert.equal(f.workspace.tabs.length, 0);
});

test('late document input and save completions cannot affect a replacement with the same tab ID', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/old.txt'));
  const outgoing = f.workspace.activeDocument!;
  await f.controller.navigateLocation(outgoing.id, 'https://example.org');
  const web = f.workspace.active!;
  const update = vi.spyOn(f.options.desktop, 'updateText');
  f.controller.editorChanged(outgoing, 'old delayed input');
  await f.controller.acceptSaved(outgoing, { ...outgoing.document, path: '/project/renamed.md' });
  assert.equal(f.workspace.active, web);
  assert.equal(outgoing.document.path, '/project/old.txt');
  assert.equal(update.mock.calls.length, 0);
});

test('an invalid newer address also cancels a slow older file read', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/start.txt'));
  const tab = f.workspace.active!;
  let complete!: (doc: DocumentSnapshot) => void;
  vi.spyOn(f.options.desktop, 'readDocumentLocation').mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const old = f.controller.navigateLocation(tab.id, '/project/slow.md');
  await assert.rejects(f.controller.navigateLocation(tab.id, 'javascript:alert(1)'));
  complete(snapshot('/project/slow.md'));
  assert.equal(await old, false);
  assert.equal(f.workspace.active, tab);
});

test('Explorer preview replacement retains its file history and Back keeps the preview slot', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/keep.txt'));
  await previewOpen(f.controller, snapshot('/project/first.txt'));
  await previewOpen(f.controller, snapshot('/project/second.txt'));
  await previewOpen(f.controller, snapshot('/project/third.txt'));
  const id = f.workspace.activeId!;
  assert.equal(f.controller.canGoBack(id), true);
  const first = f.controller.navigateHistory(id, -1);
  const second = f.controller.navigateHistory(id, -1);
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(f.workspace.activeDocument!.document.path, '/project/first.txt');
  assert.equal(f.workspace.activeId, id);
  assert.equal(f.workspace.tabs.length, 2);
  assert.equal(f.workspace.groups.focused.previewId, id);
  assert.equal(f.controller.canGoForward(id), true);
  await f.controller.navigateHistory(id, 1);
  assert.equal(f.workspace.activeDocument!.document.path, '/project/second.txt');
  await previewOpen(f.controller, snapshot('/project/branch.txt'));
  assert.equal(f.controller.canGoForward(f.workspace.activeId!), false);
  await f.controller.navigateHistory(f.workspace.activeId!, -1);
  assert.equal(f.workspace.activeDocument!.document.path, '/project/second.txt');
});

test('file and web history round-trips restore native history and preserve file reading positions', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/start.txt'));
  const id = f.workspace.activeId!;
  f.workspace.activeDocument!.readingPosition = { kind: 'text', surface: 'editor', anchor: { ...anchor, sourceLine: 2 } };
  await f.controller.navigateLocation(id, 'https://example.org/first');
  const native = { index: 1, entries: [{ url: 'https://example.org/first', title: 'First', pageState: 'state' },
    { url: 'https://example.org/second', title: 'Second' }] };
  vi.spyOn(f.options.desktop.browser, 'history').mockResolvedValue(native);
  await f.controller.navigateLocation(id, '/project/read.pdf');
  assert.equal(f.controller.canGoBack(id), true);
  const create = vi.spyOn(f.options.desktop.browser, 'create');
  await f.controller.navigateHistory(id, -1);
  assert.deepEqual(create.mock.calls.find(call => call[2]), [id, 'https://example.org/second', native]);
  const command = vi.spyOn(f.options.desktop.browser, 'command').mockResolvedValueOnce(true);
  const index = f.workspace.active!.navigation!.index;
  await f.controller.navigateHistory(id, -1); // Native web traversal does not move the resource cursor.
  assert.equal(f.workspace.active!.navigation!.index, index);
  command.mockResolvedValue(undefined);
  await f.controller.navigateHistory(id, -1);
  assert.equal(f.workspace.activeDocument!.document.path, '/project/start.txt');
  assert.equal(f.workspace.activeDocument!.anchor.sourceLine, 2);
  await f.controller.navigateHistory(id, 1);
  assert.equal(f.workspace.active!.kind, 'web');
  assert.equal(f.controller.canGoForward(id), true);
  await f.controller.navigateHistory(id, 1);
  assert.equal(f.workspace.activeDocument!.document.path, '/project/read.pdf');
});

test('failed and canceled Back preserve the current file and the history cursor', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/start.txt'));
  const id = f.workspace.activeId!;
  await f.controller.navigateLocation(id, '/project/edit.txt');
  const current = f.workspace.activeDocument!;
  const read = vi.spyOn(f.options.desktop, 'readDocumentLocation').mockRejectedValueOnce(Error('ENOENT'));
  await assert.rejects(f.controller.navigateHistory(id, -1), /ENOENT/);
  assert.equal(f.workspace.active, current);
  assert.equal(current.navigation!.index, 1);
  read.mockImplementation(async path => snapshot(fileURLToPath(path)));
  f.controller.editorChanged(current, 'unsaved');
  vi.spyOn(f.options, 'confirmClose').mockResolvedValue('cancel');
  assert.equal(await f.controller.navigateHistory(id, -1), false);
  assert.equal(f.workspace.active, current);
  assert.equal(current.navigation!.index, 1);
  assert.equal(current.text, 'unsaved');
});

test('a new native web navigation truncates future file entries, and window transfer retains the resource journal', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/start.txt'));
  const id = f.workspace.activeId!;
  await f.controller.navigateLocation(id, 'https://example.org');
  await f.controller.navigateLocation(id, '/project/end.txt');
  await f.controller.navigateHistory(id, -1);
  assert.equal(f.controller.canGoForward(id), true);
  f.controller.webNavigated(id);
  assert.equal(f.controller.canGoForward(id), false);
  const transfer = structuredClone(f.controller.transferable(f.workspace.active!));
  const destination = fixture();
  await destination.controller.installTransferred({ transferId: 'history-transfer', tab: transfer });
  assert.equal(destination.controller.canGoBack(id), true);
  await destination.controller.navigateHistory(id, -1);
  assert.equal(destination.workspace.activeDocument!.document.path, '/project/start.txt');
});

test('new web tabs start on Google and focus their address', async () => {
  const f = fixture();
  const dispatch = vi.spyOn(window, 'dispatchEvent');
  await f.controller.openWeb();
  const active = f.workspace.active!;
  assert.equal(active.kind, 'web');
  if (active.kind === 'web') assert.equal(active.page.url, 'https://www.google.com/');
  assert.equal(dispatch.mock.calls.at(-1)![0].type, 'setdown:focus-location');
});
