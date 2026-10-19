<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type * as M from 'monaco-editor';
  import type { NotebookEntry } from './notebook-store';
  import type { DesktopPort } from '../ports/desktop-port';
  import type { PreviewThemeId } from '../../core/preview/preview-preferences';
  import { registerMonacoThemes, monacoThemeName } from '../theme';
  import { textZoomFactor, onTextZoom } from '../editor/text-zoom';
  import { loadMonaco } from '../editor/monaco-runtime';
  import { NotebookLanguage } from './notebook-language';
  import type { NotebookEnvironments } from '../../protocol/notebook';
  import { NotebookExecution } from './notebook-execution';
  import { notebookHeadings, markdownText, offsetRange, type TraceTarget } from '../../core/notebook/notebook-tools';
  import { NotebookDocument } from '../../core/notebook/notebook-document';
  import { outputText } from './notebook-content';
  import type { NotebookTool } from '../../protocol/notebook';
  import SearchWorker from './notebook-search.worker?worker';
  import NotebookVariables from './NotebookVariables.svelte';
  import NotebookCell from './NotebookCell.svelte';
  import './notebook-typography.css';
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
  const environmentLabel = $derived(environments.candidates.find(item => item.path === selectedPython)?.name ?? 'Python');
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
  let matchCase = $state(false), regex = $state(false), searchScope = $state('source'), replacement = $state('');
  let outline = $state(false), variables = $state(false), commandOpen = $state(false), commandFilter = $state(''), toolBusy = $state(false), notice = $state(''), remote = $state(false), remoteUrl = $state('');
  let inputValue = $state(''), sticky = $state(''), scrollFrame = 0, lastDelete = 0;
  const inputRequest = $derived.by(() => { void executionRevision; return execution?.inputRequest; });
  $effect(() => { void inputRequest?.request; inputValue = ''; });
  const headings = $derived(notebookHeadings(cells));
  const hiddenSections = $derived.by(() => {
    void controllerRevision; const hidden = new Set<string>(); let foldedLevel = 0;
    for (const cell of cells) {
      const heading = headings.find(item => item.id === cell.id);
      if (heading && foldedLevel && heading.level <= foldedLevel) foldedLevel = 0;
      if (foldedLevel) hidden.add(cell.id);
      if (heading && controller.foldedSections.has(cell.id) && !foldedLevel) foldedLevel = heading.level;
    }
    return hidden;
  });
  let searchBusy = $state(false), pendingFind: number | null = null;
  type Match = { id: string; range: M.IRange; snippet: string };
  let searchResult = $state<{ matches: Match[]; error: string }>({ matches: [], error: '' });
  $effect(() => {
    if (!search || !searchOpen) { searchBusy = false; searchResult = { matches: [], error: '' }; return; }
    searchBusy = true; searchResult = { matches: [], error: '' };
    const options = { query: search, regex, matchCase }, scope = searchScope;
    const sources = cells.map(cell => ({ id: cell.id, version: cell.version, text: scope === 'outputs' ? (cell.clearOutputs ? '' : outputText(cell.outputs))
      : scope === 'rendered' ? (cell.kind === 'markdown' ? markdownText(cell.source) : '') : cell.source }));
    let worker: Worker | undefined, timeout: ReturnType<typeof setTimeout> | undefined;
    const debounce = setTimeout(() => {
      worker = new SearchWorker();
      timeout = setTimeout(() => { worker?.terminate(); searchBusy = false; searchResult = { matches: [], error: 'Search took too long. Simplify the expression.' }; }, 2000);
      worker.onmessage = event => { clearTimeout(timeout); searchBusy = false; searchResult = event.data; worker?.terminate(); matchIndex = -1; if (pendingFind !== null) { const delta = pendingFind; pendingFind = null; void tick().then(() => find(delta)); } };
      worker.onerror = () => { clearTimeout(timeout); searchBusy = false; searchResult = { matches: [], error: 'Could not search this notebook.' }; worker?.terminate(); };
      worker.postMessage({ cells: sources, options, source: scope === 'source' });
    }, 100);
    return () => { clearTimeout(debounce); clearTimeout(timeout); worker?.terminate(); };
  });
  const matches = $derived(searchResult.matches);
  function replaceAll() {
    if (!search || searchScope !== 'source') return;
    const worker = new SearchWorker();
    const timeout = setTimeout(() => { worker.terminate(); actionError = 'Replacement took too long. Simplify the expression.'; }, 2000);
    worker.onmessage = event => {
      clearTimeout(timeout); worker.terminate();
      try { if (event.data.error) throw Error(event.data.error); entry.document.editSources(event.data.edits); notice = 'Replaced source matches. Undo cell operation restores all affected cells.'; }
      catch (error) { actionError = String(error); }
    };
    worker.onerror = () => { clearTimeout(timeout); worker.terminate(); actionError = 'Could not replace notebook source.'; };
    worker.postMessage({ cells: cells.map(cell => ({ id: cell.id, version: cell.version, text: cell.source })), options: { query: search, regex, matchCase }, source: true, replacement });
  }
  function toggleSection(id: string) { if (controller.foldedSections.has(id)) controller.foldedSections.delete(id); else controller.foldedSections.add(id); controller.changed(); }
  function scrolled() {
    if (!scroll) return; controller.scrollTop = scroll.scrollTop;
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0; if (!scroll) return; const top = scroll.getBoundingClientRect().top;
      let title = '';
      for (const heading of headings) {
        const cell = scroll.querySelector(`[data-cell-id="${heading.id}"]`);
        if (cell && !hiddenSections.has(heading.id) && cell.getBoundingClientRect().top < top + 20) title = heading.text;
      }
      sticky = title;
    });
  }
  async function trace(target: TraceTarget, origin: string) {
    const range = offsetRange('', 0); range.startLineNumber = range.endLineNumber = target.line;
    if (target.file) {
      const file = await desktop.notebook.resolveTraceFile(path, target.file);
      await openFile(file, range);
    } else {
      const candidates = cells.filter(cell => cell.executionCount === target.count && !cell.clearOutputs);
      const current = candidates.filter(cell => execution?.cells.has(cell.id));
      const cell = candidates.find(cell => cell.id === origin) ?? (current.length === 1 ? current[0] : candidates.length === 1 ? candidates[0] : undefined);
      if (!cell) { actionError = 'This traceback refers to a cell execution that is no longer in this notebook.'; return; }
      if (cell.source !== (cell.executedSource ?? cell.originalSource)) notice = 'This cell changed after the error. The traceback line belongs to its earlier execution.';
      await showCell(cell.id, range);
    }
  }
  async function tool(action: NotebookTool) {
    if (toolBusy) return; toolBusy = true; actionError = ''; notice = '';
    const versions = cells.map(cell => ({ id: cell.id, version: cell.version }));
    try {
      const result = await desktop.notebook.tool(path, entry.document.serialize(), action);
      if (result.source) {
        const formatted = new NotebookDocument(result.source);
        if (formatted.error || formatted.cells.length !== versions.length) throw Error('Formatter returned an incompatible notebook.');
        entry.document.editSources(versions.map((cell, i) => ({ ...cell, source: formatted.cells[i].source })));
      }
      notice = result.message ?? (result.path ? `Saved ${result.path}` : action === 'jupyterlab' ? 'JupyterLab uses its own kernel. Save there before returning to Setdown.' : '');
    } catch (error) { actionError = String(error); } finally { toolBusy = false; }
  }
  const commands = [
    ['undo', 'Undo cell operation'], ['redo', 'Redo cell operation'], ['outline', 'Toggle outline'], ['variables', 'Toggle variables'], ['reset', 'Reset kernel'],
    ['run-above', 'Run cells above'], ['run-below', 'Run from current cell to end'], ['restart-all', 'Restart kernel and run all'],
    ['clear-all', 'Clear all outputs'], ['collapse-inputs', 'Collapse all inputs'], ['expand-inputs', 'Expand all inputs'],
    ['collapse-outputs', 'Collapse all outputs'], ['expand-outputs', 'Expand all outputs'], ['split', 'Split cell at cursor'], ['join', 'Join selected adjacent cells'],
    ['insert-above', 'Insert code cell above'], ['insert-below', 'Insert code cell below'], ['code', 'Convert selected cell to code'], ['markdown', 'Convert selected cell to Markdown'],
    ['move-up', 'Move selected cells up'], ['move-down', 'Move selected cells down'], ['line', 'Toggle cell line numbers'], ['lines', 'Toggle all line numbers'],
    ['rename', 'Rename symbol across cells'], ['fix', 'Apply code action at cursor'], ['format', 'Format notebook with Ruff'], ['fix-code', 'Apply Ruff safe fixes across cells'],
    ['export-html', 'Export HTML'], ['export-markdown', 'Export Markdown'], ['export-script', 'Export script'], ['export-webpdf', 'Export PDF'],
    ['diff', 'Compare notebook with Git HEAD'], ['jupyterlab', 'Open JupyterLab: widgets, plots and debugger'], ['stop-tools', 'Stop external notebook sessions'], ['remote', 'Connect to remote JupyterLab'], ['install-tools', 'Install notebook tools'],
  ];
  async function command(id: string) {
    commandOpen = false; actionError = ''; const index = cells.findIndex(cell => cell.id === controller.active);
    try {
      if (id === 'undo') entry.document.undo();
      else if (id === 'redo') entry.document.redo();
      else if (id === 'outline') outline = !outline;
      else if (id === 'variables') variables = !variables;
      else if (id === 'reset') await execution?.shutdown();
      else if (id === 'run-above') await execution?.run(cells.slice(0, Math.max(0, index)).map(cell => cell.id));
      else if (id === 'run-below') await execution?.run(cells.slice(Math.max(0, index)).map(cell => cell.id));
      else if (id === 'restart-all') { await execution?.shutdown(); await execution?.run(); }
      else if (id === 'clear-all') entry.document.clearMany();
      else if (/^(collapse|expand)-(inputs|outputs)$/.test(id)) controller.collapseAll(id.endsWith('inputs') ? 'input' : 'output', id.startsWith('collapse'));
      else if (id === 'split' || id === 'join') { const next = id === 'split' ? controller.split() : controller.join(); if (next) await showCell(next, offsetRange('', 0)); }
      else if (id === 'insert-above') { const next = controller.insert('code'); entry.document.moveManyBefore([next], cells[index]?.id); await showCell(next, offsetRange('', 0)); }
      else if (id === 'insert-below') await showCell(controller.insert('code'), offsetRange('', 0));
      else if ((id === 'code' || id === 'markdown') && controller.active) entry.document.convert(controller.active, id);
      else if (id === 'line' || id === 'lines') controller.lineNumbers(id === 'line' ? controller.active : undefined);
      else if (id === 'move-up' || id === 'move-down') {
        const indices = cells.map((cell, i) => selected.has(cell.id) ? i : -1).filter(i => i >= 0);
        const before = id === 'move-up' ? cells[Math.max(0, Math.min(...indices) - 1)]?.id : cells[Math.max(...indices) + 2]?.id; controller.move(before);
      } else if (id === 'stop-tools') { await desktop.notebook.cancelTools(path); notice = 'External notebook servers stopped.'; }
      else if (id === 'remote') remote = true;
      else if (id === 'rename') renameOpen = true;
      else if (id === 'fix') { codeActions = await client?.actions(controller.active, controller.cursors.get(controller.active ?? '') ?? 0) ?? []; actionsOpen = true; }
      else await tool(id as NotebookTool);
    } catch (error) { actionError = String(error); }
  }
  let renameOpen = $state(false), newName = $state(''), actionsOpen = $state(false), codeActions = $state<{ title: string; apply(): void }[]>([]);
  async function rename() {
    try { await client?.rename(controller.active, controller.cursors.get(controller.active ?? '') ?? 0, newName); renameOpen = false; }
    catch (error) { actionError = String(error); }
  }
  async function showCell(id: string, range: M.IRange, edit = true) { if (hiddenSections.has(id)) { controller.foldedSections.clear(); controller.changed(); } onfocus(); if (edit) controller.select(id); reveal = { id, range, edit, sequence: (reveal?.sequence ?? 0) + 1 }; await tick(); }
  function find(delta = 0) {
    if (searchBusy) { pendingFind = delta; return; }
    if (!matches.length) return;
    matchIndex = matchIndex < 0 ? (delta < 0 ? matches.length - 1 : 0) : (matchIndex + delta + matches.length) % matches.length;
    const match = matches[matchIndex]; if (searchScope === 'outputs') { controller.collapsedOutputs.delete(match.id); controller.changed(); notice = match.snippet; }
    void showCell(match.id, match.range, false);
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
    if (mod && event.shiftKey && key === 'p') { event.preventDefault(); event.stopPropagation(); commandOpen = !commandOpen; return; }
    if (mod && event.shiftKey && key === '-') { event.preventDefault(); void command('split'); return; }
    if (key === 'f2') { event.preventDefault(); void command('rename'); return; }
    if (isEditing(event.target)) return;
    // Native action activation belongs to the focused control, not whichever
    // cell was previously selected. The gutter selector still owns command mode.
    if (key === 'enter' && !mod && !event.shiftKey && !event.altKey && event.target instanceof Element
      && event.target.closest('button:not(.execution), a[href], summary')) return;
    const index = cells.findIndex(cell => cell.id === controller.active);
    if ((key === 'arrowdown' || key === 'arrowup') && !mod && !event.altKey) {
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
    } else if (!mod && !event.altKey && ['a', 'b', 'm', 'y', 'l', 'd'].includes(key)) {
      if (key === 'd') { if (lastDelete > 0 && performance.now() - lastDelete < 600) { controller.remove(); lastDelete = 0; } else lastDelete = performance.now(); }
      else void command(({ a: 'insert-above', b: 'insert-below', m: 'markdown', y: 'code', l: event.shiftKey ? 'lines' : 'line' } as Record<string, string>)[key]);
    } else if (event.altKey && (key === 'arrowup' || key === 'arrowdown')) void command(key === 'arrowup' ? 'move-up' : 'move-down');
    else return;
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
    void Promise.all([loadMonaco(), desktop.getTheme()])
      .then(([monaco, snapshot]) => {
        if (disposed) return;
        registerMonacoThemes(monaco);
        theme = snapshot.id; api = monaco; monaco.editor.setTheme(monacoThemeName(theme));
      }).catch(error => { if (!disposed) loadError = String(error); });
    return () => { window.removeEventListener('setdown:notebook-find', findNotebook); disposed = true; cancelAnimationFrame(scrollFrame); dragEnd(); selectionChanges(); unsubscribe(); executionChanges(); themes(); zoom(); };
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
    <button class="secondary-tool" title="Undo the last cell operation (text uses editor Undo)" aria-label="Undo cell operation" disabled={!canUndo} onclick={() => entry.document.undo()}>↶</button>
    <button class="secondary-tool" title="Redo cell operation" aria-label="Redo cell operation" disabled={!canRedo} onclick={() => entry.document.redo()}>↷</button>
    <button class="secondary-tool" onclick={() => outline = !outline} aria-pressed={outline}>Outline</button>
    <button class="secondary-tool" onclick={() => variables = !variables} aria-pressed={variables}>Variables</button>
    <button onclick={() => commandOpen = !commandOpen} aria-expanded={commandOpen}>Commands…</button>
    {#if toolBusy}<span role="status">Notebook tool running…</span><button onclick={() => desktop.notebook.cancelTools(path)}>Cancel tool</button>{/if}
    <span class="summary">{cells.length} cells · {entry.document.language}</span>
    {#if entry.document.language === 'python' && !entry.document.error}
      <button aria-label="Run all cells" onclick={() => execution?.run()}>▶ Run All</button>
      {#if busy}<button aria-label="Interrupt kernel" onclick={() => execution?.interrupt()}>■ Interrupt</button>{/if}
      <button class="secondary-tool" title="Discard Python variables and stop the kernel. Run starts a fresh kernel." onclick={() => execution?.shutdown()} disabled={kernelState === 'stopped'}>Reset kernel</button>
      <div class="execution-note" title={selectedPython || python || 'Choose Python with ipykernel installed'}>
      <span aria-hidden="true">{selectedPython ? environmentLabel : 'Select Python…'} ▾</span>
      <select aria-label="Python environment" value={selectedPython ?? ''} onchange={event => void chooseEnvironment(event.currentTarget.value)}>
        <option value="" disabled>Select Python…</option>
        {#if selectedPython && !environments.candidates.some(item => item.path === selectedPython)}<option value={selectedPython}>{selectedPython} (unavailable)</option>{/if}
        {#each environments.candidates as candidate}<option value={candidate.path}>{candidate.name} · {candidate.source} · {candidate.path}</option>{/each}
        <option value="__choose__">Choose executable…</option>
      </select>
      </div>
      <span class="kernel-state" role="status">{kernelState}</span>
    {/if}
  </div>
  {#if commandOpen}<div class="command-panel" role="region" aria-label="Notebook commands">
    <input aria-label="Filter notebook commands" placeholder="Filter commands…" bind:value={commandFilter} onkeydown={event => { if (event.key === 'Escape') commandOpen = false; }} />
    {#each commands.filter(([, label]) => label.toLowerCase().includes(commandFilter.toLowerCase())) as [id, label]}<button disabled={toolBusy} onclick={() => command(id)}>{label}</button>{/each}
  </div>{/if}
  {#if renameOpen}<form class="notebook-search" onsubmit={event => { event.preventDefault(); void rename(); }}><input aria-label="New symbol name" bind:value={newName} /><button>Rename across cells</button><button type="button" onclick={() => renameOpen = false}>Cancel</button></form>{/if}
  {#if actionsOpen}<div class="notebook-search">{#each codeActions as action}<button onclick={() => { try { action.apply(); actionsOpen = false; } catch (error) { actionError = String(error); } }}>{action.title}</button>{:else}<span>No safe notebook code action is available here.</span>{/each}<button onclick={() => actionsOpen = false}>Close</button></div>{/if}
  {#if remote}<form class="notebook-search" onsubmit={event => { event.preventDefault(); try { const url = new URL(remoteUrl); if (!['https:', 'http:'].includes(url.protocol)) throw Error('Use a JupyterLab HTTP(S) URL.'); void desktop.openLink(url.href); remoteUrl = ''; remote = false; } catch (error) { actionError = String(error); } }}>
    <input aria-label="Remote JupyterLab URL" placeholder="https://server/lab?token=…" bind:value={remoteUrl} /><button>Connect</button><button type="button" onclick={() => remote = false}>Cancel</button><span>Uses the remote server’s files and kernels.</span>
  </form>{/if}
  {#if notice}<div class="notebook-notice" role="status">{notice}<button onclick={() => notice = ''}>×</button></div>{/if}
  {#if inputRequest && execution}<form class="notebook-search" onsubmit={event => { event.preventDefault(); const value = inputValue; inputValue = ''; void execution!.answerInput(value).catch(error => actionError = String(error)); }}>
    <label>{inputRequest.prompt}<input aria-label="Kernel input" type={inputRequest.password ? 'password' : 'text'} autocomplete="off" bind:value={inputValue} /></label><button>Send input</button><button type="button" onclick={() => { inputValue = ''; void execution?.interrupt(); }}>Interrupt</button>
  </form>{/if}
  {#if actionError}<div class="kernel-error" role="alert">{actionError}<button aria-label="Dismiss notebook error" onclick={() => actionError = ''}>×</button></div>{/if}
  {#if kernelMessage}<div class="kernel-error" role="alert">{kernelMessage}</div>{/if}
  {#if searchOpen}
    <div class="notebook-search">
      <input aria-label="Find in notebook" placeholder="Find in notebook" bind:this={searchInput} bind:value={search}
        oninput={() => { matchIndex = -1; }} onkeydown={event => { if (event.key === 'Enter') find(event.shiftKey ? -1 : 1); if (event.key === 'Escape') { event.stopPropagation(); searchOpen = false; } }} />
      <select aria-label="Notebook search scope" bind:value={searchScope}><option value="source">Source</option><option value="outputs">Outputs</option><option value="rendered">Rendered Markdown</option></select>
      <button aria-pressed={matchCase} onclick={() => matchCase = !matchCase}>Aa</button><button aria-pressed={regex} onclick={() => regex = !regex}>.*</button>
      <span>{matches.length ? Math.min(matchIndex + 1, matches.length) : 0}/{matches.length}</span>
      <button aria-label="Previous notebook match" onclick={() => find(-1)}>↑</button><button aria-label="Next notebook match" onclick={() => find(1)}>↓</button>
      <button aria-label="Close notebook search" onclick={() => searchOpen = false}>×</button>
    </div>
    {#if searchResult.error}<p role="alert">{searchResult.error}</p>{/if}
    {#if searchScope === 'source'}<div class="notebook-replace"><input aria-label="Replace in notebook" placeholder="Replace source matches" bind:value={replacement} /><button disabled={!matches.length} onclick={replaceAll}>Replace all</button></div>{/if}
    {#if matchIndex >= 0 && matches[matchIndex] && searchScope !== 'source'}<div class="search-snippet">{matches[matchIndex].snippet}</div>{/if}
  {/if}
  {#if outline}<nav class="notebook-outline" aria-label="Notebook outline">{#each headings as heading}<span style:padding-left={`${(heading.level - 1) * 12}px`}><button aria-label="Toggle notebook section" aria-expanded={!controller.foldedSections.has(heading.id)} onclick={() => toggleSection(heading.id)}>{controller.foldedSections.has(heading.id) ? '▸' : '▾'}</button><button onclick={() => showCell(heading.id, { startLineNumber: heading.line, endLineNumber: heading.line, startColumn: 1, endColumn: 1 }, false)}>{heading.text}</button></span>{/each}</nav>{/if}
  {#if sticky}<div class="notebook-sticky">{sticky}</div>{/if}
  <div class="notebook-scroll" bind:this={scroll} onscroll={scrolled}>
    {#if entry.document.error}
      <div class="notebook-error" role="alert"><h3>Notebook could not be edited</h3><p>{entry.document.error}</p><p>The original file has not been changed.</p>
        <pre>{entry.document.original.slice(0, 200_000)}</pre></div>
    {:else if loadError}<p role="alert">Could not load the cell editor: {loadError}</p>
    {:else}
      {#each cells as cell (cell.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="cell-drop" hidden={hiddenSections.has(cell.id)} oncontextmenu={event => { if (event.target instanceof Element && event.target.closest('.cell-toolbar, .cell-gutter')) { event.preventDefault(); controller.select(cell.id); commandOpen = true; } }} class:drop-before={dropTarget === cell.id && !dropAfter} class:drop-after={dropTarget === cell.id && dropAfter}
          ondragover={event => dragOver(event, cell.id)} ondrop={event => drop(event, cell.id)}>
        <NotebookCell {entry} {cell} {revision} {api} {active} {path} {desktop} {theme} {onfocus} {reveal} ontrace={target => trace(target, cell.id)} lineNumbers={controllerRevision >= 0 && !controller.hiddenLineNumbers.has(cell.id)} onmodel={() => client?.updateMarkers()}
          selected={selected.has(cell.id)} collapsedInput={controllerRevision >= 0 && controller.collapsedInputs.has(cell.id)} collapsedOutput={controllerRevision >= 0 && controller.collapsedOutputs.has(cell.id)}
          onselect={event => selectCell(cell.id, event)} onrunNext={insert => void runNext(cell.id, insert)} duration={executionRevision >= 0 ? execution?.durations.get(cell.id) : undefined}
          run={() => execution?.run([cell.id])} executionState={executionRevision >= 0 ? execution?.cells.get(cell.id) : undefined}
          ondragstart={event => dragStart(event, cell.id)} ondragend={dragEnd} />
        </div>
      {/each}
      {#if !cells.length}<div class="notebook-empty"><p>This notebook has no cells yet.</p><button onclick={() => controller.insert('code')}>Add a code cell</button></div>{/if}
    {/if}
  </div>
  {#if variables && execution}<NotebookVariables {execution} revision={executionRevision} close={() => variables = false} />{/if}
</div>

<style>
  .command-panel { position: absolute; right: 14px; top: 44px; z-index: 30; width: min(440px, 90%); max-height: 65%; overflow: auto; display: flex; flex-direction: column; background: var(--app-surface); border: 1px solid var(--app-border); padding: 8px; box-shadow: 0 8px 30px #0003; }
  .command-panel button { text-align: left; }
  .notebook-outline { display: flex; flex-direction: column; max-height: 180px; overflow: auto; padding: 6px 16px; border-bottom: 1px solid var(--app-border); font-size: 12px; }
  .notebook-sticky, .notebook-notice, .search-snippet { padding: 5px 16px; background: var(--app-surface); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .notebook-sticky { border-bottom: 1px solid var(--app-border); }
  .cell-drop[hidden] { display: none; }

  .cell-drop { position: relative; }
  .drop-before::before, .drop-after::after { content: ''; position: absolute; height: 3px; background: var(--app-accent); left: 0; right: 0; z-index: 1; pointer-events: none; }
  .drop-before::before { top: -9px; } .drop-after::after { bottom: -9px; }
  .kernel-error { padding: 8px 16px; color: var(--app-danger-text); font-size: 12px; overflow-wrap: anywhere; }
  .kernel-state { color: var(--notebook-secondary-text); white-space: nowrap; }
  .notebook-surface { display: flex; flex-direction: column; position: absolute; inset: 0; background: var(--app-canvas); color: var(--app-text); min-width: 0; container-type: inline-size; }
  .notebook-toolbar { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; flex-shrink: 0; min-height: 38px; padding: 4px 12px; border-bottom: 1px solid var(--app-border); font-size: 13px; background: var(--app-surface); }
  button { font: inherit; color: var(--app-text); background: transparent; border: 1px solid transparent; border-radius: 3px; padding: 4px 8px; cursor: pointer; }
  button:hover:not(:disabled) { background: var(--app-hover); } button:disabled { opacity: .4; cursor: default; }
  button:focus-visible { outline: 1px solid var(--app-focus-ring); }
  select { font: inherit; background: var(--app-surface); color: var(--app-text); border: 1px solid var(--app-border); border-radius: 3px; padding: 4px; max-width: 300px; }
  .summary { color: var(--notebook-secondary-text); margin-left: 8px; white-space: nowrap; }
  .execution-note { position: relative; margin-left: auto; max-width: 200px; min-width: 80px; height: 28px; }
  .execution-note > span { display: block; padding: 4px 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .execution-note select { position: absolute; inset: 0; width: 100%; opacity: 0; cursor: pointer; }
  .execution-note:focus-within { outline: 2px solid var(--app-focus-ring); border-radius: 3px; }
  .execution-note:hover { background: var(--app-hover); }
  .notebook-scroll { overflow: auto; flex: 1; padding: 30px clamp(12px, 2.5cqw, 40px) 100px 12px; min-height: 0; scrollbar-gutter: stable; }
  @container (max-width: 1100px) { .summary { display: none; } }
  @container (max-width: 900px) { .secondary-tool { display: none; } }
  @container (max-width: 540px) { .notebook-toolbar { gap: 2px; padding-inline: 6px; font-size: 12px; } .notebook-toolbar button { padding-inline: 5px; } .execution-note { max-width: 120px; } .notebook-scroll { padding-inline: 6px; } }
  .notebook-empty { text-align: center; padding: 60px 12px; color: var(--app-muted-text); }
  .notebook-error pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  .notebook-search, .notebook-replace { display: flex; align-items: center; gap: 5px; padding: 6px 14px; font-size: 12px; border-bottom: 1px solid var(--app-border); }
  input { min-width: 80px; flex: 1; background: var(--app-surface); color: var(--app-text); border: 1px solid var(--app-border); padding: 5px; }
</style>
