<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { tree, rememberTree, selectPaths, under } from './explorer-tree-state.svelte';
  import { presentEntries, typeaheadMatch } from './explorer-presentation';
  import type { ExplorerClipboard, ExplorerEditCommand } from '../../../protocol/explorer';
  import { selectEntry, topLevelPaths, draggedPaths, PROJECT_ENTRIES, PROJECT_FILES } from './explorer-selection';
  import NativeOverlay from '../../shell/NativeOverlay.svelte';
  import type { ProjectEntryKind } from '../../../protocol/desktop-api';
  import type { AppActions } from '../../ports/ui-actions';
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
  let busy = $state(false);
  let dragged: string[] = [];
  let dragImage: HTMLElement | null = null;
  const visibleEntries = $derived(presentEntries(project.entries, tree.filter, tree.showHidden, tree.sort));
  const selectedEntries = $derived(visibleEntries.filter(entry => tree.selection.paths.includes(entry.path)));
  const selectedPaths = () => selectedEntries.map(entry => entry.path);
  const singleSelection = (path: string) => { tree.selection = { paths: [path], anchor: path }; tree.focused = path; };
  let editing = $state<Edit | null>(null);
  let menu = $state<Menu | null>(null);
  let trashTarget = $state<VisibleProjectEntry[] | null>(null);
  let dropTarget = $state('');
  let clipboard = $state<ExplorerClipboard | null>(null);
  let pasteConflict = $state<string | null>(null);
  let treeElement = $state<HTMLDivElement>();
  let popup = $state<HTMLDivElement>();
  let filterOpen = $state(false);
  let filterInput = $state<HTMLInputElement>();
  let typeahead = '';
  let typedAt = 0;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let hoverPath = '';
  let scrollTimer: ReturnType<typeof setInterval> | undefined;
  let scrollSpeed = 0;

  $effect(() => { rememberTree(); });
  $effect(() => { if (treeElement) treeElement.scrollTop = tree.scroll; });
  $effect(() => { if (filterOpen) filterInput?.focus(); });
  $effect(() => {
    if (!menu || !popup) return;
    const bounds = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(6, Math.min(menu.x, innerWidth - bounds.width - 6))}px`;
    popup.style.top = `${Math.max(6, Math.min(menu.y, innerHeight - bounds.height - 6))}px`;
    popup.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  });

  const fail = (error: unknown) => { project.error = error instanceof Error ? error.message : String(error); };
  async function refreshClipboard() { try { clipboard = await actions.explorer.clipboard(); } catch (error) { fail(error); } }
  async function fileCommand(command: ExplorerEditCommand | 'duplicate', conflict?: 'keep-both' | 'skip', targetOverride?: string) {
    if (busy || editing) return;
    if (command === 'select-all') { tree.selection = { paths: visibleEntries.map(entry => entry.path), anchor: tree.focused }; return; }
    const paths = topLevelPaths(selectedPaths());
    const target = targetOverride ?? createParent();
    menu = null;
    if (command !== 'paste' && !paths.length) return;
    busy = true;
    try {
      project.error = '';
      if (command === 'cut' || command === 'copy') clipboard = await actions.explorer.setClipboard(paths, command === 'cut');
      else {
        await actions.transferProjectEntries(command === 'paste' ? { kind: 'paste', target, conflict } : { kind: 'duplicate', paths });
        await refreshClipboard();
      }
      if (tree.focused) await focusEntry(tree.focused);
    } catch (error) {
      fail(error);
      if (command === 'paste' && !conflict && String(error).includes('already exists')) pasteConflict = target;
    }
    finally { busy = false; }
  }

  onMount(() => {
    const menuTarget = '.application-menu, .application-menu-popup, .application-submenu-popup, .project-context-menu';
    const updateTarget = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest(menuTarget)) return;
      actions.explorer.setEditTarget(!!target.closest('.explorer-row:not(.explorer-edit), .explorer-root, .explorer-tree')
        && !target.closest('input, textarea, [contenteditable="true"]') && project.open && project.visible);
    };
    const command = (event: Event) => {
      if (project.visible && project.open && !editing) void fileCommand((event as CustomEvent<ExplorerEditCommand>).detail);
    };
    const blur = () => actions.explorer.setEditTarget(false);
    document.addEventListener('focusin', updateTarget);
    document.addEventListener('pointerdown', updateTarget, true);
    window.addEventListener('setdown:explorer-command', command);
    window.addEventListener('focus', refreshClipboard);
    window.addEventListener('blur', blur);
    void refreshClipboard();
    const timer = setInterval(() => { if (clipboard?.cut && document.hasFocus()) void refreshClipboard(); }, 1500);
    return () => {
      clearInterval(timer); endDrag(); actions.explorer.setEditTarget(false);
      document.removeEventListener('focusin', updateTarget);
      document.removeEventListener('pointerdown', updateTarget, true);
      window.removeEventListener('setdown:explorer-command', command);
      window.removeEventListener('focus', refreshClipboard);
      window.removeEventListener('blur', blur);
    };
  });

  const parentOf = (candidate: string) => candidate.replace(/[\\/][^\\/]+$/, '');
  const relativeToRoot = (candidate: string) => candidate.slice(project.folder?.path.length ?? 0)
    .replace(/^[\\/]/, '');
  const selectedEntry = () => project.entries.find((entry) => entry.path === tree.focused);
  const createParent = () => {
    const entry = selectedEntry();
    return entry?.kind === 'directory' ? entry.path
      : entry ? parentOf(entry.path) : project.folder?.path ?? '';
  };
  const createDepth = (parent: string) => parent === project.folder?.path ? 0
    : (project.entries.find((entry) => entry.path === parent)?.depth ?? -1) + 1;

  function beginCreate(kind: ProjectEntryKind, parent = createParent()) {
    if (!parent) return;
    if (!project.explorerRootExpanded) actions.toggleProjectExplorerRoot();
    singleSelection(parent);
    const directory = project.entries.find((entry) => entry.path === parent);
    if (directory && !directory.expanded) void actions.toggleProjectDirectory(parent);
    editing = { mode: 'create', kind, parent, depth: createDepth(parent), value: '' };
    menu = null;
  }

  function beginRename(entry: VisibleProjectEntry) {
    singleSelection(entry.path);
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
    if (busy || !editing || !value.trim()) return;
    busy = true;
    editing.value = value;
    try {
      if (editing.mode === 'create') {
        await actions.createProjectEntry(editing.parent, editing.value, editing.kind);
      } else if (editing.target) {
        await actions.renameProjectEntry(editing.target, editing.value);
      }
      editing = null;
      if (tree.focused) await focusEntry(tree.focused);
    } catch {
      // Keep the inline editor open so the name can be corrected.
    } finally { busy = false; }
  }

  function clearSelection(event: MouseEvent) {
    if (event.target !== event.currentTarget) return;
    tree.selection = { paths: [], anchor: '' };
    tree.focused = '';
    menu = null;
  }

  function activate(entry: VisibleProjectEntry, pinned = false) {
    singleSelection(entry.path);
    if (entry.kind === 'directory') void actions.toggleProjectDirectory(entry.path);
    else if (entry.kind === 'document') actions.openProjectFile(entry.path, { pinned });
  }

  function clickEntry(event: MouseEvent, entry: VisibleProjectEntry) {
    if (busy || event.detail === 2) return;
    tree.focused = entry.path;
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      tree.selection = selectEntry(tree.selection, entry.path, visibleEntries.map(item => item.path), event);
    } else activate(entry);
  }

  async function focusEntry(path: string) {
    tree.focused = path;
    await tick();
    const row = [...document.querySelectorAll<HTMLElement>('.explorer-row')].find(row => row.dataset.path === path);
    row?.focus(); row?.scrollIntoView({ block: 'nearest' });
  }

  function keyTree(event: KeyboardEvent) {
    if (event.target instanceof HTMLInputElement || event.isComposing || busy) return;
    const editKey = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey ? event.key.toLowerCase() : '';
    if (editKey === 'c' || editKey === 'x' || editKey === 'v') {
      event.preventDefault(); event.stopPropagation();
      void fileCommand(editKey === 'c' ? 'copy' : editKey === 'x' ? 'cut' : 'paste');
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault(); event.stopPropagation();
      tree.selection = { paths: visibleEntries.map(entry => entry.path), anchor: tree.focused || project.entries[0]?.path || '' };
    } else if (event.key === 'Escape') {
      tree.selection = { paths: [], anchor: '' };
      void actions.explorer.clearClipboard().then(refreshClipboard).catch(fail);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault(); event.stopPropagation(); void fileCommand('duplicate');
    } else if (event.key === 'F5') {
      event.preventDefault(); event.stopPropagation(); actions.refreshProjectExplorer();
    } else if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1 && event.key !== ' ') {
      event.preventDefault(); event.stopPropagation();
      const now = performance.now();
      typeahead = now - typedAt > 1000 ? event.key : typeahead + event.key; typedAt = now;
      const query = [...typeahead].every(char => char === typeahead[0]) ? typeahead[0] : typeahead;
      const match = typeaheadMatch(visibleEntries, tree.focused, query);
      if (match) { singleSelection(match); void focusEntry(match); }
    }
  }

  function keyEntry(event: KeyboardEvent, entry: VisibleProjectEntry) {
    if (busy || event.isComposing) return;
    const visible = visibleEntries.map(item => item.path);
    const index = visible.indexOf(entry.path);
    const additive = event.ctrlKey || event.metaKey;
    if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1
        : Math.max(0, Math.min(visible.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      const path = visible[next];
      if (!additive || event.shiftKey) tree.selection = selectEntry(tree.selection, path, visible, event);
      void focusEntry(path);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault(); event.stopPropagation();
      if (entry.kind === 'directory' && entry.expanded === (event.key === 'ArrowLeft')) void actions.toggleProjectDirectory(entry.path);
      else if (event.key === 'ArrowRight' && entry.expanded && visibleEntries[index + 1]?.depth > entry.depth) void focusEntry(visible[index + 1]);
      else if (event.key === 'ArrowLeft') {
        const parent = [...visibleEntries.slice(0, index)].reverse().find(item => item.depth < entry.depth);
        if (parent) void focusEntry(parent.path);
      }
    } else if (event.key === ' ' && additive) {
      event.preventDefault();
      tree.focused = entry.path;
      tree.selection = selectEntry(tree.selection, entry.path, visible, event);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!tree.selection.paths.includes(entry.path)) singleSelection(entry.path);
      if (selectedEntries.length > 1) void actions.openProjectFiles(selectedEntries.filter(item => item.kind === 'document').map(item => item.path));
      else activate(entry, true);
    } else if (event.key === ' ') {
      event.preventDefault(); tree.selection = selectEntry(tree.selection, entry.path, visible, event);
    } else if (event.key === 'F2' && selectedEntries.length <= 1) {
      event.preventDefault(); beginRename(entry);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      if (!tree.selection.paths.includes(entry.path)) singleSelection(entry.path);
      trashTarget = [...selectedEntries];
    }
  }

  function keyRoot(event: KeyboardEvent) {
    keyTree(event);
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    actions.toggleProjectExplorerRoot();
  }

  function openMenu(event: MouseEvent, entry: VisibleProjectEntry | null) {
    event.preventDefault();
    if (busy) return;
    if (entry && !tree.selection.paths.includes(entry.path)) singleSelection(entry.path);
    if (!entry) tree.selection = { paths: [], anchor: '' };
    tree.focused = entry?.path ?? '';
    void refreshClipboard();
    menu = { x: event.clientX, y: event.clientY, entry };
  }

  function menuKey(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.stopPropagation(); menu = null; if (tree.focused) void focusEntry(tree.focused); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...popup?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  function startDrag(event: DragEvent, entry: VisibleProjectEntry) {
    if (busy || !event.dataTransfer) { event.preventDefault(); return; }
    if (!tree.selection.paths.includes(entry.path)) singleSelection(entry.path);
    dragged = topLevelPaths(selectedPaths());
    event.dataTransfer.setData(PROJECT_ENTRIES, JSON.stringify(dragged));
    event.dataTransfer.setData('application/x-setdown-project-entry', dragged[0]);
    const files = selectedEntries.filter(item => item.kind === 'document').map(item => item.path);
    if (files.length) {
      event.dataTransfer.setData(PROJECT_FILES, JSON.stringify(files));
      event.dataTransfer.setData('application/x-setdown-project-file', files[0]);
    }
    event.dataTransfer.effectAllowed = 'copyMove';
    if (dragged.length > 1) {
      dragImage = document.createElement('div'); dragImage.className = 'explorer-drag-label';
      dragImage.textContent = `${dragged.length} items`;
      document.body.append(dragImage); event.dataTransfer.setDragImage(dragImage, 12, 12);
    }
  }

  function endDrag() {
    dragged = []; dropTarget = ''; dragImage?.remove(); dragImage = null;
    clearTimeout(hoverTimer); hoverPath = ''; clearInterval(scrollTimer); scrollTimer = undefined;
  }

  function copy(value: string) {
    void navigator.clipboard.writeText(value).catch(() => {
      project.error = 'Could not copy the path to the clipboard.';
    });
  }

  function dragOver(event: DragEvent, target: string) {
    if (busy || !event.dataTransfer?.types.some(type => type === PROJECT_ENTRIES || type === 'application/x-setdown-project-entry')) return;
    event.preventDefault();
    const invalid = dragged.some(path => target === path || target.startsWith(`${path}/`) || target.startsWith(`${path}\\`));
    event.dataTransfer.dropEffect = invalid ? 'none' : event.ctrlKey || event.altKey ? 'copy' : 'move';
    dropTarget = invalid ? '' : target;
    if (hoverPath !== dropTarget) {
      clearTimeout(hoverTimer); hoverPath = dropTarget;
      const entry = visibleEntries.find(entry => entry.path === target);
      if (!invalid && entry?.kind === 'directory' && !entry.expanded) hoverTimer = setTimeout(() => actions.toggleProjectDirectory(target), 750);
    }
    if (treeElement) {
      const box = treeElement.getBoundingClientRect();
      scrollSpeed = event.clientY < box.top + 28 ? -12 : event.clientY > box.bottom - 28 ? 12 : 0;
      if (!scrollTimer) scrollTimer = setInterval(() => { if (treeElement) treeElement.scrollTop += scrollSpeed; }, 30);
    }
  }

  async function drop(event: DragEvent, target: string) {
    const sources = draggedPaths(event.dataTransfer, PROJECT_ENTRIES, 'application/x-setdown-project-entry');
    endDrag();
    if (busy || !sources.length) return;
    event.preventDefault(); event.stopPropagation();
    busy = true;
    try {
      if (event.ctrlKey || event.altKey) await actions.transferProjectEntries({ kind: 'copy', paths: sources, target });
      else {
        const paths = await actions.moveProjectEntries(sources, target);
        selectPaths(paths);
      }
    } catch { /* The controller displays the failure and leaves the tree.selection intact. */ }
    finally { busy = false; }
  }

  async function confirmTrash() {
    const paths = topLevelPaths(trashTarget?.map(entry => entry.path) ?? []);
    trashTarget = null; busy = true;
    try {
      for (const path of paths) { if (!await actions.trashProjectEntry(path)) break; }
      tree.selection = { paths: selectedPaths(), anchor: '' };
    } catch { /* Stop at the first failure; keep the controller's error visible. */ }
    finally { busy = false; }
  }
</script>

{#if (menu || trashTarget || pasteConflict) && project.visible && project.open}
  <NativeOverlay />
{/if}

<svelte:window onclick={() => menu = null} onkeydown={(event) => {
  if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229) { menu = null; editing = null; trashTarget = null; pasteConflict = null; }
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
    { label: 'Reveal Active File', disabled: !project.folder, run: () => void actions.revealActiveProjectEntry().then(() => { if (tree.focused) void focusEntry(tree.focused); }).catch(fail) },
    { label: filterOpen ? 'Hide Filter' : 'Filter Loaded Files…', disabled: !project.folder, run: () => { filterOpen = !filterOpen; if (!filterOpen) tree.filter = ''; } },
    { label: tree.showHidden ? 'Hide Hidden Files' : 'Show Hidden Files', run: () => tree.showHidden = !tree.showHidden },
    { label: tree.sort === 'name' ? 'Sort by Type' : 'Sort by Name', run: () => tree.sort = tree.sort === 'name' ? 'type' : 'name' },
  ]} />
</header>

{#if filterOpen}
  <input class="explorer-filter" bind:this={filterInput} bind:value={tree.filter} aria-label="Filter loaded files"
    placeholder="Filter loaded files…" onkeydown={event => { event.stopPropagation(); if (event.key === 'Escape' && !event.isComposing) { tree.filter = ''; filterOpen = false; } }} />
{/if}

{#if !project.folder}
  <div class="side-view-welcome">
    <p>Open a folder to browse and manage files.</p>
    <button type="button" onclick={actions.chooseProjectFolder}>Open Folder</button>
  </div>
{:else}
  <div class="explorer-root" class:is-drop-target={dropTarget === project.folder.path}
    title={project.folder.path} role="treeitem" tabindex="0" aria-selected="false"
    aria-expanded={project.explorerRootExpanded} aria-controls="project-explorer-tree"
    onclick={actions.toggleProjectExplorerRoot} onkeydown={keyRoot}
    onfocus={() => { tree.focused = project.folder!.path; tree.selection = { paths: [], anchor: '' }; }}
    oncontextmenu={(event) => openMenu(event, null)}
    ondragover={(event) => dragOver(event, project.folder!.path)}
    ondragleave={() => dropTarget = ''} ondrop={(event) => drop(event, project.folder!.path)}>
    <svg class:is-open={project.explorerRootExpanded} viewBox="0 0 16 16"><path d="m5 4 4 4-4 4"/></svg>
    <strong>{project.folder.name.toLocaleUpperCase()}</strong>
  </div>
  {#if project.explorerRootExpanded}
  <div id="project-explorer-tree" class="explorer-tree" role="tree" tabindex="-1" aria-label={project.folder.name}
    bind:this={treeElement} onscroll={() => { if (treeElement) tree.scroll = treeElement.scrollTop; }}
    aria-multiselectable="true" aria-busy={busy} onclick={clearSelection} onkeydown={keyTree}
    oncontextmenu={event => { if (event.target === event.currentTarget) openMenu(event, null); }}
    ondragover={event => { if (event.target === event.currentTarget) dragOver(event, project.folder!.path); }}
    ondrop={event => { if (event.target === event.currentTarget) void drop(event, project.folder!.path); }}>
    {#if editing?.mode === 'create' && editing.parent === project.folder.path}
      <ExplorerEditRow kind={editing.kind} depth={editing.depth} initial={editing.value}
        label={`New ${editing.kind} name`} submit={(value) => void submitEdit(value)} cancel={() => editing = null} />
    {/if}
    {#each visibleEntries as entry (entry.path)}
      {#if editing?.mode === 'rename' && editing.target === entry.path}
        <ExplorerEditRow kind={editing.kind} depth={editing.depth} initial={editing.value}
          label="Rename entry" submit={(value) => void submitEdit(value)} cancel={() => editing = null} />
      {:else}
        <div role="treeitem" tabindex={tree.focused === entry.path || (!visibleEntries.some(item => item.path === tree.focused) && entry === visibleEntries[0]) ? 0 : -1} draggable={!busy} class="explorer-row" data-path={entry.path}
          onfocus={() => tree.focused = entry.path}
          class:is-selected={tree.selection.paths.includes(entry.path)} class:is-muted={entry.kind === 'file'}
          class:is-cut={clipboard?.cut && clipboard.paths.some(path => under(entry.path, path))}
          class:is-drop-target={dropTarget === entry.path}
          aria-selected={tree.selection.paths.includes(entry.path)}
          aria-expanded={entry.kind === 'directory' ? entry.expanded : undefined}
          style:padding-left={`${8 + entry.depth * 13}px`} title={entry.path}
          onclick={(event) => clickEntry(event, entry)}
          ondblclick={(event) => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && entry.kind === 'document') activate(entry, true); }}
          onauxclick={(event) => { if (event.button === 1 && entry.kind === 'document') { event.preventDefault(); activate(entry, true); } }}
          onkeydown={(event) => keyEntry(event, entry)}
          oncontextmenu={(event) => openMenu(event, entry)} ondragstart={(event) => startDrag(event, entry)}
          ondragend={endDrag}
          ondragover={(event) => entry.kind === 'directory' && dragOver(event, entry.path)}
          ondragleave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) { dropTarget = ''; clearTimeout(hoverTimer); hoverPath = ''; scrollSpeed = 0; } }}
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
{/if}

{#if busy}<div class="explorer-status" role="status">Working on files…</div>{/if}

{#if menu}
  <div class="project-context-menu explorer-context-menu" role="menu" tabindex="-1" bind:this={popup} onkeydown={menuKey}
    style:left={`${menu.x}px`} style:top={`${menu.y}px`}>
    {#if !menu.entry || (menu.entry.kind === 'directory' && selectedEntries.length === 1)}
      <button type="button" role="menuitem" onclick={() => beginCreate('file', menu?.entry?.path ?? project.folder!.path)}>New File</button>
      <button type="button" role="menuitem" onclick={() => beginCreate('directory', menu?.entry?.path ?? project.folder!.path)}>New Folder</button>
      <span class="menu-separator"></span>
    {/if}
    {#if menu.entry}
      <button type="button" role="menuitem" onclick={() => void fileCommand('cut')}>Cut <kbd>Ctrl+X</kbd></button>
      <button type="button" role="menuitem" onclick={() => void fileCommand('copy')}>Copy <kbd>Ctrl+C</kbd></button>
    {/if}
    <button type="button" role="menuitem" disabled={!clipboard} onclick={() => void fileCommand('paste')}>Paste <kbd>Ctrl+V</kbd></button>
    {#if menu.entry}
      <button type="button" role="menuitem" onclick={() => void fileCommand('duplicate')}>Duplicate <kbd>Ctrl+D</kbd></button>
    {/if}
    <span class="menu-separator"></span>
    {#if menu.entry}
      {#if selectedEntries.some(entry => entry.kind === 'document')}<button type="button" role="menuitem"
        onclick={() => void actions.openProjectFiles(selectedEntries.filter(entry => entry.kind === 'document').map(entry => entry.path))}>Open</button>{/if}
      <button type="button" role="menuitem" onclick={() => copy(selectedPaths().join('\n'))}>Copy Path</button>
      <button type="button" role="menuitem" onclick={() => copy(selectedPaths().map(relativeToRoot).join('\n'))}>Copy Relative Path</button>
      <span class="menu-separator"></span>
      {#if selectedEntries.length === 1}<button type="button" role="menuitem" onclick={() => menu?.entry && beginRename(menu.entry)}>Rename <kbd>F2</kbd></button>{/if}
      <button type="button" role="menuitem" onclick={() => { trashTarget = [...selectedEntries]; menu = null; }}>Move to Trash <kbd>Del</kbd></button>
    {:else}
      <button type="button" role="menuitem" onclick={() => { menu = null; actions.refreshProjectExplorer(); }}>Refresh</button>
      <button type="button" role="menuitem" onclick={() => { menu = null; actions.collapseProjectExplorer(); }}>Collapse Folders</button>
      <span class="menu-separator"></span>
      <button type="button" role="menuitem" onclick={() => { menu = null; actions.chooseProjectFolder(); }}>Open Another Folder…</button>
    {/if}
    <span class="menu-separator"></span>
    <button type="button" role="menuitem" onclick={() => { const target = menu?.entry?.path ?? project.folder!.path; menu = null; void actions.explorer.reveal(target).catch(fail); }}>Reveal in File Manager</button>
    <button type="button" role="menuitem" onclick={() => { const target = createParent(); menu = null; actions.openProjectTerminal(target); }}>Open in Terminal</button>
  </div>
{/if}

{#if trashTarget}
  <div class="project-confirm" role="alertdialog" aria-modal="true" aria-labelledby="trash-title">
    <strong id="trash-title">Move {trashTarget.length === 1 ? `“${trashTarget[0].name}”` : `${topLevelPaths(trashTarget.map(entry => entry.path)).length} items`} to Trash?</strong>
    <span>You can restore it from the system Trash.</span>
    <div><button type="button" class="ghost" onclick={() => trashTarget = null}>Cancel</button>
      <button type="button" class="danger" onclick={() => void confirmTrash()}>Move to Trash</button></div>
  </div>
{/if}

{#if pasteConflict}
  <div class="project-confirm" role="alertdialog" aria-modal="true" aria-labelledby="paste-conflict-title">
    <strong id="paste-conflict-title">Some names already exist in this folder.</strong>
    <span>Keep both with new names, or skip existing items. No files have been replaced.</span>
    <div>
      <button type="button" class="ghost" onclick={() => pasteConflict = null}>Cancel</button>
      <button type="button" onclick={() => { const target = pasteConflict!; pasteConflict = null; void fileCommand('paste', 'skip', target); }}>Skip Existing</button>
      <button type="button" onclick={() => { const target = pasteConflict!; pasteConflict = null; void fileCommand('paste', 'keep-both', target); }}>Keep Both</button>
    </div>
  </div>
{/if}

<style>
  .is-cut > svg, .is-cut > span { opacity: .45; }
  .explorer-context-menu { max-height: calc(100vh - 12px); overflow-y: auto; min-width: 230px; }
  .explorer-filter { margin: 4px 8px; min-width: 0; }
  .explorer-status { padding: 6px 10px; font-size: 12px; color: var(--app-muted); }
</style>
