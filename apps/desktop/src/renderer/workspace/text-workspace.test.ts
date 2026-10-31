import { DocumentSessions } from './document-sessions';
import assert from 'node:assert/strict';
import { beforeEach, afterEach, test, vi } from 'vitest';
import { createWorkspaceTab, createTabSession, WorkspaceState } from '../../core/workspace/workspace-state';
import type { DocumentSnapshot } from '../../core/document/document';
import { TabController } from './tab-controller';
import { SurfaceController } from './surface-controller';
import { PreviewSession } from '../reader/preview-session';
import { view } from './workspace-view.svelte';
import { browserURL } from '../../core/browser/browser-url';
import type { BrowserPage } from '../../core/browser/browser-state';
import { fileURLToPath } from 'node:url';
import type { WebHistory } from '../../core/workspace/tab-navigation';

vi.mock('./workspace-view.svelte', () => ({ view: { documentNotices: {} } }));
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
  audible: false, muted: false, zoomPercent: 100, error: null, protection: 'ready' });
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
    desktop: { initializeTabZoom: async () => undefined, terminal: { close: (id: string) => calls.push(`terminal-close:${id}`) }, updateText() {}, updateTabState() {}, activateDocument: async (doc: DocumentSnapshot) => doc,
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
    editor: { beforeSave: async () => {}, loaded: true, hasLiveView: () => false, text: (tab: { text: string }) => tab.text, load: async () => {}, activate() {}, selectGroup() {}, saveView() {},
      layout() {}, dispose() {}, clear() {}, reveal() {}, exportView: () => ({ cursor: 7 }), importView() {},
      restoreView() {},
      retarget() { calls.push('retarget'); }, replace() { calls.push('replace'); },
      setText: (tab: { text: string }, text: string) => { tab.text = text; return false; }, lineCount: () => 2 },
    reader: { themeId: 'paper', create() { calls.push('create'); }, destroy() { calls.push('destroy'); },
      send() { calls.push('send'); }, syncView() {}, setSuspended(value: boolean) { calls.push(`suspended:${value}`); }, awaiting: false },
    surfaces: { set(surface: 'viewer' | 'editor') { session.surface = surface; }, publishAnchor() {} },
    confirmClose: async (): Promise<'save' | 'discard' | 'cancel'> => 'discard', shouldSchedulePreview: () => true, workspaceChanged() {},
  };
  const controller = new TabController(Object.assign(options, { documents: new DocumentSessions(options.editor, [], Object.assign(options.desktop, { saveDocumentAs: async () => ({ canceled: true }) })) }) as unknown as ConstructorParameters<typeof TabController>[0]);
  return { controller, workspace, session, preview, options };
}
const previewOpen = (controller: TabController, document: DocumentSnapshot) =>
  controller.show(document, 'viewer', 'document', undefined, { pinned: false });

test('moving a dirty file refreshes its disk version without replacing its draft or model', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/first.txt'));
  const tab = f.workspace.documents[0], identity = tab.documentId;
  tab.text = 'UNSAVED'; tab.revision++;
  const moved = { ...snapshot('/project/destination/first.txt'), diskVersion: { mtimeMs: 0, size: 0, ctimeMs: 42 } };
  f.options.desktop.readDocumentLocation = async () => moved;
  const replace = vi.spyOn(f.options.editor, 'replace');
  await f.controller.relocatePath('/project/first.txt', moved.path);
  assert.equal(tab.document.path, moved.path);
  assert.deepEqual(tab.document.diskVersion, moved.diskVersion);
  assert.equal(tab.text, 'UNSAVED'); assert.equal(tab.revision, 1);
  assert.equal(tab.document.savedText, 'body\r\n');
  assert.equal(tab.documentId, identity); assert.equal(replace.mock.calls.length, 0);
});

test.each(['text', 'encoding', 'unreadable'])('moving a file retains overwrite protection when the disk is %s', async change => {
  const f = fixture();
  await f.controller.show(snapshot('/project/first.txt'));
  const tab = f.workspace.documents[0], previous = tab.document.diskVersion;
  tab.text = 'UNSAVED';
  const moved = { ...snapshot('/project/destination/first.txt'), diskVersion: { mtimeMs: 0, size: 0, ctimeMs: 42 } };
  if (change === 'text') moved.savedText = 'EXTERNAL CHANGE';
  if (change === 'encoding') moved.encoding = 'utf8';
  f.options.desktop.readDocumentLocation = async () => {
    if (change === 'unreadable') throw Error('File is unavailable');
    return moved;
  };
  await f.controller.relocatePath('/project/first.txt', moved.path);
  assert.equal(tab.document.path, moved.path);
  assert.deepEqual(tab.document.diskVersion, previous);
  assert.equal(tab.text, 'UNSAVED');
});

test('late web activation retains a newer shell edit while still selecting the browser tab', async () => {
  const f = fixture();
  const page = browserPage('web', 'https://example.com/');
  f.workspace.add({ kind: 'web', id: page.id, surface: 'web', page });
  let resolve!: (page: BrowserPage) => void;
  f.options.desktop.browser.create = () => new Promise(done => { resolve = done; });
  let editing = false;
  Object.assign(f.options, { shouldFocusWeb: () => !editing });
  const command = vi.spyOn(f.options.desktop.browser, 'command');
  const activation = f.controller.activate(page.id);
  editing = true;
  resolve(page);
  await activation;
  assert.equal(f.workspace.activeId, page.id);
  assert.deepEqual(command.mock.calls, [[page.id, 'activate']]);
  editing = false;
  f.options.desktop.browser.create = async () => page;
  await f.controller.activate(page.id);
  assert.deepEqual(command.mock.calls.at(-1), [page.id, 'focus']);
});

test('preparing deletion preserves dirty models until the filesystem commits', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/keep.txt'));
  const tab = f.workspace.documents[0]; tab.text = 'UNSAVED';
  const dispose = vi.spyOn(f.options.editor, 'dispose');
  assert.equal(await f.controller.prepareRemove('/project/keep.txt'), true);
  assert.equal(f.workspace.documents[0], tab);
  assert.equal(tab.text, 'UNSAVED'); assert.equal(dispose.mock.calls.length, 0);
  // A failed trash operation simply never calls commitRemove.
  await f.controller.commitRemove('/project/keep.txt');
  assert.equal(f.workspace.documents.length, 0); assert.equal(dispose.mock.calls.length, 1);
});

test('new edits during an OS trash job are not covered by the earlier discard decision', async () => {
  const f = fixture(); await f.controller.show(snapshot('/project/keep.txt'));
  const tab = f.workspace.documents[0];
  assert.equal(await f.controller.prepareRemove('/project/keep.txt'), true);
  tab.text = 'NEW EDIT'; tab.revision++;
  await f.controller.commitRemove('/project/keep.txt');
  assert.equal(f.workspace.documents[0], tab); assert.equal(tab.text, 'NEW EDIT');
});

test.each([true, false])('text activation restores saved positions only without a live group view (live: %s)', async live => {
  const f = fixture();
  await f.controller.show(snapshot('/project/first.cpp'));
  const second = createWorkspaceTab('second', snapshot('/project/second.cpp'), 'editor', anchor);
  second.readingPosition = { kind: 'text', surface: 'editor', anchor, editorView: { cursor: 7 } };
  f.workspace.add(second);
  const restore = vi.spyOn(f.options.editor, 'restoreView');
  vi.spyOn(f.options.editor, 'hasLiveView').mockReturnValue(live);
  await f.controller.activate(second.id);
  assert.equal(restore.mock.calls.length, live ? 0 : 1);
  assert.equal(second.restoringPosition, false);
});

test('focusing a live text group never reveals its older anchor when no saved editor view exists', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/first.cpp'));
  const second = createWorkspaceTab('second', snapshot('/project/second.cpp'), 'editor', anchor);
  second.readingPosition = { kind: 'text', surface: 'editor', anchor };
  f.workspace.add(second);
  const reveal = vi.spyOn(f.options.editor, 'reveal');
  vi.spyOn(f.options.editor, 'hasLiveView').mockReturnValue(true);
  await f.controller.activate(second.id);
  assert.equal(reveal.mock.calls.length, 0);
});

test('saved text viewport is restored before document activation IPC can expose an intermediate frame', async () => {
  const f = fixture();
  const tab = createWorkspaceTab('first', snapshot('/project/first.cpp'), 'editor', anchor);
  tab.readingPosition = { kind: 'text', surface: 'editor', anchor, editorView: { cursor: 7 } };
  f.workspace.add(tab);
  const restore = vi.spyOn(f.options.editor, 'restoreView');
  let complete!: (document: DocumentSnapshot) => void;
  const activate = vi.spyOn(f.options.desktop, 'activateDocument').mockImplementation(() =>
    new Promise<DocumentSnapshot>(resolve => { complete = resolve; }));
  const pending = f.controller.activate(tab.id);
  await vi.waitFor(() => assert.equal(activate.mock.calls.length, 1));
  assert.equal(restore.mock.calls.length, 1);
  assert.equal(tab.restoringPosition, true);
  complete(tab.document);
  await pending;
  assert.equal(tab.restoringPosition, false);
});

test('a retained source review switches before its document activation IPC completes', async () => {
  const f = fixture();
  const document = createWorkspaceTab('file', snapshot('/project/review.md'), 'editor', anchor);
  f.workspace.add(document);
  f.workspace.add({ kind: 'diff', surface: 'diff', id: 'index', filePath: document.document.path, staged: true });
  f.workspace.add({ kind: 'diff', surface: 'diff', id: 'working', filePath: document.document.path, staged: false, documentId: document.documentId });
  f.workspace.activeId = 'index';
  const activateReview = vi.fn(async () => {});
  Object.assign(f.options, { activateReview });
  let complete!: (document: DocumentSnapshot) => void;
  const activate = vi.spyOn(f.options.desktop, 'activateDocument').mockImplementation(() =>
    new Promise<DocumentSnapshot>(resolve => { complete = resolve; }));
  const pending = f.controller.activate('working');
  await vi.waitFor(() => assert.equal(activate.mock.calls.length, 1));
  assert.equal(activateReview.mock.calls.length, 1);
  assert.equal(view.tabs.find(tab => tab.id === 'working')?.active, true);
  complete(document.document);
  await pending;
});

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
  assert.equal(f.workspace.activeId, previous.id);
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
  if (transfer.kind === 'web' || transfer.kind === 'terminal') throw new Error('Expected a document transfer');
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
test('a first save relocates assets in both the latest buffer and its live model', async () => {
  const f = fixture();
  const old = '![x](Untitled.assets/a.png)', saved = '![x](saved.assets/a.png)';
  await f.controller.show({ ...snapshot('/draft/Untitled.md', old), isUntitled: true });
  const tab = f.workspace.activeDocument!;
  tab.text = old + '\nnew typing'; tab.revision = 3;
  const replace = vi.spyOn(f.options.editor, 'replace');
  await f.controller.acceptSaved(tab, { ...tab.document, path: '/project/saved.md', isUntitled: false,
    text: saved, savedText: saved, revision: 2, savedRevision: 2,
    assetRelocation: { sourceDirectoryName: 'Untitled.assets', destinationDirectoryName: 'saved.assets' } });
  assert.equal(tab.text, saved + '\nnew typing');
  assert.equal(tab.revision, 3);
  assert.equal(tab.document.savedText, saved);
  assert.equal(tab.document.assetRelocation, undefined);
  assert.equal(replace.mock.calls.length, 1);
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

test('Explorer replacement cancels an older address read even though the tab ID is reused', async () => {
  const f = fixture();
  await previewOpen(f.controller, snapshot('/project/first.txt'));
  const id = f.workspace.activeId!;
  let complete!: (doc: DocumentSnapshot) => void;
  vi.spyOn(f.options.desktop, 'readDocumentLocation').mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const pending = f.controller.navigateLocation(id, '/project/slow.txt');
  await previewOpen(f.controller, snapshot('/project/second.txt'));
  complete(snapshot('/project/slow.txt'));
  assert.equal(await pending, false);
  assert.equal(f.workspace.activeId, id);
  assert.equal(f.workspace.activeDocument!.document.path, '/project/second.txt');
  assert.equal(f.workspace.tabs.length, 1);
});

test('Explorer preview replacement retains its file history and Back keeps the preview slot', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/keep.txt'));
  await previewOpen(f.controller, snapshot('/project/first.txt'));
  const id = f.workspace.activeId!;
  await previewOpen(f.controller, snapshot('/project/second.txt'));
  assert.equal(f.workspace.activeId, id);
  await previewOpen(f.controller, snapshot('/project/third.txt'));
  assert.equal(f.workspace.activeId, id);
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

test('new web tabs start on Google without requesting address focus', async () => {
  const f = fixture();
  const dispatch = vi.spyOn(window, 'dispatchEvent');
  await f.controller.openWeb();
  const active = f.workspace.active!;
  assert.equal(active.kind, 'web');
  if (active.kind === 'web') assert.equal(active.page.url, 'https://www.google.com/');
  assert.equal(dispatch.mock.calls.some(([event]) => event.type === 'setdown:focus-location'), false);
});


test('terminal activation, splitting and transfers stay outside document resources', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/keep.txt'));
  const documentId = f.workspace.activeId!;
  calls.length = 0;
  await f.controller.openTerminal();
  const terminal = f.workspace.active!;
  assert.equal(terminal.kind, 'terminal');
  assert.equal(f.session.document, null);
  assert.equal(f.session.surface, 'terminal');
  assert.equal(f.controller.dirty(terminal), false);
  assert.equal(f.workspace.documents.length, 1);
  assert.equal(calls.includes('ensure'), false);
  assert.equal(calls.includes('create'), false);
  const transfer = f.controller.transferable(terminal);
  assert.equal(transfer.kind, 'terminal');
  f.workspace.groups.move(terminal.id, f.workspace.groups.owner(documentId)!.id, 'right');
  await f.controller.activate(documentId);
  await f.controller.activate(terminal.id);
  assert.equal(f.workspace.groups.groups.length, 2);
  await f.controller.removeTransferred(terminal.id);
  assert.equal(calls.some(call => call.startsWith('terminal-close:')), false);
  assert.equal(f.workspace.activeId, documentId);
  await f.controller.installTransferred({ transferId: 'move', tab: transfer });
  assert.equal(f.workspace.active?.kind, 'terminal');
  await f.controller.close(terminal.id);
  assert.equal(calls.filter(call => call === `terminal-close:${terminal.id}`).length, 0);
  await f.controller.closeTerminalSession(terminal.id);
  assert.equal(calls.filter(call => call === `terminal-close:${terminal.id}`).length, 1);
  assert.equal(f.workspace.activeId, documentId);
});

test('terminal creation targets the requested group while another editor activation is pending', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/first.txt'));
  const first = f.workspace.activeId!;
  const source = f.workspace.groups.owner(first)!;
  await f.controller.show(snapshot('/project/second.txt'));
  const second = f.workspace.activeId!;
  const target = f.workspace.groups.split(source.id, 'right');
  f.workspace.groups.move(second, target.id, null);
  await f.controller.activate(first);

  let finish!: () => void;
  f.options.editor.load = () => new Promise<void>(resolve => { finish = resolve; });
  const activation = f.controller.activate(second);
  assert.equal(f.workspace.groups.focusedId, source.id);
  await f.controller.openTerminal('', target.id);
  const terminal = f.workspace.active!;
  finish(); await activation;

  assert.equal(terminal.kind, 'terminal');
  assert.equal(f.workspace.activeId, terminal.id);
  assert.equal(f.workspace.groups.focusedId, target.id);
  assert.deepEqual(source.tabs, [first]);
  assert.equal(source.activeId, first);
  assert.deepEqual(target.tabs, [second, terminal.id]);
  assert.equal(target.activeId, terminal.id);

  // Sidebar creation, which has no explicit group, still uses the focused group.
  await f.controller.openTerminal();
  assert.deepEqual(source.tabs, [first]);
  assert.deepEqual(target.tabs, [second, terminal.id, f.workspace.activeId]);
});

test('external background refresh does not overwrite edits made while disk IO is pending', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/keep.txt'));
  const tab = f.workspace.activeDocument!;
  await f.controller.openTerminal();
  let finish!: (value: DocumentSnapshot) => void;
  f.options.desktop.readDocumentLocation = () => new Promise(resolve => { finish = resolve; });
  const refresh = f.controller.reloadDocumentPaths([tab.document.path], true);
  tab.text = 'typed while reading'; tab.revision++;
  finish(snapshot(tab.document.path, 'disk text'));
  await refresh;
  assert.equal(tab.text, 'typed while reading');
  assert.equal(f.workspace.active?.kind, 'terminal');
});

test('the newest reload wins even when an older disk read completes last', async () => {
  const f = fixture(); await f.controller.show(snapshot('/project/reload.txt'));
  const tab = f.workspace.activeDocument!, pending: Array<(value: DocumentSnapshot) => void> = [];
  f.options.desktop.readDocumentLocation = () => new Promise(resolve => pending.push(resolve));
  const older = f.controller.reloadDocumentPaths([tab.document.path]);
  const newer = f.controller.reloadDocumentPaths([tab.document.path]);
  pending[1](snapshot(tab.document.path, 'newest')); await newer;
  pending[0](snapshot(tab.document.path, 'stale')); await older;
  assert.equal(tab.document.savedText, 'newest');
});

test('a missing file retains its open content and notice until a later successful reload', async () => {
  const f = fixture(); await f.controller.show(snapshot('/project/missing.txt', 'preserved'));
  const tab = f.workspace.activeDocument!;
  f.options.desktop.readDocumentLocation = async () => { throw Error('ENOENT: no such file'); };
  await f.controller.reloadDocumentPaths([tab.document.path]);
  assert.equal(f.workspace.activeDocument, tab); assert.equal(tab.text, 'preserved');
  assert.equal(view.documentNotices[tab.document.path].unavailable, true);
  f.options.desktop.readDocumentLocation = async () => snapshot(tab.document.path, 'restored');
  await f.controller.reloadDocumentPaths([tab.document.path]);
  assert.equal(tab.document.savedText, 'restored'); assert.equal(view.documentNotices[tab.document.path], undefined);
});

test('a late external change notice is retained when accepting an earlier successful save', async () => {
  const f = fixture(); await f.controller.show(snapshot('/project/save.txt'));
  const tab = f.workspace.activeDocument!;
  view.documentNotices[tab.document.path] = { message: 'External replacement', diskVersion: { size: 8, mtimeMs: 2 } };
  await f.controller.acceptSaved(tab, { ...snapshot(tab.document.path, 'saved'), diskVersion: { size: 5, mtimeMs: 1 } });
  assert.equal(view.documentNotices[tab.document.path].message, 'External replacement');
  await f.controller.acceptSaved(tab, { ...snapshot(tab.document.path, 'external'), diskVersion: { size: 8, mtimeMs: 2 } });
  assert.equal(view.documentNotices[tab.document.path], undefined);
});

test('terminal addresses retain their session through file/web history and reject missing sessions', async () => {
  const f = fixture();
  await f.controller.openTerminal();
  const id = f.workspace.activeId!;
  assert.equal(f.workspace.terminals.get(id)?.title, 'Terminal 1');
  await f.controller.navigateLocation(id, 'https://example.com/first');
  assert.equal(f.workspace.active?.kind, 'web');
  await f.controller.navigateLocation(id, 'file:///project/file.txt');
  assert.equal(f.workspace.activeDocument?.document.path, '/project/file.txt');
  await f.controller.navigateHistory(id, -1);
  assert.equal(f.workspace.active?.kind, 'web');
  await f.controller.navigateHistory(id, -1);
  assert.equal(f.workspace.active?.kind, 'terminal');
  assert.equal(f.workspace.activeId, id);
  assert.equal(f.workspace.terminals.size, 1);
  assert.equal(calls.some(call => call.startsWith('terminal-close:')), false);
  const current = f.workspace.active;
  for (const url of ['terminal://missing', `terminal://${id}/wrong`, `terminal://${id}?bad=1`]) {
    await assert.rejects(f.controller.navigateLocation(id, url), /no longer available/);
    assert.equal(f.workspace.active, current);
  }
  await f.controller.openTerminal();
  const second = f.workspace.activeId!;
  assert.equal(f.workspace.terminals.get(second)?.title, 'Terminal 2');
  await f.controller.navigateLocation(second, `terminal://${id}`);
  assert.equal(f.workspace.activeId, id);
  assert.equal(f.workspace.tabs.filter(tab => tab.kind === 'terminal').length, 2);
  assert.equal(f.workspace.find(second)?.kind, 'terminal');
});

test('a canceled dirty file navigation cannot replace it with a terminal session', async () => {
  const f = fixture();
  await f.controller.openTerminal();
  const session = f.workspace.activeId!;
  await f.controller.navigateLocation(session, '/project/edited.txt');
  const tab = f.workspace.activeDocument!;
  tab.text = 'unsaved'; tab.revision++;
  f.options.confirmClose = async () => 'cancel';
  assert.equal(await f.controller.navigateLocation(tab.id, `terminal://${session}`), false);
  assert.equal(f.workspace.active, tab);
  assert.equal(tab.text, 'unsaved');
  assert.equal(f.workspace.terminals.has(session), true);
});

test('opening to the side retains the source and shares its dirty buffer', async () => {
  const f = fixture();
  await f.controller.show(snapshot('/project/shared.txt'));
  const first = f.workspace.activeDocument!;
  f.controller.editorChanged(first, 'UNSAVED');
  await f.controller.show(snapshot('/project/shared.txt'), 'editor', 'document', undefined, { side: true });
  const second = f.workspace.activeDocument!;
  assert.notEqual(second.id, first.id); assert.equal(second.documentId, first.documentId);
  assert.equal(second.text, 'UNSAVED'); assert.equal(f.workspace.contents.length, 1);
  assert.equal(f.workspace.groups.groups.length, 2);
  assert.equal(f.workspace.groups.owner(first.id)?.activeId, first.id);
  const confirm = vi.spyOn(f.options, 'confirmClose');
  assert.equal(await f.controller.close(first.id), true); assert.equal(confirm.mock.calls.length, 0);
  assert.equal(f.workspace.contents.length, 1); assert.equal(second.text, 'UNSAVED');
  assert.equal(await f.controller.close(second.id), true); assert.equal(confirm.mock.calls.length, 1);
  assert.equal(f.workspace.contents.length, 0);
});

test('copies a sole view into a split and reuses an existing target view', async () => {
  const f = fixture(); await f.controller.show(snapshot('/project/a.txt'));
  const original = f.workspace.activeDocument!;
  const originalGroup = f.workspace.groups.focusedId;
  await f.controller.copyToGroup(original.id, originalGroup, 'right');
  const copy = f.workspace.activeDocument!;
  assert.notEqual(copy.id, original.id); assert.equal(f.workspace.groups.groups.length, 2);
  const group = f.workspace.groups.focusedId;
  await f.controller.copyToGroup(original.id, group);
  assert.equal(f.workspace.activeId, copy.id); assert.equal(f.workspace.documents.length, 2);
  assert.equal(f.workspace.contents.length, 1);
});

test('replacing one view with a URL preserves another view of its dirty document', async () => {
  const f = fixture(); await f.controller.show(snapshot('/project/a.txt'));
  const first = f.workspace.activeDocument!;
  await f.controller.copyToGroup(first.id, f.workspace.groups.focusedId, 'right');
  f.controller.editorChanged(first, 'dirty');
  const confirm = vi.spyOn(f.options, 'confirmClose');
  await f.controller.navigateLocation(first.id, 'https://example.com');
  assert.equal(confirm.mock.calls.length, 0);
  assert.equal(f.workspace.contents[0].text, 'dirty');
  assert.equal(f.workspace.documentStore.documents[0].references.size, 1);
});

test('navigating one untitled view preserves its draft until the last view leaves', async () => {
  const f = fixture(); await f.controller.show({ ...snapshot('/project/draft.md'), isUntitled: true });
  const first = f.workspace.activeDocument!;
  await f.controller.copyToGroup(first.id, f.workspace.groups.focusedId, 'right');
  const second = f.workspace.activeDocument!, discard = vi.spyOn(f.options.desktop, 'discardDocument');
  f.controller.editorChanged(first, 'unsaved draft');
  await f.controller.navigateLocation(first.id, 'https://example.com');
  assert.equal(discard.mock.calls.length, 0); assert.equal(second.text, 'unsaved draft');
  await f.controller.navigateLocation(second.id, 'https://example.com/next');
  assert.equal(discard.mock.calls.length, 1); assert.equal(f.workspace.contents.length, 0);
});

test('Save As retargets all ordinary references without changing shared content identity', async () => {
  const f = fixture(); await f.controller.show(snapshot('/project/before.txt'));
  const first = f.workspace.activeDocument!;
  await f.controller.copyToGroup(first.id, f.workspace.groups.focusedId, 'right');
  const second = f.workspace.activeDocument!, identity = first.documentId;
  f.controller.editorChanged(second, 'new text');
  await f.controller.acceptSaved(second, { ...snapshot('/project/after.txt', 'new text'), revision: second.revision, savedRevision: second.revision });
  assert.equal(first.documentId, identity); assert.equal(second.documentId, identity);
  assert.equal(first.document.path, '/project/after.txt'); assert.equal(second.document.path, '/project/after.txt');
  assert.equal(f.controller.dirty(first), false); assert.equal(f.controller.dirty(second), false);
  assert.equal(f.workspace.contents.length, 1);
});
