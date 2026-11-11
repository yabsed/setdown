<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { VList, type VListHandle } from 'virtua/svelte';
  import type { AppActions } from '../ports/ui-actions';
  import type { DesktopPort } from '../ports/desktop-port';
  import type { FileApplication, FileProperties, FolderEntry, FolderListing, FolderPlace, PathPickerRequest } from '../../protocol/files';
  import type { ExplorerClipboard, ExplorerEditCommand, ExplorerTransfer } from '../../protocol/explorer';
  import type { FolderView } from '../../core/workspace/workspace-state';
  import { folderCrumbs, formatModified, formatSize, kindLabel, presentFolder, type FolderSort } from '../../core/files/folder-presentation';
  import { acceptedPaths, activationAccepts, canAccept, canAcceptSelection, checkName, nameSelection, visibleInPicker, withFilterExtension } from '../../core/files/picker-rules';
  import { draggedPaths, PROJECT_ENTRIES, PROJECT_FILES, selectEntry, topLevelPaths, type ExplorerSelection } from '../project/explorer/explorer-selection';
  import { typeaheadMatch } from '../project/explorer/explorer-presentation';
  import { fileCommandTarget } from '../files/file-command-target';
  import { zoomState } from '../zoom-state.svelte';
  import { project } from '../project/project-state.svelte';
  import FileIcon from '../project/FileIcon.svelte';
  import NativeOverlay from '../shell/NativeOverlay.svelte';
  import { confirmationFocus } from '../shell/confirmation-focus';
  import FolderPlaces from './FolderPlaces.svelte';
  import FolderNameInput from './FolderNameInput.svelte';
  import FolderThumb from './FolderThumb.svelte';
  import FolderDialogs from './FolderDialogs.svelte';

  type TransferRequest = ExplorerTransfer | { kind: 'paste'; conflict?: ExplorerTransfer['conflict'] };
  type Tab = { id: string; path: string; view: FolderView; selection?: string[]; picker?: PathPickerRequest; revision: number };
  let { tab, active, focused, actions, desktop }: { tab: Tab; active: boolean; focused: boolean; actions: AppActions; desktop: DesktopPort } = $props();

  const token = crypto.randomUUID();
  const separator = $derived(tab.path.includes('\\') && !tab.path.includes('/') ? '\\' : '/');
  const join = (folder: string, name: string) => `${folder.replace(/[\\/]+$/, '')}${separator}${name}`;
  const parentOf = (path: string) => { const parent = path.replace(/[\\/][^\\/]+[\\/]?$/, ''); return parent || (separator === '/' ? '/' : path); };
  const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

  let listing = $state<FolderListing | null>(null);
  let loadError = $state(''), error = $state(''), loading = $state(false);
  let places = $state<FolderPlace[]>([]), home = $state('');
  let selection = $state<ExplorerSelection>({ paths: [], anchor: '' });
  let focusedPath = $state('');
  let filter = $state(''), filterOpen = $state(false);
  // Typing filters this folder at once; the same words then search its subfolders.
  let searchResults = $state<FolderEntry[] | null>(null), searching = $state(false), searchLimited = $state(false);
  let width = $state(900), listWidth = $state(700), placesOpen = $state(false);
  // Collapsing Places is a per-viewer preference shared by every folder tab.
  const PLACES_KEY = 'setdown:folder-places-collapsed';
  let placesCollapsed = $state((() => { try { return localStorage.getItem(PLACES_KEY) === 'true'; } catch { return false; } })());
  function togglePlaces() {
    if (narrow) { placesOpen = !placesOpen; return; }
    placesCollapsed = !placesCollapsed;
    try { localStorage.setItem(PLACES_KEY, String(placesCollapsed)); } catch { /* Storage is optional. */ }
  }
  let surface = $state<HTMLElement>(), crumbBar = $state<HTMLElement>(), filterInput = $state<HTMLInputElement>();
  let propertiesOf = $state<FileProperties | 'loading' | null>(null);
  let openWith = $state<{ paths: string[]; names: string[]; type: string; applications: FileApplication[] } | 'loading' | null>(null);
  let deleteTarget = $state<string[] | null>(null), emptyingTrash = $state(false);
  let busy = $state(false), progress = $state<{ completed: number; total: number; path: string } | null>(null);
  let clipboard = $state<ExplorerClipboard | null>(null);
  let menu = $state<{ x: number; y: number; entry: FolderEntry | null } | null>(null);
  let renaming = $state(''), creating = $state<'directory' | 'file' | null>(null);
  let trashTarget = $state<string[] | null>(null);
  let conflict = $state<{ request: TransferRequest } | null>(null);
  let replaceTarget = $state('');
  let dropTarget = $state('');
  let listElement = $state<HTMLDivElement>(), popup = $state<HTMLDivElement>(), nameInput = $state<HTMLInputElement>();
  let list = $state<VListHandle>();
  let generation = 0, appliedPath = '', appliedRevision = -1, typeahead = '', typedAt = 0, dragged: string[] = [];

  const picker = $derived(tab.picker);
  const ops = $derived(actions.folderFiles);
  let filterIndex = $state(0), saveName = $state('');
  const activeFilter = $derived(picker?.filters[filterIndex] ?? null);
  const scale = $derived((zoomState.tabs?.[tab.id] ?? 100) / 100);
  const rowHeight = $derived(Math.round(28 * scale));
  // Narrow panes (splits, small windows): the sidebar becomes a drawer and columns drop out.
  const narrow = $derived(width < 560);
  const sideVisible = $derived(narrow ? placesOpen : !placesCollapsed);
  const mainWidth = $derived(narrow || placesCollapsed ? width : width - Math.min(200, Math.max(150, width * .22)));
  const columnCount = $derived(mainWidth >= 660 ? 4 : mainWidth >= 400 ? 2 : 1);
  const grid = $derived(tab.view.layout === 'grid');
  const cellWidth = $derived(Math.round(116 * scale)), cellHeight = $derived(Math.round(124 * scale));
  const gridColumns = $derived(Math.max(1, Math.floor((listWidth - 16) / cellWidth)));
  const trashFolder = $derived(places.find(place => place.kind === 'trash')?.path ?? '');
  const inTrash = $derived(!!trashFolder && tab.path === trashFolder);
  const rows = $derived(searchResults
    ? presentFolder(searchResults, { ...tab.view, showHidden: true }, entry => !picker || visibleInPicker({ name: entry.name, directory: entry.kind === 'directory' }, picker, activeFilter))
    : listing ? presentFolder(listing.entries, tab.view, entry =>
      (!picker || visibleInPicker({ name: entry.name, directory: entry.kind === 'directory' }, picker, activeFilter))
      && (!filter || filter.toLocaleLowerCase().split(/\s+/).filter(Boolean).every(word => entry.name.toLocaleLowerCase().includes(word)))) : []);
  const lines = $derived.by(() => {
    if (!grid) return [];
    const result: FolderEntry[][] = [];
    for (let index = 0; index < rows.length; index += gridColumns) result.push(rows.slice(index, index + gridColumns));
    return result;
  });
  const bookmarked = $derived(places.some(place => place.kind === 'bookmark' && place.path === tab.path));
  const paths = $derived(rows.map(row => row.path));
  const indexes = $derived(new Map(paths.map((path, index) => [path, index])));
  const selected = $derived(new Set(selection.paths));
  const selectedEntries = $derived(rows.filter(row => selected.has(row.path)));
  const items = $derived(selectedEntries.map(entry => ({ path: entry.path, directory: entry.kind === 'directory' })));
  const crumbs = $derived(folderCrumbs(tab.path, home, places.filter(place => place.kind === 'mount').map(place => ({ path: place.path, name: place.name }))));
  const existing = $derived(picker?.kind === 'save' && listing ? listing.entries.find(entry => entry.name === withFilterExtension(saveName.trim(), picker.filters, activeFilter)) ?? null : null);
  const nameCheck = $derived(picker?.kind === 'save' ? checkName(saveName.trim(), existing ? { directory: existing.kind === 'directory' } : null, separator) : undefined);
  const acceptable = $derived(!!picker && canAccept(picker, items, { path: tab.path, virtual: inTrash }, nameCheck));
  const multiple = $derived(!picker || picker.multiple);
  /** Names exactly what Accept will return (Nautilus: the selection if it fits, else the current folder). */
  const choiceHint = $derived.by(() => {
    if (picker?.kind !== 'open') return '';
    const chosen = acceptedPaths(picker, items, { path: tab.path, virtual: inTrash });
    if (!chosen.length) return picker.files && !canAcceptSelection(picker, items) && items.length ? 'Choose a file' : '';
    return chosen.length === 1 ? `Choose “${chosen[0] === tab.path ? crumbs.at(-1)?.name ?? tab.path : chosen[0].split(/[\\/]/).at(-1)}”` : `Choose ${chosen.length} items`;
  });
  const owns = () => fileCommandTarget.owner === `folder:${tab.id}`;

  async function load(reason: 'navigate' | 'refresh') {
    const request = ++generation, path = tab.path;
    loading = true;
    try {
      const next = await desktop.files.list(path);
      if (request !== generation || path !== tab.path) return;
      listing = next; loadError = '';
      await tick();
      if (reason === 'navigate') {
        const wanted = (untrack(() => tab.selection) ?? []).filter(item => indexes.has(item));
        selection = { paths: multiple ? wanted : wanted.slice(0, 1), anchor: wanted[0] ?? '' };
        focusedPath = wanted[0] ?? paths[0] ?? '';
        if (wanted[0]) list?.scrollToIndex(grid ? Math.floor((indexes.get(wanted[0]) ?? 0) / gridColumns) : indexes.get(wanted[0]) ?? 0, { align: 'center' }); else list?.scrollTo(0);
      } else {
        selection = { paths: selection.paths.filter(item => indexes.has(item)), anchor: indexes.has(selection.anchor) ? selection.anchor : '' };
        if (!indexes.has(focusedPath)) focusedPath = selection.paths[0] ?? paths[0] ?? '';
      }
    } catch (failure) {
      if (request !== generation) return;
      listing = null; loadError = message(failure);
    } finally { if (request === generation) loading = false; }
  }

  // Navigation (path or requested selection) re-applies the tab's state.
  $effect(() => {
    const path = tab.path, revision = tab.revision;
    untrack(() => {
      if (path === appliedPath && revision === appliedRevision) return;
      const moved = path !== appliedPath;
      appliedPath = path; appliedRevision = revision;
      if (moved) { filter = ''; filterOpen = false; searchResults = null; renaming = ''; creating = null; menu = null; placesOpen = false; }
      void load('navigate');
    });
  });
  // Only a visible folder is watched; returning to it re-lists once.
  let wasActive = false;
  $effect(() => {
    const path = tab.path;
    if (!active) { wasActive = false; desktop.files.watch(token, null); return; }
    untrack(() => { if (!wasActive && listing) void load('refresh'); wasActive = true; });
    desktop.files.watch(token, path);
    return () => desktop.files.watch(token, null);
  });
  $effect(() => { const paths = selection.paths; untrack(() => actions.folderSelected(tab.id, [...paths])); });
  $effect(() => {
    if (!menu || !popup) return;
    const bounds = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(6, Math.min(menu.x, innerWidth - bounds.width - 6))}px`;
    popup.style.top = `${Math.max(6, Math.min(menu.y, innerHeight - bounds.height - 6))}px`;
    popup.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  });
  $effect(() => { if (picker?.kind === 'save') untrack(() => { if (!saveName) saveName = picker.name ?? ''; }); });

  async function refreshClipboard() { try { clipboard = await ops.clipboard(); } catch { clipboard = null; } }
  async function refreshPlaces() { try { places = await desktop.files.places(); } catch { /* The list still works without places. */ } }
  let nameSelected = false;
  function focusList() {
    if (picker?.kind === 'save' && nameInput) {
      nameInput.focus();
      if (!nameSelected) { nameSelected = true; const [start, end] = nameSelection(saveName); nameInput.setSelectionRange(start, end); }
      return;
    }
    listElement?.focus({ preventScroll: true });
  }

  onMount(() => {
    void desktop.files.home().then(value => { home = value; });
    // Activation may announce focus before this lazily loaded surface mounted.
    if (active && focused) void tick().then(focusList);
    void refreshPlaces(); void refreshClipboard();
    const stopChanges = desktop.files.onChanged(event => { if (event.token === token && active) void load('refresh'); });
    const stopProgress = ops.onProgress(value => { if (busy) progress = value; });
    const command = (event: Event) => { if (owns() && active) void fileCommand((event as CustomEvent<ExplorerEditCommand>).detail); };
    const focusRequest = (event: Event) => { if ((event as CustomEvent<string>).detail === tab.id) void tick().then(focusList); };
    const windowFocus = () => { void refreshClipboard(); void refreshPlaces(); };
    const resize = new ResizeObserver(() => { width = surface?.clientWidth || width; listWidth = listElement?.clientWidth || listWidth; });
    if (surface) resize.observe(surface);
    if (listElement) resize.observe(listElement);
    const propertiesRequest = (event: Event) => { if (active) showProperties((event as CustomEvent<string>).detail); };
    window.addEventListener('setdown:folder-properties', propertiesRequest);
    window.addEventListener('setdown:explorer-command', command);
    window.addEventListener('setdown:focus-folder', focusRequest);
    window.addEventListener('focus', windowFocus);
    return () => {
      stopChanges(); stopProgress(); desktop.files.watch(token, null); resize.disconnect();
      window.removeEventListener('setdown:folder-properties', propertiesRequest);
      if (owns()) { fileCommandTarget.owner = ''; actions.explorer.setEditTarget(false); }
      window.removeEventListener('setdown:explorer-command', command);
      window.removeEventListener('setdown:focus-folder', focusRequest);
      window.removeEventListener('focus', windowFocus);
    };
  });

  const navigate = (path: string, selectPaths?: string[]) => { error = ''; void actions.folderNavigate(tab.id, path, selectPaths).catch(failure => { error = message(failure); }); };
  const goUp = () => { const parent = parentOf(tab.path); if (parent !== tab.path) navigate(parent, [tab.path]); };
  const setView = (update: Partial<FolderView>) => actions.folderViewChanged(tab.id, update);
  const sortBy = (sort: FolderSort) => setView(tab.view.sort === sort ? { descending: !tab.view.descending } : { sort, descending: false });

  function select(path: string, event?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) {
    const modifiers = multiple ? event : undefined;
    selection = selectEntry(selection, path, paths, modifiers);
    focusedPath = path;
    if (picker?.kind === 'save') { const entry = rows[indexes.get(path) ?? -1]; if (entry && entry.kind !== 'directory') saveName = entry.name; }
  }
  function reveal(path: string) {
    const index = indexes.get(path);
    if (index === undefined || !list) return;
    const item = grid ? Math.floor(index / gridColumns) : index, height = grid ? cellHeight : rowHeight;
    const offset = list.getScrollOffset(), size = list.getViewportSize(), top = list.getItemOffset(item);
    if (top < offset || top + height > offset + size) list.scrollToIndex(item, { align: top < offset ? 'start' : 'end' });
  }
  function moveFocus(index: number, event: KeyboardEvent) {
    const path = paths[Math.max(0, Math.min(paths.length - 1, index))];
    if (!path) return;
    if (event.shiftKey && multiple) selection = selectEntry(selection, path, paths, { shiftKey: true, ctrlKey: event.ctrlKey || event.metaKey });
    else if (!(event.ctrlKey || event.metaKey)) select(path);
    focusedPath = path; reveal(path);
  }

  function activate(entry: FolderEntry, options: { side?: boolean } = {}) {
    if (entry.kind === 'directory') { navigate(entry.path); return; }
    if (picker?.kind === 'save') { saveName = entry.name; void accept(); return; }
    if (picker && activationAccepts(picker, { path: entry.path, directory: false })) { actions.pickerAccept(tab.id, [entry.path]); return; }
    // A file that cannot answer a folder request still opens, as in any file manager; the chooser stays.
    error = '';
    void actions.folderOpenEntries(tab.id, [entry], options).catch(failure => { error = message(failure); });
  }
  function openSelection(options: { side?: boolean; external?: boolean } = {}) {
    const entries = selectedEntries.length ? selectedEntries : rows.filter(row => row.path === focusedPath);
    if (entries.length === 1 && !options.external) { activate(entries[0], options); return; }
    const files = entries.filter(entry => entry.kind !== 'directory');
    if (picker && !options.external) { if (acceptable) void accept(); return; }
    if (files.length) void actions.folderOpenEntries(tab.id, files, options).catch(failure => { error = message(failure); });
  }

  async function accept() {
    if (!picker) return;
    if (picker.kind === 'save') {
      if (!nameCheck?.valid) return;
      const target = join(tab.path, withFilterExtension(saveName.trim(), picker.filters, activeFilter));
      if (existing && existing.kind !== 'directory' && replaceTarget !== target) { replaceTarget = target; return; }
      replaceTarget = '';
      actions.pickerAccept(tab.id, [target]);
      return;
    }
    const chosen = acceptedPaths(picker, items, { path: tab.path, virtual: inTrash });
    if (chosen.length) actions.pickerAccept(tab.id, chosen);
  }

  async function run<T>(operation: () => Promise<T>): Promise<T | undefined> {
    if (busy) return;
    busy = true; error = ''; progress = null;
    try { return await operation(); }
    catch (failure) { error = message(failure); return undefined; }
    finally { busy = false; progress = null; }
  }
  async function finish(result: { items: { status: string; to: string; error?: string }[]; warning?: string } | undefined) {
    if (!result) return;
    await load('refresh');
    const completed = result.items.filter(item => item.status === 'completed').map(item => item.to).filter(path => indexes.has(path));
    if (completed.length) { selection = { paths: completed, anchor: completed[0] }; focusedPath = completed[0]; reveal(completed[0]); }
    const failed = result.items.find(item => item.status === 'failed');
    if (failed) error = `${result.items.filter(item => item.status === 'completed').length} completed. ${failed.error} Remaining items were not changed.`;
    else if (result.warning) error = result.warning;
  }
  async function transfer(request: TransferRequest) {
    busy = true; error = ''; progress = null;
    try {
      const result = request.kind === 'paste' ? await ops.paste(tab.path, request.conflict) : await ops.transfer(request);
      busy = false; await finish(result); await refreshClipboard();
    } catch (failure) {
      error = message(failure);
      if (!request.conflict && /already exists/.test(error)) { conflict = { request }; error = ''; }
    } finally { busy = false; progress = null; }
  }
  async function fileCommand(command: ExplorerEditCommand | 'duplicate') {
    if (busy || renaming || creating) return;
    if (command === 'select-all') { if (multiple) selection = { paths: [...paths], anchor: focusedPath }; return; }
    if (picker) return;
    const sources = topLevelPaths(selection.paths);
    menu = null;
    if (command === 'cut' || command === 'copy') {
      if (!sources.length) return;
      await run(async () => { clipboard = await ops.setClipboard(sources, command === 'cut'); });
    } else if (command === 'paste') await transfer({ kind: 'paste' });
    else if (command === 'undo') await finish(await run(() => ops.undo()));
    else if (command === 'duplicate' && sources.length) await transfer({ kind: 'duplicate', paths: sources });
  }
  async function submitName(value: string) {
    const name = value.trim();
    if (!name) return;
    if (creating) {
      const kind = creating;
      const created = await run(() => ops.create(tab.path, name, kind));
      if (!created) return;
      creating = null; await load('refresh');
      if (indexes.has(created.path)) { select(created.path); reveal(created.path); }
    } else if (renaming) {
      const moved = await run(() => ops.rename(renaming, name));
      if (!moved) return;
      renaming = ''; await load('refresh');
      if (indexes.has(moved.to)) { select(moved.to); reveal(moved.to); }
    }
    void tick().then(focusList);
  }
  async function confirmTrash() {
    const targets = topLevelPaths(trashTarget ?? []);
    trashTarget = null;
    await run(() => ops.trash(targets));
    await load('refresh');
    void tick().then(focusList);
  }
  async function restore() {
    for (const path of topLevelPaths(selection.paths)) if (!await run(() => ops.restore(path))) break;
    await load('refresh');
  }
  function copyText(value: string) { void navigator.clipboard.writeText(value).catch(() => { error = 'Could not copy the path to the clipboard.'; }); }

  function key(event: KeyboardEvent) {
    if (event.target !== listElement || event.isComposing || event.keyCode === 229) return;
    const mod = event.ctrlKey || event.metaKey;
    const index = indexes.get(focusedPath) ?? -1;
    const step = grid ? gridColumns : 1;
    const page = Math.max(1, Math.floor((list?.getViewportSize() ?? rowHeight * 10) / (grid ? cellHeight : rowHeight)) - 1) * step;
    const handled = () => { event.preventDefault(); event.stopPropagation(); };
    if (busy && !['Escape'].includes(event.key)) return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key) && !event.altKey) {
      handled();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? paths.length - 1 : event.key === 'PageDown' ? index + page
        : event.key === 'PageUp' ? index - page : index + (event.key === 'ArrowDown' ? step : -step);
      moveFocus(index < 0 ? 0 : next, event);
    } else if (grid && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.altKey) {
      handled(); moveFocus(index < 0 ? 0 : index + (event.key === 'ArrowRight' ? 1 : -1), event);
    } else if (event.key === 'Enter' && event.altKey) { handled(); showProperties(selection.paths[0] ?? focusedPath ?? tab.path); }
    else if (mod && !event.shiftKey && event.key.toLowerCase() === 'i') { handled(); showProperties(selection.paths[0] ?? tab.path); }
    else if (mod && ['1', '2'].includes(event.key)) { handled(); setView({ layout: event.key === '1' ? 'list' : 'grid' }); }
    else if (event.key === 'Enter' && !event.altKey) { handled(); if (selection.paths.length || focusedPath) openSelection(); else if (picker) void accept(); }
    else if (event.key === 'Backspace' || (event.key === 'ArrowUp' && event.altKey)) { handled(); goUp(); }
    else if (event.key === ' ' && focusedPath) {
      handled();
      if (mod && multiple) selection = selectEntry(selection, focusedPath, paths, { ctrlKey: true }); else select(focusedPath);
    } else if (event.key === 'F2' && !picker && selection.paths.length <= 1 && focusedPath) { handled(); renaming = focusedPath; }
    else if (event.key === 'Delete' && !picker) {
      handled();
      const targets = selection.paths.length ? selection.paths : focusedPath ? [focusedPath] : [];
      if (!targets.length) return;
      if (event.shiftKey || inTrash) deleteTarget = targets; else trashTarget = targets;
    } else if (event.key === 'F5') { handled(); void load('refresh'); void refreshPlaces(); }
    else if (event.key === 'F9') { handled(); togglePlaces(); }
    else if (mod && !event.shiftKey && !event.altKey && ['c', 'x', 'v', 'a', 'z'].includes(event.key.toLowerCase())) {
      // Main normally reroutes these keys (window-manager.ts); this handles input that bypasses it.
      handled();
      void fileCommand(({ c: 'copy', x: 'cut', v: 'paste', a: 'select-all', z: 'undo' } as const)[event.key.toLowerCase() as 'c' | 'x' | 'v' | 'a' | 'z']);
    }
    else if (mod && event.key.toLowerCase() === 'h') { handled(); setView({ showHidden: !tab.view.showHidden }); }
    else if (mod && event.shiftKey && event.key.toLowerCase() === 'n') { handled(); creating = 'directory'; }
    else if (mod && !event.shiftKey && event.key.toLowerCase() === 'l') { handled(); window.dispatchEvent(new Event('setdown:focus-location')); }
    else if (mod && !event.shiftKey && event.key.toLowerCase() === 'd' && !picker) { handled(); void fileCommand('duplicate'); }
    else if (mod && !event.shiftKey && event.key.toLowerCase() === 'f') { handled(); openSearch(); }
    else if (event.key === 'Escape') {
      handled();
      if (narrow && placesOpen) placesOpen = false;
      else if (filter || searchResults) closeSearch();
      else if (picker) actions.pickerCancel(tab.id);
      else if (clipboard?.cut) void ops.clearClipboard().then(refreshClipboard);
      else selection = { paths: [], anchor: '' };
    } else if (!mod && !event.altKey && event.key.length === 1 && event.key !== ' ') {
      handled();
      const now = performance.now();
      typeahead = now - typedAt > 1000 ? event.key : typeahead + event.key; typedAt = now;
      const query = [...typeahead].every(char => char === typeahead[0]) ? typeahead[0] : typeahead;
      const match = typeaheadMatch(rows, focusedPath, query);
      if (match) { select(match); reveal(match); }
    }
  }

  function openMenu(event: MouseEvent, entry: FolderEntry | null) {
    event.preventDefault(); event.stopPropagation();
    if (busy) return;
    if (entry && !selected.has(entry.path)) select(entry.path);
    if (!entry) selection = { paths: [], anchor: '' };
    void refreshClipboard();
    menu = { x: event.clientX, y: event.clientY, entry };
  }
  function menuKey(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.stopPropagation(); menu = null; focusList(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...popup?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
  const menuRun = (action: () => void) => () => { menu = null; action(); };

  const copying = (event: DragEvent) => /Mac/i.test(navigator.platform) ? event.altKey : event.ctrlKey;
  function dragStart(event: DragEvent, entry: FolderEntry) {
    if (busy || picker || !event.dataTransfer) { event.preventDefault(); return; }
    if (!selected.has(entry.path)) select(entry.path);
    dragged = topLevelPaths(selection.paths);
    event.dataTransfer.setData(PROJECT_ENTRIES, JSON.stringify(dragged));
    event.dataTransfer.setData('application/x-setdown-project-entry', dragged[0]);
    const files = selectedEntries.filter(item => item.kind === 'document').map(item => item.path);
    if (files.length) { event.dataTransfer.setData(PROJECT_FILES, JSON.stringify(files)); event.dataTransfer.setData('application/x-setdown-project-file', files[0]); }
    event.dataTransfer.effectAllowed = 'copyMove';
  }
  function dragOver(event: DragEvent, target: string) {
    if (busy || picker || !event.dataTransfer?.types.some(type => type === 'Files' || type === PROJECT_ENTRIES)) return;
    const invalid = dragged.some(path => target === path || target.startsWith(`${path}/`) || target.startsWith(`${path}\\`));
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = invalid ? 'none' : event.dataTransfer.types.includes('Files') || copying(event) ? 'copy' : 'move';
    dropTarget = invalid ? '' : target;
  }
  async function drop(event: DragEvent, target: string) {
    const external = event.dataTransfer?.types.includes('Files') && !event.dataTransfer.types.includes(PROJECT_ENTRIES);
    const sources = external ? actions.pathsForDroppedFiles([...event.dataTransfer?.files ?? []])
      : draggedPaths(event.dataTransfer, PROJECT_ENTRIES, 'application/x-setdown-project-entry');
    dropTarget = ''; dragged = [];
    if (busy || picker || !sources.length) return;
    event.preventDefault(); event.stopPropagation();
    await transfer({ kind: external ? 'import' : copying(event) ? 'copy' : 'move', paths: sources, target });
  }

  function openSearch() { filterOpen = true; void tick().then(() => { filterInput?.focus(); filterInput?.select(); }); }
  function closeSearch() { filter = ''; filterOpen = false; searchResults = null; searching = false; desktop.files.cancelSearch(); focusList(); }
  // Recursive name search follows the instant filter after a short pause (Nautilus waits 500 ms).
  $effect(() => {
    const query = filter.trim(), root = tab.path, hidden = tab.view.showHidden;
    if (query.length < 2) { untrack(() => { searchResults = null; searching = false; }); return; }
    let current = true;
    const timer = setTimeout(() => {
      searching = true;
      void desktop.files.search(root, query, hidden).then(result => {
        if (!current) return;
        searchResults = result.entries; searchLimited = result.limitHit; searching = false;
      }, () => { if (current) searching = false; });
    }, 350);
    return () => { current = false; clearTimeout(timer); };
  });

  function showProperties(path: string) {
    if (!path) return;
    propertiesOf = 'loading';
    void desktop.files.properties(path).then(value => { if (propertiesOf === 'loading') propertiesOf = value; },
      failure => { propertiesOf = null; error = message(failure); });
  }
  function chooseApplication() {
    const files = selectedEntries.filter(entry => entry.kind !== 'directory');
    if (!files.length) return;
    openWith = 'loading';
    void desktop.files.applications(files[0].path).then(value => {
      if (openWith === 'loading') openWith = { paths: files.map(file => file.path), names: files.map(file => file.name), ...value };
    }, failure => { openWith = null; error = message(failure); });
  }
  function launchWith(id: string) {
    if (!openWith || openWith === 'loading') return;
    const paths = openWith.paths; openWith = null;
    void desktop.files.openWith(id, paths).catch(failure => { error = message(failure); });
  }
  async function confirmDelete() {
    const targets = topLevelPaths(deleteTarget ?? []);
    deleteTarget = null;
    await run(() => desktop.files.deletePermanently(targets));
    await load('refresh'); void tick().then(focusList);
  }
  async function confirmEmptyTrash() {
    emptyingTrash = false;
    await run(() => desktop.files.emptyTrash());
    await load('refresh');
  }
  async function archive(action: 'extract' | 'compress') {
    const targets = topLevelPaths(selection.paths);
    const created = await run(() => action === 'extract' ? desktop.files.extract(targets[0]) : desktop.files.compress(targets));
    await load('refresh');
    if (created && indexes.has(created)) { select(created); reveal(created); }
  }
  async function toggleBookmark(folder = tab.path, present = !bookmarked) {
    try { await desktop.files.setBookmark(folder, present); await refreshPlaces(); } catch (failure) { error = message(failure); }
  }
  async function mountPlace(place: FolderPlace) {
    if (!place.device) return;
    const mounted = await run(() => desktop.files.mount(place.device!));
    await refreshPlaces();
    if (mounted) navigate(mounted);
  }
  async function unmountPlace(place: FolderPlace) {
    if (!place.device) return;
    const inside = tab.path === place.path || tab.path.startsWith(`${place.path}/`);
    if (inside) navigate(home || '/');
    await run(() => desktop.files.unmount(place.device!));
    await refreshPlaces();
  }
  const isArchive = (name: string) => /\.(zip|7z|rar|tar|tgz|tbz2|txz|tar\.(gz|bz2|xz|zst))$/i.test(name);
  const relativeFolder = (path: string) => { const parent = parentOf(path); return parent === tab.path ? '' : parent.slice(tab.path.length).replace(/^[\\/]/, ''); };
  /** Shared pointer/drag behaviour of a row in list and grid layouts. */
  const rowEvents = (row: FolderEntry) => ({
    onclick: (event: MouseEvent) => { event.stopPropagation(); if (event.detail !== 2) { select(row.path, event); listElement?.focus({ preventScroll: true }); } },
    ondblclick: (event: MouseEvent) => { event.stopPropagation(); if (!event.ctrlKey && !event.metaKey && !event.shiftKey) activate(row); },
    onauxclick: (event: MouseEvent) => { if (event.button === 1 && row.kind === 'directory' && !picker) { event.preventDefault(); void actions.openFolder(row.path, { newTab: true }); } },
    oncontextmenu: (event: MouseEvent) => openMenu(event, row),
    ondragstart: (event: DragEvent) => dragStart(event, row),
    ondragend: () => { dragged = []; dropTarget = ''; },
    ondragover: (event: DragEvent) => dragOver(event, row.kind === 'directory' ? row.path : tab.path),
    ondrop: (event: DragEvent) => void drop(event, row.kind === 'directory' ? row.path : tab.path),
  });
  // Keep the current folder visible when the breadcrumb overflows.
  $effect(() => { void crumbs; void width; void tick().then(() => { if (crumbBar) crumbBar.scrollLeft = crumbBar.scrollWidth; }); });

  const optionId = (index: number) => `folder-${tab.id}-row-${index}`;
  const directoryIcon = 'M1.5 4.5h5l1.5 2h6.5v7h-13v-9Z';
</script>

{#if (menu || trashTarget || conflict || replaceTarget || deleteTarget || emptyingTrash || propertiesOf || openWith) && active}<NativeOverlay />{/if}
<svelte:window onclick={() => { if (menu) menu = null; }} />

{#snippet nameCell(row: FolderEntry)}
  {#if renaming === row.path}
    <FolderNameInput initial={row.name} label="Rename" directory={row.kind === 'directory'} submit={value => void submitName(value)} cancel={() => { renaming = ''; focusList(); }} />
  {:else}<span class="folder-label">{row.name}</span>{#if row.link}<span class="folder-link" title={row.link.broken ? 'Broken link' : 'Link'}>↗</span>{/if}{/if}
{/snippet}

<section class="folder-surface" bind:this={surface} data-folder-surface={tab.id} data-zoom-tab={tab.id} aria-label={picker ? picker.title : `Folder ${tab.path}`}
  style:--folder-font={`${13 * scale}px`} style:--folder-row={`${rowHeight}px`} style:--folder-cell-width={`${cellWidth}px`} style:--folder-cell-height={`${cellHeight}px`}
  class:picker={!!picker} class:narrow class:places-open={placesOpen} data-columns={columnCount}>
    <div class="folder-toolbar">
      <button class="folder-icon-button" type="button" aria-label={sideVisible ? 'Hide Places' : 'Show Places'} title={sideVisible ? 'Hide Places (F9)' : 'Show Places (F9)'}
        aria-pressed={sideVisible} onclick={togglePlaces}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM9.5 5v14"/></svg>
      </button>
      <button class="folder-icon-button" type="button" aria-label="Parent folder" title="Parent folder (Backspace)" disabled={parentOf(tab.path) === tab.path} onclick={goUp}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>
      </button>
      <nav class="folder-crumbs" aria-label="Folder path" bind:this={crumbBar}>
        {#each crumbs as crumb, index (crumb.path)}
          {#if index}<span aria-hidden="true">›</span>{/if}
          <button type="button" aria-current={index === crumbs.length - 1 ? 'location' : undefined} title={crumb.path}
            onclick={() => navigate(crumb.path)} ondragover={event => dragOver(event, crumb.path)} ondragleave={() => dropTarget = ''}
            ondrop={event => void drop(event, crumb.path)} class:drop-target={dropTarget === crumb.path}>{crumb.name}</button>
        {/each}
      </nav>
      {#if filterOpen}
        <input class="folder-filter" bind:this={filterInput} placeholder="Search this folder" aria-label="Search this folder and its subfolders" bind:value={filter} spellcheck="false"
          onkeydown={event => {
            event.stopPropagation();
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === 'Escape') closeSearch();
            else if (event.key === 'ArrowDown' || event.key === 'Enter') { event.preventDefault(); if (paths[0]) { select(paths[0]); } listElement?.focus({ preventScroll: true }); }
          }} />
      {/if}
      <button class="folder-icon-button" type="button" aria-label="Search" title="Search (Ctrl+F)" aria-pressed={filterOpen} onclick={() => { if (filterOpen) closeSearch(); else openSearch(); }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="m15.5 15.5 4.5 4.5"/></svg>
      </button>
      <button class="folder-icon-button" type="button" aria-label={grid ? 'List view' : 'Grid view'} title={grid ? 'List view (Ctrl+1)' : 'Grid view (Ctrl+2)'}
        onclick={() => setView({ layout: grid ? 'list' : 'grid' })}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={grid ? 'M4 6h16M4 12h16M4 18h16' : 'M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z'}/></svg>
      </button>
      {#if !picker || picker.kind === 'save' || picker.folders}
        <button class="folder-icon-button" type="button" aria-label="New Folder" title="New Folder (Ctrl+Shift+N)" disabled={!listing?.writable || inTrash} onclick={() => { creating = 'directory'; }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5h6l2 2h10v11H3zM12 11v6m-3-3h6"/></svg>
        </button>
      {/if}
      <button class="folder-icon-button optional" type="button" aria-label={tab.view.showHidden ? 'Hide Hidden Files' : 'Show Hidden Files'} title="Hidden files (Ctrl+H)"
        aria-pressed={tab.view.showHidden} onclick={() => setView({ showHidden: !tab.view.showHidden })}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.75"/>{#if !tab.view.showHidden}<path d="M4 20 20 4"/>{/if}</svg>
      </button>
      {#if inTrash && !picker}
        <button class="folder-text-button" type="button" disabled={!listing?.entries.length} onclick={() => { emptyingTrash = true; }}>Empty Trash</button>
      {/if}
    </div>
    {#if error || loadError}<p class="folder-error" role="alert">{error || loadError}<button type="button" aria-label="Dismiss" onclick={() => { error = ''; }}>×</button></p>{/if}
    <div class="folder-body">
    {#if sideVisible}
      <div class="folder-side">
      <FolderPlaces {places} current={tab.path} workspace={project.folder} navigate={path => { placesOpen = false; navigate(path); }}
        drop={picker ? undefined : (event, path) => void drop(event, path)} mount={place => void mountPlace(place)}
        unmount={place => void unmountPlace(place)} removeBookmark={place => void toggleBookmark(place.path, false)} />
      </div>
      {#if narrow}<button class="folder-scrim" type="button" aria-label="Close Places" onclick={() => { placesOpen = false; }}></button>{/if}
    {/if}
    <div class="folder-list" class:grid bind:this={listElement} data-folder-list={tab.id} role="listbox" tabindex="0" aria-label={`Contents of ${crumbs.at(-1)?.name ?? tab.path}`}
      aria-multiselectable={multiple} aria-busy={loading || busy || searching} aria-activedescendant={indexes.has(focusedPath) ? optionId(indexes.get(focusedPath)!) : undefined}
      onkeydown={key} oncontextmenu={event => openMenu(event, null)}
      onclick={event => { if (!(event.target as Element).closest('.folder-row, .folder-cell, .folder-columns, button, input')) { selection = { paths: [], anchor: '' }; listElement?.focus({ preventScroll: true }); } }}
      ondragover={event => dragOver(event, tab.path)} ondragleave={event => { if (event.target === event.currentTarget) dropTarget = ''; }} ondrop={event => void drop(event, tab.path)}>
      {#if !grid}
        <div class="folder-columns" role="presentation">
          {#each [['name', 'Name'], ['modified', 'Modified'], ['size', 'Size'], ['type', searchResults ? 'Folder' : 'Kind']] as [key, label] (key)}
            <button type="button" class={`column-${key}`} aria-pressed={tab.view.sort === key}
              aria-label={`Sort by ${label}${tab.view.sort === key ? (tab.view.descending ? ', descending' : ', ascending') : ''}`}
              onclick={() => sortBy(key as FolderSort)}>{label}{#if tab.view.sort === key}<span aria-hidden="true">{tab.view.descending ? '▾' : '▴'}</span>{/if}</button>
          {/each}
        </div>
      {/if}
      {#if creating}
        <div class="folder-row editing" role="presentation">
          <span class="folder-name"><svg class="folder-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d={creating === 'directory' ? directoryIcon : 'M3 1.5h6l4 4v9H3v-13Zm6 0v4h4'}/></svg>
            <FolderNameInput initial={creating === 'directory' ? 'New Folder' : 'Untitled.md'} label={creating === 'directory' ? 'New folder name' : 'New file name'} directory={creating === 'directory'}
              submit={value => void submitName(value)} cancel={() => { creating = null; focusList(); }} /></span>
        </div>
      {/if}
      {#if (listing || searchResults) && !rows.length}
        <p class="folder-empty">{searching ? 'Searching…' : filter ? 'No items match.' : listing?.entries.length ? 'Only hidden items are here.' : inTrash ? 'Trash is empty.' : 'This folder is empty.'}</p>
      {/if}
      {#if grid}
        <VList bind:this={list} data={lines} getKey={line => line[0].path} itemSize={cellHeight} class="folder-rows">
          {#snippet children(line, lineIndex)}
            <div class="folder-line" role="presentation">
              {#each line as row, column (row.path)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div role="option" tabindex="-1" id={optionId(lineIndex * gridColumns + column)} class="folder-cell" data-path={row.path} data-kind={row.kind}
                  class:selected={selected.has(row.path)} class:focused={row.path === focusedPath && focused}
                  class:cut={clipboard?.cut && clipboard.paths.includes(row.path)} class:hidden-entry={row.hidden}
                  class:drop-target={dropTarget === row.path} aria-selected={selected.has(row.path)} title={row.path}
                  draggable={!picker && !busy && renaming !== row.path} {...rowEvents(row)}>
                  <FolderThumb entry={row} load={path => desktop.files.thumbnail(path)} />
                  <span class="folder-cell-name">{@render nameCell(row)}</span>
                </div>
              {/each}
            </div>
          {/snippet}
        </VList>
      {:else}
        <VList bind:this={list} data={rows} getKey={row => row.path} itemSize={rowHeight} class="folder-rows">
          {#snippet children(row, index)}
            <!-- Rows are aria-activedescendant options; the listbox owns keyboard input (WAI-ARIA listbox pattern). -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div role="option" tabindex="-1" id={optionId(index)} class="folder-row" data-path={row.path} data-kind={row.kind}
              class:selected={selected.has(row.path)} class:focused={row.path === focusedPath && focused}
              class:cut={clipboard?.cut && clipboard.paths.includes(row.path)} class:hidden-entry={row.hidden}
              class:drop-target={dropTarget === row.path} aria-selected={selected.has(row.path)}
              title={row.link ? `${row.path} → ${row.link.target}` : row.path} draggable={!picker && !busy && renaming !== row.path} {...rowEvents(row)}>
              <span class="folder-name">
                {#if row.kind === 'directory'}<svg class="folder-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d={directoryIcon}/></svg>{:else}<FileIcon path={row.path} />{/if}
                {@render nameCell(row)}
              </span>
              <span class="column-modified">{formatModified(row.modified)}</span>
              <span class="column-size">{row.kind === 'directory' ? '' : formatSize(row.size)}</span>
              <span class="column-type">{searchResults ? relativeFolder(row.path) || '.' : kindLabel(row)}</span>
            </div>
          {/snippet}
        </VList>
      {/if}
    </div>
    </div>
    <footer class="folder-status" aria-live="polite">
      {#if busy}
        <span>{progress ? `${progress.completed}/${progress.total} · ${progress.path.split(/[\\/]/).at(-1)}` : 'Working on files…'}</span>
        <button type="button" onclick={() => ops.cancel()}>Cancel</button>
      {:else}
        <span>{loading && !listing ? 'Loading…' : searching ? 'Searching subfolders…' : `${rows.length} ${rows.length === 1 ? 'item' : 'items'}${searchResults ? ' found' : ''}`}{selection.paths.length ? ` · ${selection.paths.length} selected` : ''}{searchResults && searchLimited ? ' · more matches exist; refine the search' : ''}{listing?.truncated ? ' · showing the first 100,000' : ''}{listing && !listing.writable ? ' · read-only' : ''}</span>
      {/if}
    </footer>
    {#if picker}
      <form class="folder-picker-bar" aria-label={picker.title} onsubmit={event => { event.preventDefault(); void accept(); }}>
        {#if picker.kind === 'save'}
          <label class="picker-name"><span>Name</span>
            <input bind:this={nameInput} bind:value={saveName} aria-label="File name" spellcheck="false" autocomplete="off"
              aria-invalid={nameCheck && !nameCheck.valid && !!saveName} oninput={() => { replaceTarget = ''; }}
              onkeydown={event => { if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); actions.pickerCancel(tab.id); } }} />
          </label>
        {/if}
        {#if picker.filters.length}
          <select aria-label="File type" bind:value={filterIndex}>
            {#each picker.filters as option, index (index)}<option value={index}>{option.name}</option>{/each}
          </select>
        {/if}
        <span class="picker-feedback" role="status">{nameCheck?.message ?? nameCheck?.warning ?? choiceHint}</span>
        <button type="button" class="ghost" onclick={() => actions.pickerCancel(tab.id)}>Cancel</button>
        <button type="submit" class="primary" disabled={!acceptable}>{picker.buttonLabel ?? (picker.kind === 'save' ? 'Save' : picker.folders && !picker.files ? 'Select Folder' : 'Open')}</button>
      </form>
    {/if}
</section>

{#if menu}
  <div class="project-context-menu folder-context-menu" role="menu" tabindex="-1" bind:this={popup} onkeydown={menuKey} style:left={`${menu.x}px`} style:top={`${menu.y}px`}>
    {#if menu.entry}
      {@const entry = menu.entry}
      {@const single = selectedEntries.length === 1}
      <button type="button" role="menuitem" onclick={menuRun(() => openSelection())}>{picker && acceptable && entry.kind !== 'directory' ? 'Choose' : 'Open'}</button>
      {#if !picker && single && entry.kind === 'directory'}
        <button type="button" role="menuitem" onclick={menuRun(() => void actions.openFolder(entry.path, { newTab: true }))}>Open in New Tab</button>
        <button type="button" role="menuitem" onclick={menuRun(() => void actions.openFolder(entry.path, { side: true, newTab: true }))}>Open to the Side</button>
      {:else if !picker && single && entry.kind === 'document'}
        <button type="button" role="menuitem" onclick={menuRun(() => openSelection({ side: true }))}>Open to the Side</button>
      {/if}
      {#if selectedEntries.some(item => item.kind !== 'directory')}
        <button type="button" role="menuitem" onclick={menuRun(() => openSelection({ external: true }))}>Open with Default Application</button>
        <button type="button" role="menuitem" onclick={menuRun(chooseApplication)}>Open With…</button>
      {/if}
      {#if searchResults && single}
        <button type="button" role="menuitem" onclick={menuRun(() => { const target = entry.path; closeSearch(); navigate(parentOf(target), [target]); })}>Open Item Location</button>
      {/if}
      {#if !picker}
        <span class="menu-separator"></span>
        <button type="button" role="menuitem" onclick={() => void fileCommand('cut')}>Cut <kbd>Ctrl+X</kbd></button>
        <button type="button" role="menuitem" onclick={() => void fileCommand('copy')}>Copy <kbd>Ctrl+C</kbd></button>
        <button type="button" role="menuitem" onclick={() => void fileCommand('duplicate')}>Duplicate <kbd>Ctrl+D</kbd></button>
        <button type="button" role="menuitem" onclick={menuRun(() => copyText(selection.paths.join('\n')))}>Copy Path</button>
        <span class="menu-separator"></span>
        {#if single}<button type="button" role="menuitem" onclick={menuRun(() => { renaming = entry.path; })}>Rename <kbd>F2</kbd></button>{/if}
        {#if single && entry.kind !== 'directory' && isArchive(entry.name)}
          <button type="button" role="menuitem" onclick={menuRun(() => void archive('extract'))}>Extract Here</button>
        {/if}
        <button type="button" role="menuitem" onclick={menuRun(() => void archive('compress'))}>Compress to .zip</button>
        {#if inTrash}
          <button type="button" role="menuitem" onclick={menuRun(() => void restore())}>Restore</button>
        {:else}
          <button type="button" role="menuitem" onclick={menuRun(() => { trashTarget = [...selection.paths]; })}>Move to Trash <kbd>Del</kbd></button>
        {/if}
        <button type="button" role="menuitem" onclick={menuRun(() => { deleteTarget = [...selection.paths]; })}>Delete Permanently <kbd>Shift+Del</kbd></button>
        <span class="menu-separator"></span>
        {#if single && entry.kind === 'directory'}
          <button type="button" role="menuitem" onclick={menuRun(() => void toggleBookmark(entry.path, !places.some(place => place.kind === 'bookmark' && place.path === entry.path)))}>{places.some(place => place.kind === 'bookmark' && place.path === entry.path) ? 'Remove Bookmark' : 'Add to Bookmarks'}</button>
          <button type="button" role="menuitem" onclick={menuRun(() => void actions.folderOpenWorkspace(entry.path))}>Open as Workspace Folder</button>
        {/if}
        <button type="button" role="menuitem" onclick={menuRun(() => actions.folderOpenTerminal(entry.kind === 'directory' ? entry.path : parentOf(entry.path)))}>Open in Terminal</button>
      {/if}
      {#if single}
        <span class="menu-separator"></span>
        <button type="button" role="menuitem" onclick={menuRun(() => showProperties(entry.path))}>Properties <kbd>Alt+Enter</kbd></button>
      {/if}
    {:else}
      {#if !picker || picker.kind === 'save' || picker.folders}
        <button type="button" role="menuitem" disabled={!listing?.writable || inTrash} onclick={menuRun(() => { creating = 'directory'; })}>New Folder <kbd>Ctrl+Shift+N</kbd></button>
      {/if}
      {#if !picker}
        <button type="button" role="menuitem" disabled={!listing?.writable || inTrash} onclick={menuRun(() => { creating = 'file'; })}>New File</button>
        <button type="button" role="menuitem" disabled={!clipboard || !listing?.writable} onclick={() => void fileCommand('paste')}>Paste <kbd>Ctrl+V</kbd></button>
        <button type="button" role="menuitem" onclick={() => void fileCommand('undo')}>Undo File Operation <kbd>Ctrl+Z</kbd></button>
        <button type="button" role="menuitem" onclick={() => void fileCommand('select-all')}>Select All <kbd>Ctrl+A</kbd></button>
      {/if}
      <span class="menu-separator"></span>
      <button type="button" role="menuitemradio" aria-checked={!grid} onclick={menuRun(() => setView({ layout: 'list' }))}>List View <kbd>Ctrl+1</kbd></button>
      <button type="button" role="menuitemradio" aria-checked={grid} onclick={menuRun(() => setView({ layout: 'grid' }))}>Grid View <kbd>Ctrl+2</kbd></button>
      <button type="button" role="menuitemcheckbox" aria-checked={tab.view.showHidden} onclick={menuRun(() => setView({ showHidden: !tab.view.showHidden }))}>Show Hidden Files <kbd>Ctrl+H</kbd></button>
      {#each [['name', 'Name'], ['modified', 'Modified'], ['size', 'Size'], ['type', 'Kind']] as [key, label] (key)}
        <button type="button" role="menuitemradio" aria-checked={tab.view.sort === key} onclick={menuRun(() => setView({ sort: key as FolderSort }))}>Sort by {label}</button>
      {/each}
      <button type="button" role="menuitemcheckbox" aria-checked={tab.view.descending} onclick={menuRun(() => setView({ descending: !tab.view.descending }))}>Reverse Order</button>
      <button type="button" role="menuitem" onclick={menuRun(() => { void load('refresh'); void refreshPlaces(); })}>Refresh <kbd>F5</kbd></button>
      {#if !picker}
        <span class="menu-separator"></span>
        {#if inTrash}
          <button type="button" role="menuitem" disabled={!listing?.entries.length} onclick={menuRun(() => { emptyingTrash = true; })}>Empty Trash</button>
        {:else}
          <button type="button" role="menuitem" onclick={menuRun(() => void toggleBookmark())}>{bookmarked ? 'Remove Bookmark' : 'Bookmark This Folder'}</button>
          <button type="button" role="menuitem" onclick={menuRun(() => void actions.folderOpenWorkspace(tab.path))}>Open as Workspace Folder</button>
        {/if}
        <button type="button" role="menuitem" onclick={menuRun(() => actions.folderOpenTerminal(tab.path))}>Open in Terminal</button>
        <button type="button" role="menuitem" onclick={menuRun(() => copyText(tab.path))}>Copy Folder Path</button>
      {/if}
      <span class="menu-separator"></span>
      <button type="button" role="menuitem" onclick={menuRun(() => showProperties(tab.path))}>Properties</button>
    {/if}
  </div>
{/if}

{#if trashTarget}
  <div class="project-confirm" role="alertdialog" aria-modal="true" aria-labelledby={`folder-trash-${tab.id}`} use:confirmationFocus={() => { trashTarget = null; }}>
    <strong id={`folder-trash-${tab.id}`}>Move {trashTarget.length === 1 ? `“${trashTarget[0].split(/[\\/]/).at(-1)}”` : `${topLevelPaths(trashTarget).length} items`} to Trash?</strong>
    <span>You can restore it from Trash.</span>
    <div><button type="button" class="ghost" onclick={() => { trashTarget = null; focusList(); }}>Cancel</button>
      <button type="button" class="danger" onclick={() => void confirmTrash()}>Move to Trash</button></div>
  </div>
{/if}
{#if deleteTarget}
  <div class="project-confirm" role="alertdialog" aria-modal="true" aria-labelledby={`folder-delete-${tab.id}`} use:confirmationFocus={() => { deleteTarget = null; }}>
    <strong id={`folder-delete-${tab.id}`}>Permanently delete {deleteTarget.length === 1 ? `“${deleteTarget[0].split(/[\\/]/).at(-1)}”` : `${topLevelPaths(deleteTarget).length} items`}?</strong>
    <span>This cannot be undone.</span>
    <div><button type="button" class="ghost" onclick={() => { deleteTarget = null; focusList(); }}>Cancel</button>
      <button type="button" class="danger" onclick={() => void confirmDelete()}>Delete Permanently</button></div>
  </div>
{/if}
{#if emptyingTrash}
  <div class="project-confirm" role="alertdialog" aria-modal="true" aria-labelledby={`folder-empty-${tab.id}`} use:confirmationFocus={() => { emptyingTrash = false; }}>
    <strong id={`folder-empty-${tab.id}`}>Permanently delete all items in Trash?</strong>
    <span>This cannot be undone.</span>
    <div><button type="button" class="ghost" onclick={() => { emptyingTrash = false; }}>Cancel</button>
      <button type="button" class="danger" onclick={() => void confirmEmptyTrash()}>Empty Trash</button></div>
  </div>
{/if}
{#if conflict}
  <div class="project-confirm" role="alertdialog" aria-modal="true" aria-labelledby={`folder-conflict-${tab.id}`} use:confirmationFocus={() => { conflict = null; }}>
    <strong id={`folder-conflict-${tab.id}`}>Some names already exist in this folder.</strong>
    <span>Keep both with new names, or skip existing items. No files have been replaced.</span>
    <div>
      <button type="button" class="ghost" onclick={() => { conflict = null; }}>Cancel</button>
      <button type="button" onclick={() => { const request = conflict!.request; conflict = null; void transfer({ ...request, conflict: 'skip' }); }}>Skip Existing</button>
      <button type="button" onclick={() => { const request = conflict!.request; conflict = null; void transfer({ ...request, conflict: 'keep-both' }); }}>Keep Both</button>
    </div>
  </div>
{/if}
{#if replaceTarget}
  <div class="project-confirm" role="alertdialog" aria-modal="true" aria-labelledby={`folder-replace-${tab.id}`} use:confirmationFocus={() => { replaceTarget = ''; }}>
    <strong id={`folder-replace-${tab.id}`}>Replace “{replaceTarget.split(/[\\/]/).at(-1)}”?</strong>
    <span>A file with that name already exists. Replacing it overwrites its contents.</span>
    <div><button type="button" class="ghost" onclick={() => { replaceTarget = ''; nameInput?.focus(); }}>Cancel</button>
      <button type="button" class="danger" onclick={() => void accept()}>Replace</button></div>
  </div>
{/if}
<FolderDialogs properties={propertiesOf} openWith={openWith} close={() => { propertiesOf = null; openWith = null; }} launch={launchWith} />

<style>
  /* Column flex: the toolbar spans the pane, so its Places toggle is never covered.
     The error line and picker bar are optional children; only the body stretches. */
  .folder-surface { display: flex; flex-direction: column; height: 100%; min-width: 0; min-height: 0; overflow: hidden; background: var(--app-canvas); color: var(--app-text);
    font: var(--folder-font)/1.4 var(--app-font-family); }
  .folder-surface > * { flex: 0 0 auto; }
  .folder-surface > .folder-body { position: relative; display: flex; flex: 1 1 0; min-width: 0; min-height: 0; }
  .folder-side { display: flex; flex: 0 0 clamp(150px, 22%, 200px); min-height: 0; }
  .folder-side > :global(*) { flex: 1; min-width: 0; }
  /* In a narrow pane Places is a drawer over the list only; the scrim beside it closes it. */
  .narrow .folder-side { position: absolute; z-index: 6; inset: 0 auto 0 0; width: min(210px, 72%); box-shadow: 6px 0 18px rgb(0 0 0 / .16); }
  .folder-scrim { position: absolute; z-index: 5; inset: 0; padding: 0; border: 0; background: rgb(0 0 0 / .12); cursor: default; }
  .folder-body > .folder-list { flex: 1 1 0; min-width: 0; }
  .folder-toolbar { display: flex; align-items: center; gap: 4px; min-width: 0; padding: 6px 10px; border-bottom: 1px solid var(--app-border); }
  .folder-crumbs { display: flex; align-items: center; gap: 2px; flex: 1 1 60px; min-width: 40px; overflow-x: auto; scrollbar-width: none; white-space: nowrap; }
  .folder-crumbs button { flex: 0 0 auto; height: 26px; padding: 0 7px; border: 0; border-radius: 5px; background: transparent; color: var(--app-muted-text); font: inherit; cursor: pointer; }
  .folder-crumbs button[aria-current] { color: var(--app-text); font-weight: 600; }
  .folder-crumbs button:hover, .folder-crumbs button.drop-target { background: var(--app-hover); }
  .folder-crumbs span { color: var(--app-muted-text); opacity: .6; }
  .folder-icon-button { display: grid; place-items: center; flex: 0 0 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--app-muted-text); cursor: pointer; }
  .folder-icon-button:hover, .folder-icon-button[aria-pressed="true"] { background: var(--app-hover); color: var(--app-text); }
  .folder-icon-button:disabled { opacity: .35; cursor: default; }
  .folder-icon-button svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .folder-text-button { flex: 0 0 auto; height: 28px; padding: 0 10px; border: 1px solid var(--app-border); border-radius: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
  .folder-text-button:disabled { opacity: .4; cursor: default; }
  .narrow .folder-icon-button.optional { display: none; }
  .folder-filter { flex: 1 1 120px; min-width: 70px; max-width: 240px; height: 26px; padding: 0 8px; border: 1px solid var(--app-border); border-radius: 5px; background: var(--app-canvas); color: inherit; font: inherit; }
  .folder-error { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0; padding: 6px 12px; color: #b94f4f; border-bottom: 1px solid var(--app-border); overflow-wrap: anywhere; }
  .folder-error button { border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 16px; }
  /* A column flex box gives the virtual list a definite height whether or not
     the optional create row or empty message is present. */
  .folder-list { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; outline: none; }
  .folder-list:focus-visible { box-shadow: inset 0 0 0 1px var(--app-focus-ring, var(--app-muted-text)); }
  .folder-list > * { flex: 0 0 auto; }
  .folder-list :global(.folder-rows) { flex: 1 1 0; min-height: 0; }
  .folder-columns, .folder-row { display: grid; grid-template-columns: minmax(0, 1fr) 9.5em 6.5em 9em; align-items: center; column-gap: 12px; padding: 0 12px; }
  [data-columns="2"] :is(.folder-columns, .folder-row) { grid-template-columns: minmax(0, 1fr) 7.5em; }
  [data-columns="1"] :is(.folder-columns, .folder-row) { grid-template-columns: minmax(0, 1fr); }
  [data-columns="2"] :is(.column-size, .column-type), [data-columns="1"] :is(.column-size, .column-type, .column-modified) { display: none; }
  .folder-columns { height: 28px; border-bottom: 1px solid var(--app-border); }
  .folder-columns button { height: 100%; min-width: 0; padding: 0; overflow: hidden; border: 0; background: transparent; color: var(--app-muted-text); font: 600 calc(var(--folder-font) * .9)/1 var(--app-font-family); text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
  .folder-columns button:hover { color: var(--app-text); }
  .folder-columns span { margin-left: 4px; }
  .folder-row { height: var(--folder-row); border-radius: 5px; margin: 0 4px; cursor: default; user-select: none; }
  .folder-row:hover, .folder-cell:hover { background: var(--app-hover); }
  .folder-row.selected, .folder-cell.selected { background: var(--app-selected); }
  .folder-row.focused, .folder-cell.focused { box-shadow: inset 0 0 0 1px var(--app-focus-ring, var(--app-muted-text)); }
  .folder-row.drop-target, .folder-cell.drop-target { box-shadow: inset 0 0 0 1px var(--app-accent); }
  .folder-row.cut, .folder-row.hidden-entry, .folder-cell.cut, .folder-cell.hidden-entry { opacity: .55; }
  .folder-name { display: flex; align-items: center; gap: 8px; min-width: 0; height: 100%; }
  .folder-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .folder-link { color: var(--app-muted-text); font-size: .85em; }
  .folder-glyph { flex: 0 0 16px; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.2; stroke-linejoin: round; color: var(--app-muted-text); }
  .column-modified, .column-size, .column-type { overflow: hidden; color: var(--app-muted-text); text-overflow: ellipsis; white-space: nowrap; font-size: .92em; }
  .column-size { text-align: right; }
  .folder-columns .column-size { text-align: right; }
  .folder-line { display: flex; height: var(--folder-cell-height); padding: 0 8px; }
  .folder-cell { display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 4px; flex: 0 0 var(--folder-cell-width); width: var(--folder-cell-width); height: calc(var(--folder-cell-height) - 4px);
    padding: 8px 6px 6px; box-sizing: border-box; border-radius: 8px; cursor: default; user-select: none; }
  .folder-cell-name { display: flex; justify-content: center; min-width: 0; max-height: 2.8em; overflow: hidden; text-align: center; }
  .folder-cell-name :global(.folder-label) { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; white-space: normal; overflow-wrap: anywhere; line-height: 1.35; }
  .folder-empty { margin: 24px; color: var(--app-muted-text); text-align: center; }
  .folder-status { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 26px; padding: 0 12px; border-top: 1px solid var(--app-border); color: var(--app-muted-text); font-size: .9em; }
  .folder-status span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .folder-status button { border: 0; background: transparent; color: var(--app-text); cursor: pointer; }
  .folder-picker-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--app-border); background: var(--app-chrome); }
  .picker-name { display: flex; align-items: center; gap: 8px; flex: 1 1 220px; min-width: 0; }
  .picker-name span { color: var(--app-muted-text); }
  .picker-name input, .folder-picker-bar select { min-width: 0; height: 30px; padding: 0 8px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-canvas); color: inherit; font: inherit; }
  .picker-name input { flex: 1; }
  .picker-name input[aria-invalid="true"] { border-color: #b94f4f; }
  .folder-picker-bar select { max-width: 100%; }
  .picker-feedback { flex: 1 1 80px; min-width: 0; overflow: hidden; color: var(--app-muted-text); text-overflow: ellipsis; white-space: nowrap; }
  .folder-picker-bar button { flex: 0 0 auto; height: 30px; padding: 0 14px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-canvas); color: inherit; font: inherit; cursor: pointer; }
  .folder-picker-bar button.primary { border-color: transparent; background: var(--app-accent); color: var(--app-accent-text, #fff); }
  .folder-picker-bar button:disabled { opacity: .45; cursor: default; }
  .folder-context-menu { max-height: calc(100vh - 12px); overflow-y: auto; min-width: 230px; }
</style>
