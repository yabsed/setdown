import assert from 'node:assert/strict';
import { beforeEach, afterEach, test, vi } from 'vitest';
import { createWorkspaceTab, createTabSession, WorkspaceState } from '../../core/workspace/workspace-state';
import type { DocumentSnapshot } from '../../core/document/document';
import { TabController } from './tab-controller';
import { SurfaceController } from '../application/surface-controller';
import { PreviewSession } from '../reader/preview-session';

vi.mock('../view-state.svelte', () => ({ view: {} }));
vi.mock('../shell/layout-session', () => ({ restoredOutlineOpen: () => false }));
const anchor = { sourceLine: 1, yRatio: .372, reason: 'empty-document', confidence: 'fallback' } as const;
const calls: string[] = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('window', { setTimeout: () => { calls.push('timer'); return 1; }, clearTimeout() {} });
  vi.stubGlobal('document', { title: '' });
});
afterEach(() => vi.unstubAllGlobals());
const snapshot = (path: string, text = 'body\r\n'): DocumentSnapshot => ({ path, name: path.split('/').at(-1)!,
  text, savedText: text, revision: 0, savedRevision: 0, diskVersion: { mtimeMs: 0, size: 0 }, isUntitled: false,
  encoding: 'utf8-bom', eol: 'crlf' });
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
      closeEmptyWindow() {}, discardDocument: async () => {}, adoptTabTransfer: async () => true,
      completeTabTransfer() {} },
    editor: { loaded: true, text: (tab: { text: string }) => tab.text, load: async () => {}, activate() {}, selectGroup() {}, saveView() {},
      layout() {}, dispose() {}, clear() {}, exportView: () => ({ cursor: 7 }), importView() {},
      retarget() { calls.push('retarget'); }, replace() { calls.push('replace'); },
      setText: (tab: { text: string }, text: string) => { tab.text = text; return false; }, lineCount: () => 2 },
    reader: { themeId: 'paper', create() { calls.push('create'); }, destroy() { calls.push('destroy'); },
      send() { calls.push('send'); }, syncView() {}, setSuspended(value: boolean) { calls.push(`suspended:${value}`); }, awaiting: false },
    surfaces: { set(surface: 'viewer' | 'editor') { session.surface = surface; }, publishAnchor() {} },
    confirmClose: async () => 'discard', shouldSchedulePreview: () => true, workspaceChanged() {},
  };
  const controller = new TabController(options as unknown as ConstructorParameters<typeof TabController>[0]);
  return { controller, workspace, session, preview, options };
}
for (const extension of ['txt', 'cpp', 'json', 'custom']) test(`open/edit/transfer/close .${extension} never creates or schedules a preview`, async () => {
  const f = fixture();
  await f.controller.show(snapshot(`/project/file.${extension}`));
  const tab = f.workspace.active!;
  assert.equal(tab.surface, 'editor');
  f.controller.editorChanged(tab, 'changed\r\n');
  f.controller.acceptWorkingTreeBuffer(tab.document.path, 'working tree\r\n');
  const transfer = f.controller.transferable(tab);
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
  const tab = f.workspace.active!;
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
  const tab = f.workspace.active!;
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
  assert.equal(f.workspace.active!.surface, 'editor');
  assert.equal(f.workspace.active!.previewUrl, null);
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
  assert.equal(f.workspace.active!.surface, 'viewer');
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
  const tab = f.workspace.active!;
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
