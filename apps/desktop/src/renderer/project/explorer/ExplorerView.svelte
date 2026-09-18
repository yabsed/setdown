<script lang="ts">
  import type { ProjectEntryKind } from '../../../protocol/desktop-api';
  import type { AppActions } from '../../view-state.svelte';
  import { project, type VisibleProjectEntry } from '../project-state.svelte';
  import SideViewMenu from '../SideViewMenu.svelte';
  import ExplorerEditRow from './ExplorerEditRow.svelte';

  type Edit = {
    mode: 'create' | 'rename';
    kind: ProjectEntryKind;
    parent: string;
    target?: string;
    depth: number;
    value: string;
  };
  type Menu = { x: number; y: number; entry: VisibleProjectEntry | null };

  let { actions }: { actions: AppActions } = $props();
  let selected = $state('');
  let editing = $state<Edit | null>(null);
  let menu = $state<Menu | null>(null);
  let trashTarget = $state<VisibleProjectEntry | null>(null);
  let dropTarget = $state('');

  const parentOf = (candidate: string) => candidate.replace(/[\\/][^\\/]+$/, '');
  const relativeToRoot = (candidate: string) => candidate.slice(project.folder?.path.length ?? 0)
    .replace(/^[\\/]/, '');
  const selectedEntry = () => project.entries.find((entry) => entry.path === selected);
  const createParent = () => {
    const entry = selectedEntry();
    return entry?.kind === 'directory' ? entry.path
      : entry ? parentOf(entry.path) : project.folder?.path ?? '';
  };
  const createDepth = (parent: string) => parent === project.folder?.path ? 0
    : (project.entries.find((entry) => entry.path === parent)?.depth ?? -1) + 1;

  function beginCreate(kind: ProjectEntryKind, parent = createParent()) {
    if (!parent) return;
    selected = parent;
    const directory = project.entries.find((entry) => entry.path === parent);
    if (directory && !directory.expanded) void actions.toggleProjectDirectory(parent);
    editing = { mode: 'create', kind, parent, depth: createDepth(parent), value: '' };
    menu = null;
  }

  function beginRename(entry: VisibleProjectEntry) {
    selected = entry.path;
    editing = {
      mode: 'rename',
      kind: entry.kind === 'directory' ? 'directory' : 'file',
      parent: parentOf(entry.path),
      target: entry.path,
      depth: entry.depth,
      value: entry.name,
    };
    menu = null;
  }

  async function submitEdit(value: string) {
    if (!editing || !value.trim()) return;
    editing.value = value;
    try {
      if (editing.mode === 'create') {
        await actions.createProjectEntry(editing.parent, editing.value, editing.kind);
      } else if (editing.target) {
        await actions.renameProjectEntry(editing.target, editing.value);
      }
      editing = null;
    } catch {
      // Keep the inline editor open so the name can be corrected.
    }
  }

  function activate(entry: VisibleProjectEntry) {
    selected = entry.path;
    if (entry.kind === 'directory') void actions.toggleProjectDirectory(entry.path);
    else if (entry.kind === 'document') actions.openProjectFile(entry.path);
  }

  function keyEntry(event: KeyboardEvent, entry: VisibleProjectEntry) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate(entry);
    } else if (event.key === 'F2') {
      event.preventDefault();
      beginRename(entry);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      trashTarget = entry;
    }
  }

  function openMenu(event: MouseEvent, entry: VisibleProjectEntry | null) {
    event.preventDefault();
    selected = entry?.path ?? project.folder?.path ?? '';
    menu = { x: Math.min(event.clientX, innerWidth - 170), y: Math.min(event.clientY, innerHeight - 190), entry };
  }

  function startDrag(event: DragEvent, entry: VisibleProjectEntry) {
    event.dataTransfer?.setData('application/x-setdown-project-entry', entry.path);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function copy(value: string) {
    void navigator.clipboard.writeText(value).catch(() => {
      project.error = 'Could not copy the path to the clipboard.';
    });
  }

  function dragOver(event: DragEvent, target: string) {
    if (!event.dataTransfer?.types.includes('application/x-setdown-project-entry')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    dropTarget = target;
  }

  function drop(event: DragEvent, target: string) {
    const source = event.dataTransfer?.getData('application/x-setdown-project-entry');
    dropTarget = '';
    if (!source) return;
    event.preventDefault();
    void actions.moveProjectEntry(source, target);
  }

  async function confirmTrash() {
    const target = trashTarget;
    trashTarget = null;
    if (target) await actions.trashProjectEntry(target.path).catch(() => {});
  }
</script>

<svelte:window onclick={() => menu = null} onkeydown={(event) => {
  if (event.key === 'Escape') { menu = null; editing = null; trashTarget = null; }
}} />

<header class="side-view-title">
  <span>EXPLORER</span>
  <button type="button" title="New File" aria-label="New File" disabled={!project.folder}
    onclick={() => beginCreate('file')}><svg viewBox="0 0 16 16"><path d="M3 1.5h6l4 4v9H3v-13Zm6 0v4h4M8 8v4m-2-2h4"/></svg></button>
  <button type="button" title="New Folder" aria-label="New Folder" disabled={!project.folder}
    onclick={() => beginCreate('directory')}>
    <svg viewBox="0 0 16 16"><path d="M1.5 4.5h5l1.5 2h6.5v7h-13v-9ZM8 8.5v3m-1.5-1.5h3"/></svg>
  </button>
  <SideViewMenu items={[
    { label: 'Refresh Explorer', disabled: !project.folder, run: actions.refreshProjectExplorer },
    { label: 'Collapse Folders', disabled: !project.folder, run: actions.collapseProjectExplorer },
  ]} />
</header>

{#if !project.folder}
  <div class="side-view-welcome">
    <p>Open a folder to browse and manage Markdown documents.</p>
    <button type="button" onclick={actions.chooseProjectFolder}>Open Folder</button>
  </div>
{:else}
  <div class="explorer-root" class:is-drop-target={dropTarget === project.folder.path}
    title={project.folder.path} role="treeitem" tabindex="0" aria-selected="false"
    onkeydown={(event) => event.key === 'Enter' && actions.collapseProjectExplorer()}
    oncontextmenu={(event) => openMenu(event, null)}
    ondragover={(event) => dragOver(event, project.folder!.path)}
    ondragleave={() => dropTarget = ''} ondrop={(event) => drop(event, project.folder!.path)}>
    <svg viewBox="0 0 16 16"><path d="m5 4 4 4-4 4"/></svg>
    <strong>{project.folder.name.toLocaleUpperCase()}</strong>
  </div>
  <div class="explorer-tree" role="tree" tabindex="-1" aria-label={project.folder.name}>
    {#if editing?.mode === 'create' && editing.parent === project.folder.path}
      <ExplorerEditRow kind={editing.kind} depth={editing.depth} initial={editing.value}
        label={`New ${editing.kind} name`} submit={(value) => void submitEdit(value)} cancel={() => editing = null} />
    {/if}
    {#each project.entries as entry (entry.path)}
      {#if editing?.mode === 'rename' && editing.target === entry.path}
        <ExplorerEditRow kind={editing.kind} depth={editing.depth} initial={editing.value}
          label="Rename entry" submit={(value) => void submitEdit(value)} cancel={() => editing = null} />
      {:else}
        <div role="treeitem" tabindex="0" draggable="true" class="explorer-row"
          class:is-selected={selected === entry.path} class:is-muted={entry.kind === 'file'}
          class:is-drop-target={dropTarget === entry.path}
          aria-selected={selected === entry.path}
          aria-expanded={entry.kind === 'directory' ? entry.expanded : undefined}
          style:padding-left={`${8 + entry.depth * 13}px`} title={entry.path}
          onclick={() => activate(entry)} onkeydown={(event) => keyEntry(event, entry)}
          oncontextmenu={(event) => openMenu(event, entry)} ondragstart={(event) => startDrag(event, entry)}
          ondragend={() => dropTarget = ''}
          ondragover={(event) => entry.kind === 'directory' && dragOver(event, entry.path)}
          ondragleave={() => dropTarget = ''}
          ondrop={(event) => entry.kind === 'directory' && drop(event, entry.path)}>
          {#if entry.kind === 'directory'}
            <svg class="tree-chevron" class:is-open={entry.expanded} viewBox="0 0 16 16"><path d="m5 4 4 4-4 4"/></svg>
            <svg class="tree-icon" viewBox="0 0 16 16"><path d="M1.5 4.5h5l1.5 2h6.5v7h-13v-9Z"/></svg>
          {:else}
            <span class="tree-chevron"></span>
            <svg class="tree-icon" viewBox="0 0 16 16"><path d="M3 1.5h6l4 4v9H3v-13Zm6 0v4h4"/></svg>
          {/if}
          <span>{entry.name}</span>
          {#if entry.loading}<span class="tree-progress">…</span>{/if}
        </div>
      {/if}
      {#if editing?.mode === 'create' && editing.parent === entry.path}
        <ExplorerEditRow kind={editing.kind} depth={editing.depth} initial={editing.value}
          label={`New ${editing.kind} name`} submit={(value) => void submitEdit(value)} cancel={() => editing = null} />
      {/if}
    {/each}
  </div>
{/if}

{#if menu}
  <div class="project-context-menu" role="menu" tabindex="-1"
    style:left={`${menu.x}px`} style:top={`${menu.y}px`}>
    {#if !menu.entry || menu.entry.kind === 'directory'}
      <button type="button" role="menuitem" onclick={() => beginCreate('file', menu?.entry?.path ?? project.folder!.path)}>New File</button>
      <button type="button" role="menuitem" onclick={() => beginCreate('directory', menu?.entry?.path ?? project.folder!.path)}>New Folder</button>
      <span class="menu-separator"></span>
    {/if}
    {#if menu.entry}
      {#if menu.entry.kind === 'document'}<button type="button" role="menuitem"
        onclick={() => actions.openProjectFile(menu!.entry!.path)}>Open</button>{/if}
      <button type="button" role="menuitem" onclick={() => copy(menu!.entry!.path)}>Copy Path</button>
      <button type="button" role="menuitem" onclick={() => copy(relativeToRoot(menu!.entry!.path))}>Copy Relative Path</button>
      <span class="menu-separator"></span>
      <button type="button" role="menuitem" onclick={() => menu?.entry && beginRename(menu.entry)}>Rename <kbd>F2</kbd></button>
      <button type="button" role="menuitem" onclick={() => { trashTarget = menu?.entry ?? null; menu = null; }}>Move to Trash <kbd>Del</kbd></button>
    {:else}
      <button type="button" role="menuitem" onclick={() => { menu = null; actions.refreshProjectExplorer(); }}>Refresh</button>
      <button type="button" role="menuitem" onclick={() => { menu = null; actions.collapseProjectExplorer(); }}>Collapse Folders</button>
      <span class="menu-separator"></span>
      <button type="button" role="menuitem" onclick={() => { menu = null; actions.chooseProjectFolder(); }}>Open Another Folder…</button>
    {/if}
  </div>
{/if}

{#if trashTarget}
  <div class="project-confirm" role="alertdialog" aria-modal="true" aria-labelledby="trash-title">
    <strong id="trash-title">Move “{trashTarget.name}” to Trash?</strong>
    <span>You can restore it from the system Trash.</span>
    <div><button type="button" class="ghost" onclick={() => trashTarget = null}>Cancel</button>
      <button type="button" class="danger" onclick={() => void confirmTrash()}>Move to Trash</button></div>
  </div>
{/if}
