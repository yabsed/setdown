import type { DesktopPort } from '../ports/desktop-port';
import { isDocumentTab, tabTitle, type WorkspaceState } from '../../core/workspace/workspace-state';
import { documentIdentity } from '../../core/workspace/document-store';
import type { TabController } from '../workspace/tab-controller';
import type { SurfaceController } from '../workspace/surface-controller';
import type { MonacoEditor } from '../adapters/monaco-editor';
import type { ProjectController } from '../project/project-controller';
import { project } from '../project/project-state.svelte';
import { notebookHasCell } from '../notebook/document-content';
import { configureEditorTools, editorToolsNow } from '../editor/tools/tools-runtime';
import { choose, ask, explain } from '../editor/tools/editor-panel';
import { terminalOutput } from '../terminal/terminal-output';
import { taskLocations } from '../../core/editor/task-locations';
import type { EditorCommand } from '../editor/tools/command-registry';
import { documentSupport } from '../language/language-runtime';
import { WorkspaceSnapshots } from './workspace-snapshots';
export function installWorkspaceTools(options: { desktop: DesktopPort; workspace: WorkspaceState; tabs: TabController; surfaces: SurfaceController; editor: MonacoEditor; projects: ProjectController; save(saveAs?: boolean): Promise<unknown> }): void {
  const { desktop, workspace, tabs, surfaces, editor } = options;
  const snapshots = new WorkspaceSnapshots(desktop, workspace, tabs, editor, options.projects);
  configureEditorTools({
    group: () => workspace.groups.focusedId, root: () => project.folder?.path ?? null,
    resolve: (model, codeEditor) => {
      const uri = model.uri;
      if (uri.scheme === 'setdown-cell') {
        const tab = workspace.find(uri.authority), cellId = uri.path.slice(1);
        if (!tab || !isDocumentTab(tab) || !notebookHasCell(tab, cellId)) return null;
        return { path: tab.document.path, cellId, viewId: tab.id, groupId: workspace.groups.owner(tab.id)?.id ?? workspace.groups.focusedId };
      }
      const record = workspace.contents.find(content => documentIdentity(content) === uri.query);
      if (!record) return null;
      const host = codeEditor?.getModel() === model ? codeEditor?.getDomNode()?.closest<HTMLElement>('[data-group-id]') : null;
      const view = workspace.tabs.find(tab => 'documentId' in tab && tab.documentId === record.id);
      const groupId = host?.dataset.groupId ?? (view ? workspace.groups.owner(view.id)?.id : undefined) ?? workspace.groups.focusedId;
      const group = workspace.groups.groups.find(group => group.id === groupId);
      return { path: record.document.path, viewId: group?.activeId ?? null, groupId };
    },
    open: async location => {
      const origin = workspace.activeId, originalView = editor.editor?.saveViewState();
      const groupId = location.groupId && workspace.groups.groups.some(group => group.id === location.groupId) ? location.groupId : workspace.groups.focusedId;
      const snapshot = await desktop.readDocumentLocation(location.path);
      if (!workspace.groups.groups.some(group => group.id === groupId)) throw Error('The destination group was closed.');
      await tabs.show(snapshot, location.cellId ? 'notebook' : 'editor', 'document', undefined, { groupId, pinned: true });
      if (location.cellId) {
        const tab = workspace.activeDocument;
        if (!tab || !notebookHasCell(tab, location.cellId)) throw Error('The recorded notebook cell was deleted.');
        window.dispatchEvent(new CustomEvent('setdown:notebook-location', { detail: { id: tab.id, cellId: location.cellId,
          range: { startLineNumber: location.line, startColumn: location.column, endLineNumber: location.endLine ?? location.line, endColumn: location.endColumn ?? location.column } } }));
      } else {
        await surfaces.enterEditor();
        const target = editor.editor; if (!target) throw Error('This resource does not have a text editor.');
        if (location.context && target.getModel()?.getLineContent(Math.min(location.line, target.getModel()!.getLineCount())) !== location.context) {
          const model = target.getModel()!;
          const candidates = model.findMatches(location.context, false, false, true, null, false, 1000)
            .filter(match => match.range.startColumn === 1 && model.getLineContent(match.range.startLineNumber) === location.context);
          if (candidates.length === 1) {
            const delta = candidates[0].range.startLineNumber - location.line;
            location = { ...location, line: location.line + delta, endLine: location.endLine ? location.endLine + delta : undefined };
          } else {
            const decision = await choose('Result location has changed', [{ label: 'Open the approximate location', detail: location.context, value: true }, { label: 'Cancel navigation', value: false }]);
            if (!decision) { if (origin && workspace.find(origin)) { await tabs.activate(origin); if (originalView) editor.editor?.restoreViewState(originalView); } return; }
          }
        }
        target.setSelection({ startLineNumber: location.line, startColumn: location.column, endLineNumber: location.endLine ?? location.line, endColumn: location.endColumn ?? location.column });
        target.revealLineInCenter(location.line); target.focus();
      }
    },
    paths: (context, prefix) => context.resource ? desktop.editorTools.paths(context.resource, prefix) : Promise.resolve([]),
    policy: path => desktop.editorTools.policy(path),
    spelling: words => desktop.editorTools.spelling(words), learnWord: word => desktop.editorTools.learnWord(word),
    symbols: model => editor.documentSymbols(model),
    bindings: async () => {
      const entries = await Promise.all(['application-menu-file', 'application-menu-edit', 'application-menu-view', 'application-menu-window'].map(id => desktop.getApplicationMenu(id)));
      const flatten = (items: typeof entries[number]): string[] => items.flatMap(item => [
        ...(item.accelerator ? [`${item.accelerator} · ${item.label} · Application menu · ${item.enabled ? 'Enabled' : 'Disabled for this surface'}`] : []),
        ...(item.submenu ? flatten(item.submenu) : []),
      ]);
      return entries.flatMap(flatten);
    },
    settings: async context => {
      const record = workspace.contents.find(content => content.document.path === context.resource);
      const support = context.viewId ? documentSupport.get(context.viewId) : undefined;
      return [`Project: ${project.folder?.path ?? 'No project; file-relative paths'}`, `Encoding: ${record?.document.encoding ?? 'UTF-8'} · BOM preserved`,
        `Disk line endings: ${record?.document.eol ?? 'Detected from text'}`, 'Word completion: Monaco, same language; no background file scanning.',
        ...(support ? [`Language: ${support.language}`, ...support.providers.flatMap(provider => [`${provider.name}: ${provider.state}`, ...(provider.context ?? [])])] : [])];
    },
    commands: () => {
      const command = (id: string, title: string, run: EditorCommand['run'], key?: string): EditorCommand => ({ id: `setdown.workspace.${id}`, title, run, key, category: 'Workspace', detail: 'Uses the current editor group.', needsEditor: false });
      return [
        ...snapshots.commands(),
        command('terminal.results', 'Collect file locations from terminal output', async () => {
          const output = workspace.activeId && terminalOutput(workspace.activeId);
          if (!output) throw Error('Focus a terminal tab first.');
          const directory = await ask('Terminal locations', 'Base directory for relative paths (terminal start directory)', output.directory || project.folder?.path || '');
          if (!directory) return false;
          if (!/^(?:\/|[A-Za-z]:[\\/])/.test(directory)) throw Error('Use an absolute base directory.');
          const parsed = taskLocations(output.text, directory);
          editorToolsNow()?.recordResults('Terminal locations', 'Task output', parsed.entries);
          await explain('Terminal output locations', [`Collected ${parsed.entries.length} locations. Use “Show current result list” to navigate.`, ...parsed.unparsed.map(line => `Unparsed: ${line}`)]);
        }),
        { ...command('save', 'Save document', async () => { await options.save(); }, 'Ctrl/Cmd+S'), available: () => workspace.activeContent ? undefined : 'Focus an editable document or Working Tree view.' },
        { ...command('save-as', 'Save document as…', async () => { await options.save(true); }, 'Ctrl/Cmd+Shift+S'), available: () => workspace.activeContent ? undefined : 'Focus an editable document or Working Tree view.' },
        command('buffers', 'Switch to an open document…', async () => {
          const id = await choose('Open documents', workspace.tabs.map(tab => ({ label: tabTitle(tab), detail: `${workspace.groups.owner(tab.id)?.id}${tabs.dirty(tab) ? ' · Unsaved' : ''}`, value: tab.id })));
          if (id) await tabs.activate(id); else return false;
        }),
        command('group.next', 'Focus next editor group', async () => {
          const groups = workspace.groups.groups, index = groups.findIndex(group => group.id === workspace.groups.focusedId), next = groups[(index + 1) % groups.length];
          if (next?.activeId) await tabs.activate(next.activeId);
        }),
        command('group.previous', 'Focus previous editor group', async () => {
          const groups = workspace.groups.groups, index = groups.findIndex(group => group.id === workspace.groups.focusedId), next = groups[(index + groups.length - 1) % groups.length];
          if (next?.activeId) await tabs.activate(next.activeId);
        }),
        ...(['copy', 'move'] as const).map(operation => ({ ...command(`group.${operation}`, `${operation === 'copy' ? 'Copy' : 'Move'} editor to group…`, async () => {
          const id = workspace.activeId; if (!id) return false;
          const target = await choose('Destination group', workspace.groups.groups.map((group, index) => ({ label: `Group ${index + 1}`, detail: group.id, value: group.id })));
          if (!target || !workspace.find(id)) return false;
          if (operation === 'copy') await tabs.copyToGroup(id, target);
          else await tabs.moveToGroup(id, { groupId: target, direction: null });
        }), available: () => !workspace.active ? 'Open a tab first.' : operation === 'copy' && !(workspace.active.kind === 'diff' || isDocumentTab(workspace.active) && !workspace.active.document.kind && !/\.ipynb$/i.test(workspace.active.document.path)) ? 'This surface has a single owner and cannot be copied.' : undefined })),
        command('group.equalize', 'Equalize editor groups', () => { workspace.groups.equalize(); tabs.render(); }),
        command('group.maximize', 'Maximize / restore current editor group', () => { workspace.groups.toggleMaximize(); tabs.render(); }),
        ...(['left', 'right', 'up', 'down'] as const).map(direction => ({ ...command(`split.${direction}`, `Split editor ${direction}`, async () => {
          if (workspace.activeId) await tabs.copyToGroup(workspace.activeId, workspace.groups.focusedId, direction);
        }), available: () => workspace.active && (workspace.active.kind === 'diff' || isDocumentTab(workspace.active) && !workspace.active.document.kind && !/\.ipynb$/i.test(workspace.active.document.path)) ? undefined : 'This surface has a single owner and cannot be copied.' })),
        command('file.open-target', 'Open a file path or module at the cursor…', async context => {
          const selection = context.editor?.getSelection(), model = context.model;
          const initial = model && selection ? model.getValueInRange(selection) || model.getWordAtPosition(selection.getPosition())?.word || '' : '';
          const input = await ask('Open file or module', 'Relative path or module name', initial); if (!input || !context.resource) return false;
          const suffix = /:(\d+)(?::(\d+))?$/.exec(input), name = suffix ? input.slice(0, suffix.index) : input;
          const candidates = await desktop.editorTools.paths(context.resource, name, !/[\\/]/.test(name) && !/\.(?:py|ts|js|md|txt)$/.test(name));
          const path = await choose('File candidates', candidates.filter(candidate => !candidate.directory).map(candidate => ({ label: candidate.label, value: candidate.path })));
          if (path) { const snapshot = await desktop.readDocumentLocation(path); await tabs.show(snapshot, 'editor', 'document', undefined, { groupId: context.groupId });
            editor.editor?.setPosition({ lineNumber: Number(suffix?.[1] ?? 1), column: Number(suffix?.[2] ?? 1) }); editor.editor?.revealLineInCenter(Number(suffix?.[1] ?? 1)); }
          else return false;
        }),
        command('language', 'Inspect language support and analysis environment', () => { window.dispatchEvent(new Event('setdown:language-support')); }),
      ];
    },
  });
}
