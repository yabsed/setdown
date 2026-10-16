<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type * as M from 'monaco-editor';
  import type { NotebookEntry } from './notebook-store';
  import type { DesktopPort } from '../ports/desktop-port';
  import type { PreviewThemeId } from '../../core/preview/preview-preferences';
  import { registerMonacoThemes, monacoThemeName } from '../theme';
  import { textZoomFactor, onTextZoom } from '../editor/text-zoom';
  import { NotebookLanguage } from './notebook-language';
  import type { NotebookEnvironments } from '../../protocol/notebook';
  import { NotebookExecution } from './notebook-execution';
  import NotebookCell from './NotebookCell.svelte';
  let { entry, path, active, desktop, onfocus, openFile }: { entry: NotebookEntry; path: string; active: boolean; desktop: DesktopPort; openFile(path: string, selection?: M.IRange | M.IPosition): Promise<void>; onfocus(): void } = $props();
  let api = $state.raw<typeof M | null>(null), revision = $state(0), loadError = $state('');
  let theme = $state<PreviewThemeId>('github-light'), language = $state(''), factor = $state(1);
  let reveal = $state<{ id: string; range: M.IRange; sequence: number; edit?: boolean }>();
  let search = $state(''), searchOpen = $state(false), searchInput = $state<HTMLInputElement>(), matchIndex = $state(-1);
  let controllerRevision = $state(0), scroll = $state<HTMLDivElement>();
  let environments = $state<NotebookEnvironments>({ candidates: [] }), environmentReady = $state(false), actionError = $state('');
  let dragTimer: ReturnType<typeof setInterval> | undefined, dragY = 0;
  const controller = $derived(entry.controller);
  const selected = $derived.by(() => { void controllerRevision; return new Set(controller.selected); });
  const selectedPython = $derived.by(() => { void executionRevision; return execution?.selectedPython; });
  async function refreshEnvironments() {
    try { environments = await desktop.notebook.environments(path); await execution?.loadEnvironment(); }
    catch (error) { actionError = String(error); }
    finally { environmentReady = true; }
  }
  async function chooseEnvironment(value: string) {
    try {
      actionError = '';
      if (value === '__choose__') await execution?.choosePython(); else if (value) await execution?.selectPython(value);
      await refreshEnvironments();
    } catch (error) { actionError = String(error); }
  }
  const documentPath = $derived(path);
  let client: NotebookLanguage | undefined;
  let execution = $state.raw<NotebookExecution>();
  let executionRevision = $state(0), dragging = $state<string>(), dropTarget = $state<string>(), dropAfter = $state(false);
  const kernelState = $derived.by(() => { void executionRevision; return execution?.state ?? 'stopped'; });
  const kernelMessage = $derived.by(() => { void executionRevision; return execution?.message ?? ''; });
  const python = $derived.by(() => { void executionRevision; return execution?.python ?? ''; });
  const busy = $derived(kernelState === 'busy' || kernelState === 'starting');
  function dragStart(event: DragEvent, id: string) {
    if (!event.dataTransfer) return; dragging = id;
    if (!controller.selected.has(id)) controller.select(id);
    dragY = event.clientY;
    dragTimer = setInterval(() => {
      if (!scroll) return; const rect = scroll.getBoundingClientRect();
      if (dragY < rect.top + 60) scroll.scrollTop -= Math.min(24, (rect.top + 60 - dragY) / 3);
      else if (dragY > rect.bottom - 60) scroll.scrollTop += Math.min(24, (dragY - rect.bottom + 60) / 3);
    }, 16);
    event.dataTransfer.setData('application/x-setdown-notebook-cell', id); event.dataTransfer.effectAllowed = 'move';
  }
  function dragOver(event: DragEvent, id: string) {
    if (!dragging) return; event.preventDefault(); dragY = event.clientY;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dropTarget = id; const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    dropAfter = event.clientY > rect.top + rect.height / 2;
  }
  function dragEnd() { clearInterval(dragTimer); dragTimer = undefined; dragging = undefined; dropTarget = undefined; }
  function drop(event: DragEvent, id: string) {
    if (!dragging || dropTarget !== id) return; event.preventDefault();
    const index = cells.findIndex(cell => cell.id === id);
    controller.move(dropAfter ? cells[index + 1]?.id : id); dragEnd();
  }
  const cells = $derived.by(() => { void revision; return [...entry.document.cells]; });
  const canUndo = $derived.by(() => { void revision; return entry.document.canUndo; });
  const canRedo = $derived.by(() => { void revision; return entry.document.canRedo; });
  const matches = $derived.by(() => {
    if (!search) return [];
    return cells.flatMap(cell => {
      const matches: { id: string; range: M.IRange }[] = [], source = cell.source.toLowerCase(), query = search.toLowerCase();
      let offset = source.indexOf(query);
      while (offset >= 0 && matches.length < 1000) {
        const before = cell.source.slice(0, offset).split(/\r\n|\r|\n/), end = cell.source.slice(0, offset + search.length).split(/\r\n|\r|\n/);
        matches.push({ id: cell.id, range: { startLineNumber: before.length, startColumn: before.at(-1)!.length + 1,
          endLineNumber: end.length, endColumn: end.at(-1)!.length + 1 } });
        offset = source.indexOf(query, offset + Math.max(1, query.length));
      }
      return matches;
    });
  });
  async function showCell(id: string, range: M.IRange, edit = true) { onfocus(); if (edit) controller.select(id); reveal = { id, range, edit, sequence: (reveal?.sequence ?? 0) + 1 }; await tick(); }
  function find(delta = 0) {
    if (!matches.length) return;
    matchIndex = matchIndex < 0 ? (delta < 0 ? matches.length - 1 : 0) : (matchIndex + delta + matches.length) % matches.length;
    void showCell(matches[matchIndex].id, matches[matchIndex].range, false);
  }
  function isEditing(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest('.monaco-editor, input, textarea, select, [contenteditable="true"]');
  }
  function selectCell(id: string, event?: MouseEvent) { controller.select(id, event?.shiftKey, event?.ctrlKey || event?.metaKey); }
  async function runNext(id: string, insert: boolean) {
    const index = cells.findIndex(cell => cell.id === id);
    if (cells[index]?.kind === 'code') void execution?.run([id]);
    const next = insert || !cells[index + 1] ? controller.insert('code', id) : cells[index + 1].id;
    await showCell(next, { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 1 });
  }
  function clipboard(event: ClipboardEvent) {
    if (!active || isEditing(event.target) || !event.clipboardData || window.getSelection()?.toString()) return;
    try {
      if (event.type === 'paste') {
        const text = event.clipboardData.getData('application/x-setdown-notebook-cells') || event.clipboardData.getData('text/plain');
        if (!text.trimStart().startsWith('{') || !text.includes('"nbformat"')) return;
        controller.paste(text);
      } else {
        if (!controller.selected.size) return;
        const text = controller.copy();
        event.clipboardData.setData('application/x-setdown-notebook-cells', text); event.clipboardData.setData('text/plain', text);
        if (event.type === 'cut') controller.remove();
      }
      event.preventDefault(); event.stopPropagation();
    } catch (error) { actionError = String(error); }
  }
  function keydown(event: KeyboardEvent) {
    if (!active || event.isComposing) return;
    const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (mod && key === 'f') {
      event.preventDefault(); event.stopPropagation(); searchOpen = true; void tick().then(() => { searchInput?.focus(); searchInput?.select(); }); return;
    }
    if (isEditing(event.target)) return;
    const index = cells.findIndex(cell => cell.id === controller.active);
    if ((key === 'arrowdown' || key === 'arrowup') && !mod) {
      const next = cells[Math.max(0, Math.min(cells.length - 1, index + (key === 'arrowup' ? -1 : 1)))];
      if (next) { controller.select(next.id, event.shiftKey); void showCell(next.id, { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 1 }, false); }
    } else if (mod && key === 'a') {
      if (cells.length) { controller.select(cells[0].id); controller.select(cells.at(-1)!.id, true); }
    } else if (key === 'delete' || key === 'backspace') controller.remove();
    else if (mod && key === 'z') { if (event.shiftKey) entry.document.redo(); else entry.document.undo(); }
    else if (key === 'enter' && controller.active) {
      if (event.shiftKey || event.altKey) void runNext(controller.active, event.altKey);
      else if (mod) void execution?.run([...controller.selected]);
      else void showCell(controller.active, { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 1 });
    } else return;
    event.preventDefault(); event.stopPropagation();
  }
  onMount(() => {
    let disposed = false;
    const findNotebook = () => { if (active) { searchOpen = true; void tick().then(() => searchInput?.focus()); } };
    window.addEventListener('setdown:notebook-find', findNotebook);
    revision = entry.document.revision;
    execution = entry.execution ??= new NotebookExecution(desktop.notebook, entry.document, entry.id, path);
    void refreshEnvironments();
    const selectionChanges = controller.subscribe(() => controllerRevision++);
    if (scroll) scroll.scrollTop = controller.scrollTop;
    const executionChanges = execution.subscribe(() => { executionRevision++; });
    const unsubscribe = entry.document.subscribe(() => { revision = entry.document.revision; });
    const updateZoom = (id?: string) => { if (!id || id === entry.id) factor = textZoomFactor(entry.id); };
    updateZoom(); const zoom = onTextZoom(updateZoom);
    const updateTheme = (next: PreviewThemeId) => { theme = next; api?.editor.setTheme(monacoThemeName(next)); };
    const themes = desktop.onThemeChanged(snapshot => updateTheme(snapshot.id));
    void Promise.all([import('monaco-editor/editor/editor.main'), import('monaco-editor/editor/editor.worker?worker'), desktop.getTheme()])
      .then(([monaco, worker, snapshot]) => {
        if (disposed) return;
        window.MonacoEnvironment = { getWorker: () => new worker.default() }; registerMonacoThemes(monaco);
        theme = snapshot.id; api = monaco; monaco.editor.setTheme(monacoThemeName(theme));
      }).catch(error => { if (!disposed) loadError = String(error); });
    return () => { window.removeEventListener('setdown:notebook-find', findNotebook); disposed = true; dragEnd(); selectionChanges(); unsubscribe(); executionChanges(); themes(); zoom(); };
  });
  $effect(() => {
    if (!active || !api || !environmentReady || entry.document.error || entry.document.language !== 'python') return;
    const file = documentPath, owner = entry, monaco = api, environment = selectedPython;
    const current = untrack(() => new NotebookLanguage(monaco, desktop.language, owner, file, value => { language = value; }, (uri, selection) => openFile(api!.Uri.parse(uri).fsPath, selection), showCell, environment));
    client = current;
    return () => { current.dispose(); if (client === current) client = undefined; };
  });
  $effect(() => { execution?.setPath(documentPath); });
</script>

<!-- Key capture is scoped to this notebook, including its embedded editors. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="notebook-surface" data-notebook-language={language} onfocusin={() => onfocus()} onkeydowncapture={keydown} oncopy={clipboard} oncut={clipboard} onpaste={clipboard} style:font-size={`${14 * factor}px`}>
  <div class="notebook-toolbar" role="toolbar" aria-label="Notebook">
    <button onclick={() => controller.insert('code')} disabled={!!entry.document.error}>+ Code</button>
    <button onclick={() => controller.insert('markdown')} disabled={!!entry.document.error}>+ Markdown</button>
    <button title="Undo the last cell operation (text uses editor Undo)" aria-label="Undo cell operation" disabled={!canUndo} onclick={() => entry.document.undo()}>↶</button>
    <button title="Redo cell operation" aria-label="Redo cell operation" disabled={!canRedo} onclick={() => entry.document.redo()}>↷</button>
    <span class="summary">{cells.length} cells · {entry.document.language}</span>
    {#if entry.document.language === 'python' && !entry.document.error}
      <button aria-label="Run all cells" onclick={() => execution?.run()}>▶ Run All</button>
      {#if busy}<button aria-label="Interrupt kernel" onclick={() => execution?.interrupt()}>■ Interrupt</button>{/if}
      <button title="Discard Python variables and stop the kernel. Run starts a fresh kernel." onclick={() => execution?.shutdown()} disabled={kernelState === 'stopped'}>Reset kernel</button>
      <select class="execution-note" aria-label="Python environment" title={python || 'Choose Python with ipykernel installed'} value={selectedPython ?? ''} onchange={event => void chooseEnvironment(event.currentTarget.value)}>
        <option value="" disabled>Select Python…</option>
        {#if selectedPython && !environments.candidates.some(item => item.path === selectedPython)}<option value={selectedPython}>{selectedPython} (unavailable)</option>{/if}
        {#each environments.candidates as candidate}<option value={candidate.path}>{candidate.name} · {candidate.source} · {candidate.path}</option>{/each}
        <option value="__choose__">Choose executable…</option>
      </select>
      <span class="kernel-state" role="status">{kernelState}</span>
    {/if}
  </div>
  {#if actionError}<div class="kernel-error" role="alert">{actionError}<button aria-label="Dismiss notebook error" onclick={() => actionError = ''}>×</button></div>{/if}
  {#if kernelMessage}<div class="kernel-error" role="alert">{kernelMessage}</div>{/if}
  {#if searchOpen}
    <div class="notebook-search">
      <input aria-label="Find in notebook" placeholder="Find in notebook" bind:this={searchInput} bind:value={search}
        oninput={() => { matchIndex = -1; }} onkeydown={event => { if (event.key === 'Enter') find(event.shiftKey ? -1 : 1); if (event.key === 'Escape') { event.stopPropagation(); searchOpen = false; } }} />
      <span>{matches.length ? Math.min(matchIndex + 1, matches.length) : 0}/{matches.length}</span>
      <button aria-label="Previous notebook match" onclick={() => find(-1)}>↑</button><button aria-label="Next notebook match" onclick={() => find(1)}>↓</button>
      <button aria-label="Close notebook search" onclick={() => searchOpen = false}>×</button>
    </div>
  {/if}
  <div class="notebook-scroll" bind:this={scroll} onscroll={() => { if (scroll) controller.scrollTop = scroll.scrollTop; }}>
    {#if entry.document.error}
      <div class="notebook-error" role="alert"><h3>Notebook could not be edited</h3><p>{entry.document.error}</p><p>The original file has not been changed.</p>
        <pre>{entry.document.original.slice(0, 200_000)}</pre></div>
    {:else if loadError}<p role="alert">Could not load the cell editor: {loadError}</p>
    {:else}
      {#each cells as cell (cell.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="cell-drop" class:drop-before={dropTarget === cell.id && !dropAfter} class:drop-after={dropTarget === cell.id && dropAfter}
          ondragover={event => dragOver(event, cell.id)} ondrop={event => drop(event, cell.id)}>
        <NotebookCell {entry} {cell} {revision} {api} {active} {path} {desktop} {theme} {onfocus} {reveal} onmodel={() => client?.updateMarkers()}
          selected={selected.has(cell.id)} collapsedInput={controllerRevision >= 0 && controller.collapsedInputs.has(cell.id)} collapsedOutput={controllerRevision >= 0 && controller.collapsedOutputs.has(cell.id)}
          onselect={event => selectCell(cell.id, event)} onrunNext={insert => void runNext(cell.id, insert)} duration={executionRevision >= 0 ? execution?.durations.get(cell.id) : undefined}
          run={() => execution?.run([cell.id])} executionState={executionRevision >= 0 ? execution?.cells.get(cell.id) : undefined}
          ondragstart={event => dragStart(event, cell.id)} ondragend={dragEnd} />
        </div>
      {/each}
      {#if !cells.length}<div class="notebook-empty"><p>This notebook has no cells yet.</p><button onclick={() => controller.insert('code')}>Add a code cell</button></div>{/if}
    {/if}
  </div>
</div>

<style>
  .cell-drop { position: relative; }
  .drop-before::before, .drop-after::after { content: ''; position: absolute; height: 3px; background: var(--app-accent); left: 0; right: 0; z-index: 1; pointer-events: none; }
  .drop-before::before { top: -9px; } .drop-after::after { bottom: -9px; }
  .kernel-error { padding: 8px 16px; color: var(--app-danger-text); font-size: 12px; overflow-wrap: anywhere; }
  .kernel-state { color: var(--app-muted-text); }
  .notebook-surface { display: flex; flex-direction: column; position: absolute; inset: 0; background: var(--app-canvas); color: var(--app-text); min-width: 0; }
  .notebook-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-height: 38px; padding: 4px 14px; border-bottom: 1px solid var(--app-border); font-size: 12px; background: var(--app-surface); }
  button { font: inherit; color: var(--app-text); background: transparent; border: 1px solid transparent; border-radius: 3px; padding: 4px 8px; cursor: pointer; }
  button:hover:not(:disabled) { background: var(--app-hover); } button:disabled { opacity: .4; cursor: default; }
  button:focus-visible { outline: 1px solid var(--app-focus-ring); }
  select { font: inherit; background: var(--app-surface); color: var(--app-text); border: 1px solid var(--app-border); border-radius: 3px; padding: 4px; max-width: 300px; }
  .summary { color: var(--app-muted-text); margin-left: 8px; } .execution-note { color: var(--app-muted-text); margin-left: auto; }
  .notebook-scroll { overflow: auto; flex: 1; padding: 22px clamp(12px, 4vw, 64px) 100px; min-height: 0; scrollbar-gutter: stable; }
  .notebook-empty { text-align: center; padding: 60px 12px; color: var(--app-muted-text); }
  .notebook-error pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  .notebook-search { display: flex; align-items: center; gap: 5px; padding: 6px 14px; font-size: 12px; border-bottom: 1px solid var(--app-border); }
  input { min-width: 80px; flex: 1; background: var(--app-surface); color: var(--app-text); border: 1px solid var(--app-border); padding: 5px; }
</style>
