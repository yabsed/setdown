import { imageSessions } from '../image/image-edit-sessions';
import type { DesktopPort } from '../ports/desktop-port';
import { isDocumentTab, type WorkspaceState } from '../../core/workspace/workspace-state';
import { documentIdentity } from '../../core/workspace/document-store';
import { contentHash, parseWorkspaceSnapshot, type WorkspaceSnapshot, type SnapshotContent, type SnapshotView } from '../../core/workspace/workspace-snapshot';
import type { GroupTree } from '../../core/workspace/editor-groups';
import type { TabController } from '../workspace/tab-controller';
import type { MonacoEditor } from '../adapters/monaco-editor';
import type { ProjectController } from '../project/project-controller';
import { project } from '../project/project-state.svelte';
import { editorToolsNow } from '../editor/tools/tools-runtime';
import { ask, choose, explain } from '../editor/tools/editor-panel';
import type { EditorCommand } from '../editor/tools/command-registry';
import type { DocumentSnapshot } from '../../protocol/desktop-api';
import { view } from '../workspace/workspace-view.svelte';
import { reviewViews } from '../project/source-control/review-workspace';
import { displayOptions, restoreDisplayOptions } from '../editor/tools/view-display';
import { notebookContent } from '../notebook/document-content';
export class WorkspaceSnapshots {
  private fingerprint = '';
  private writing = false;
  private recoveryId: string | undefined;
  private restoring = false;
  private failedFingerprint = '';
  private retryAfter = 0;
  constructor(private readonly desktop: DesktopPort, private readonly workspace: WorkspaceState, private readonly tabs: TabController,
    private readonly editor: MonacoEditor, private readonly projects: ProjectController) {
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    const timer = setInterval(() => { void this.recoverable(); }, 1000);
    const flush = () => { clearTimeout(scheduled); void this.recoverable(); };
    const unsubscribe = tabs.onChange(() => { clearTimeout(scheduled); scheduled = setTimeout(flush, 250); });
    window.addEventListener('blur', flush);
    document.addEventListener('visibilitychange', flush);
    void desktop.editorTools.snapshots.list().then(entries => { view.recoveryCount = entries.filter(entry => entry.recovery).length; }).catch(error => console.error('Could not inspect recovery snapshots', error));
    window.addEventListener('pagehide', () => { clearInterval(timer); clearTimeout(scheduled); unsubscribe(); window.removeEventListener('blur', flush); document.removeEventListener('visibilitychange', flush); }, { once: true });
  }
  private async capture(checkpoint = false): Promise<WorkspaceSnapshot> {
    const { workspace, editor, tabs } = this;
    const records = workspace.contents.filter(content => !content.document.kind && (checkpoint || tabs.dirty(content) || content.document.isUntitled)).map(content => ({ key: documentIdentity(content), path: content.document.path,
      untitled: content.document.isUntitled, savedText: content.document.savedText, text: tabs.text(content) }));
    const contents: SnapshotContent[] = [];
    let remaining = 24 * 1024 * 1024;
    for (const content of records) {
      if (content.text.length > remaining || content.savedText.length > 24 * 1024 * 1024)
        throw Error('Recovery content exceeds 24 MiB. Save large documents directly.');
      remaining -= new TextEncoder().encode(content.text).byteLength;
      if (remaining < 0) throw Error('Recovery content exceeds 24 MiB. Save large documents directly.');
      contents.push({ key: content.key, path: content.path, untitled: content.untitled,
        savedHash: await contentHash(content.savedText), text: content.text });
    }
    const binaryContents: SnapshotContent[] = [];
    for (const content of workspace.contents.filter(content => !!content.document.kind && tabs.dirty(content))) {
      const snapshot: SnapshotContent = { key: documentIdentity(content), path: content.document.path, untitled: false, savedHash: await contentHash('') };
      let bytes: Uint8Array;
      if (content.document.kind === 'image') {
        const session = imageSessions.get(content.id);
        if (!session || !this.desktop.imageEdit.backup) throw Error('Image recovery is unavailable. Save the image to protect your edits.');
        const recipe = structuredClone(session.history.current);
        bytes = await this.desktop.imageEdit.backup(session.source.id);
        snapshot.binary = { data: '', extension: content.document.path.split('.').at(-1)!, recipe };
      } else if (content.document.kind === 'hwp' && this.desktop.hwp.backup) {
        const artifact = await this.desktop.hwp.backup(content.id);
        if (artifact.contentLoss.count) throw Error('HWP recovery export would lose document content. Save a copy and inspect the export report.');
        bytes = artifact.bytes; snapshot.binary = { data: '', extension: content.document.path.split('.').at(-1)! };
      } else continue;
      remaining -= Math.ceil(bytes.length / 3) * 4;
      if (remaining < 0) throw Error('Recovery content exceeds 24 MiB. Save large documents directly.');
      let encoded = ''; for (let i = 0; i < bytes.length; i += 8192) encoded += String.fromCharCode(...bytes.subarray(i, i + 8192));
      snapshot.binary.data = btoa(encoded); binaryContents.push(snapshot);
    }
    const views: SnapshotView[] = workspace.tabs.flatMap<SnapshotView>(tab => {
      if (tab.kind === 'diff') {
        const entry = reviewViews.entries.find(entry => entry.id === tab.id), viewport = entry?.viewport.read(tab.id);
        return [{ key: tab.id, content: contents.some(content => content.key === tab.documentId) ? tab.documentId : undefined, path: tab.filePath, kind: 'diff', staged: tab.staged, history: tab.history, surface: 'diff',
          review: { mode: entry?.state.gitDiffMode ?? 'source', viewport: viewport ?? undefined } } satisfies SnapshotView];
      }
      if (!isDocumentTab(tab)) return [];
      editor.saveView(tab);
      return [{ key: tab.id, content: [...contents, ...binaryContents].some(content => content.key === documentIdentity(tab)) ? documentIdentity(tab) : undefined, path: tab.document.path, kind: 'document', surface: tab.surface,
        editor: editor.exportView(tab.id), anchor: tab.anchor, display: displayOptions(tab.id) } satisfies SnapshotView];
    });
    const ids = new Set(views.map(view => view.key));
    const groups = workspace.groups.groups.map(group => ({ id: group.id, tabs: group.tabs.filter(id => ids.has(id)), active: group.activeId && ids.has(group.activeId) ? group.activeId : null })).filter(group => group.tabs.length);
    const valid = new Set(groups.map(group => group.id));
    const prune = (tree: GroupTree): GroupTree | null => {
      if (tree.kind === 'group') return valid.has(tree.id) ? structuredClone(tree) : null;
      const first = prune(tree.first), second = prune(tree.second); return first && second ? { ...tree, first, second } : first ?? second;
    };
    const tree = prune(workspace.groups.tree); if (!tree) throw Error('Open a document before creating a snapshot.');
    return parseWorkspaceSnapshot({ version: 1, root: project.folder?.path ?? null, contents: [...contents, ...binaryContents], views, groups, tree,
      focused: valid.has(workspace.groups.focusedId) ? workspace.groups.focusedId : groups[0].id });
  }
  private async recoverable(): Promise<void> {
    if (this.writing || this.restoring) return;
    const dirty = this.workspace.contents.filter(content => this.tabs.dirty(content) || content.document.isUntitled);
    const fingerprint = dirty.map(content => `${content.id}:${content.document.path}:${content.revision}`).join('|');
    if (fingerprint === this.fingerprint) return;
    if (fingerprint === this.failedFingerprint && Date.now() < this.retryAfter) return;
    this.writing = true;
    try {
      if (dirty.length) this.recoveryId = await this.desktop.editorTools.snapshots.write('Unsaved workspace recovery', await this.capture(), true);
      else if (this.recoveryId) { await this.desktop.editorTools.snapshots.remove(this.recoveryId); this.recoveryId = undefined; }
      this.fingerprint = fingerprint; this.failedFingerprint = ''; this.retryAfter = 0; view.recoveryError = '';
    } catch (error) {
      this.failedFingerprint = fingerprint; this.retryAfter = Date.now() + 30_000;
      view.recoveryError = `Recovery backup failed. Save your documents to protect recent edits. ${String(error)}`;
      editorToolsNow()?.registry.messages.push({ time: Date.now(), command: 'Recovery snapshot', message: String(error) });
    }
    finally { this.writing = false; }
  }
  commands(): EditorCommand[] {
    return [
      { id: 'setdown.session.checkpoint', title: 'Create a content checkpoint…', category: 'Session', detail: 'Retains complete text of open files, including saved content, in a separate bounded snapshot.', run: async () => {
        const name = await ask('Content checkpoint', 'Name', new Date().toLocaleString()); if (!name) return false;
        await this.desktop.editorTools.snapshots.write(`Checkpoint · ${name}`, await this.capture(true));
      } },
      { id: 'setdown.session.save', title: 'Save workspace snapshot…', category: 'Session', detail: 'Files, groups, view positions and dirty text; browsers and running processes use their own lifetime.', run: async () => {
        const name = await ask('Workspace snapshot', 'Name', new Date().toLocaleString()); if (!name) return false;
        await this.desktop.editorTools.snapshots.write(name, await this.capture());
      } },
      { id: 'setdown.session.restore', title: 'Restore a workspace or recovery snapshot…', category: 'Session', detail: 'Explicit restore. Changed disk files recover into separate unsaved documents.', run: async () => {
        const entries = await this.desktop.editorTools.snapshots.list();
        const id = await choose('Workspace snapshots', entries.map(entry => ({ label: `${entry.recovery ? 'Recovery · ' : ''}${entry.name}`, detail: new Date(entry.time).toLocaleString(), value: entry.id })));
        if (!id) return false;
        const snapshot = parseWorkspaceSnapshot(await this.desktop.editorTools.snapshots.read(id));
        const confirmed = await choose('Restore snapshot into additional groups?', [{ label: 'Restore', detail: `${snapshot.views.length} file views · ${snapshot.contents.filter(content => content.text !== undefined).length} unsaved buffers`, value: true }, { label: 'Cancel', value: false }]);
        if (!confirmed) return false;
        await this.restore(snapshot); view.recoveryCount = 0;
      } },
      { id: 'setdown.session.remove', title: 'Remove a saved snapshot…', category: 'Session', detail: 'Deletes only the selected recovery artifact.', run: async () => {
        const entries = await this.desktop.editorTools.snapshots.list(), id = await choose('Remove snapshot', entries.map(entry => ({ label: entry.name, detail: new Date(entry.time).toLocaleString(), value: entry.id })));
        if (!id) return false;
        if (await choose('Permanently remove this snapshot?', [{ label: 'Remove', value: true }, { label: 'Cancel', value: false }])) await this.desktop.editorTools.snapshots.remove(id); else return false;
      } },
    ];
  }
  private async restore(snapshot: WorkspaceSnapshot): Promise<void> {
    this.restoring = true;
    const failures: string[] = [], recovered = new Map<string, DocumentSnapshot>(), remap = new Map<string, string>(), groups = new Map<string, string>();
    try {
      if (snapshot.root && snapshot.root !== project.folder?.path) {
        await this.projects.openFolderPath(snapshot.root);
        if (project.folder?.path !== snapshot.root) failures.push(`${snapshot.root}: project unavailable; restoring file views without comparison sessions.`);
      }
      // Complete disk/version checks before changing the layout. Never write an original file.
      for (const content of snapshot.contents) {
        try {
          if (content.binary) {
            if (!this.desktop.editorTools.snapshots.restoreBinary) throw Error('Binary recovery is unavailable.');
            const bytes = Uint8Array.from(atob(content.binary.data), char => char.charCodeAt(0));
            const file = await this.desktop.editorTools.snapshots.restoreBinary(`document.${content.binary.extension}`, bytes);
            recovered.set(content.key, await this.desktop.readDocumentLocation(file));
            failures.push(`${content.path}: recovered as a separate file. Use Save As to choose its permanent location.`);
            continue;
          }
          const existing = this.workspace.contents.find(record => record.document.path === content.path);
          let disk: DocumentSnapshot | undefined;
          if (!content.untitled) try { disk = await this.desktop.readDocumentLocation(content.path); } catch { /* A missing dirty file is still recoverable. */ }
          const changed = !disk || await contentHash(disk.savedText) !== content.savedHash;
          const conflict = !!existing && this.tabs.text(existing) !== existing.document.savedText;
          if (content.text !== undefined && (changed || conflict || content.untitled)) {
            const draft = await this.desktop.newDocument(); if (!draft) throw Error('Could not create a recovery document.'); recovered.set(content.key, { ...draft, text: content.text, revision: 1 });
            failures.push(`${content.path}: recovered into a separate unsaved document${changed && !content.untitled ? ' because the disk version changed or disappeared' : conflict ? ' because an open document has edits' : ''}.`);
          } else if (disk) recovered.set(content.key, content.text !== undefined ? { ...disk, text: content.text, revision: disk.revision + 1 } : disk);
          else failures.push(`${content.path}: file is unavailable and has no recovery text.`);
        } catch (error) { failures.push(`${content.path}: ${String(error)}`); }
      }
      const initial = this.workspace.groups.focusedId;
      for (const group of snapshot.groups) groups.set(group.id, this.workspace.groups.split(initial, 'right').id);
      for (const group of snapshot.groups) for (const key of group.tabs) {
        const view = snapshot.views.find(view => view.key === key)!;
        try {
          const groupId = groups.get(group.id)!; this.workspace.groups.focusedId = groupId;
          const content = view.content ? recovered.get(view.content) : undefined;
          if (view.content && !content) throw Error('Content could not be restored.');
          if (view.kind === 'diff' && !content?.isUntitled && snapshot.root === project.folder?.path) {
            if (view.history) await this.projects.reviewGitHistory(view.history); else await this.projects.reviewGitChange(view.path, !!view.staged);
            const entry = reviewViews.entries.find(entry => entry.id === this.workspace.activeId);
            if (!entry || this.workspace.groups.owner(entry.id)?.id !== groupId) throw Error('Could not reopen this comparison.');
            if (content) {
              const record = this.workspace.documentStore.find(content.path);
              if (!record) throw Error('Comparison content is unavailable.');
              if (this.tabs.text(record) !== content.text) { await this.editor.load(); this.editor.modelFor(record); this.editor.setText(record, content.text); }
            }
            if (view.review?.viewport) { entry.viewport.requestSource(entry.id, view.review.viewport); entry.controller.updateSourceLine(view.review.viewport.anchor.sourceLine); }
            if (view.review?.mode === 'rendered') entry.controller.showRendered();
          } else {
            const document = content ?? await this.desktop.readDocumentLocation(view.path);
            await this.tabs.show(document, view.surface === 'viewer' ? 'viewer' : 'editor', 'document', undefined, { groupId, pinned: true });
            const active = this.workspace.activeDocument;
            if (active) {
              const record = snapshot.contents.find(record => record.key === view.content);
              if (record?.binary?.recipe) { await imageSessions.open(active.id); imageSessions.edit(active.id, record.binary.recipe); }
              if (content?.text !== undefined && this.tabs.text(active) !== content.text) {
                if (notebookContent.accepts(active)) { notebookContent.replace(active, { ...active.document, text: content.text, revision: active.revision + 1 }); this.tabs.updateChrome(); }
                else { await this.editor.load(); this.editor.modelFor(active); this.editor.setText(active, content.text); }
              }
              if (view.display) restoreDisplayOptions(active.id, view.display);
              if (view.anchor) active.anchor = { ...view.anchor };
              if (view.editor) this.editor.importView(active.id, view.editor);
            }
          }
          if (this.workspace.activeId) remap.set(key, this.workspace.activeId);
        } catch (error) { failures.push(`${view.path}: ${String(error)}`); }
      }
      // Replace the generated leaves with the recorded nested geometry, keeping pre-existing groups.
      const successful = new Set([...groups.values()].filter(id => this.workspace.groups.groups.find(group => group.id === id)?.tabs.length));
      const mapped = (tree: GroupTree): GroupTree | null => {
        if (tree.kind === 'group') { const id = groups.get(tree.id)!; return successful.has(id) ? { kind: 'group', id } : null; }
        const first = mapped(tree.first), second = mapped(tree.second);
        return first && second ? { ...tree, id: `split-${crypto.randomUUID()}`, first, second } : first ?? second;
      };
      const previous = (tree: GroupTree): GroupTree | null => {
        if (tree.kind === 'group') return [...groups.values()].includes(tree.id) || !this.workspace.groups.groups.find(group => group.id === tree.id)?.tabs.length ? null : tree;
        const first = previous(tree.first), second = previous(tree.second); return first && second ? { ...tree, first, second } : first ?? second;
      };
      const restored = mapped(snapshot.tree), old = previous(this.workspace.groups.tree);
      if (restored) this.workspace.groups.tree = old ? { kind: 'split', id: `split-${crypto.randomUUID()}`, axis: 'x', ratio: .5, first: old, second: restored } : restored;
      this.workspace.groups.pruneEmpty();
      for (const group of snapshot.groups) {
        const target = this.workspace.groups.groups.find(item => item.id === groups.get(group.id));
        if (target && group.active && remap.has(group.active)) target.activeId = remap.get(group.active)!;
      }
      const focused = snapshot.groups.find(group => group.id === snapshot.focused), id = focused?.active && remap.get(focused.active);
      if (id) await this.tabs.activate(id); this.tabs.render();
    } finally { this.restoring = false; }
    if (failures.length) await explain('Snapshot restore details', failures);
  }
}
