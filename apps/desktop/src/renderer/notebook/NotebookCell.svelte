<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type * as M from 'monaco-editor';
  import type { NotebookCell, CellKind } from '../../core/notebook/notebook-document';
  import type { NotebookEntry } from './notebook-store';
  import type { DesktopPort } from '../ports/desktop-port';
  import type { PreviewThemeId } from '../../core/preview/preview-preferences';
  import { monacoThemeName } from '../theme';
  import { onTextZoom, textZoomOptions } from '../editor/text-zoom';
  import type { CellExecutionState } from './notebook-execution';
  import { notebookHtml } from './notebook-content';
  import type { TraceTarget } from '../../core/notebook/notebook-tools';
  import NotebookIcon from './NotebookIcon.svelte';
  import NotebookMenu from './NotebookMenu.svelte';
  import NotebookOutputs from './NotebookOutputs.svelte';
  let { entry, cell, revision, api, active, path, desktop, theme, onfocus, onmodel, reveal, run, executionState, duration, selected, collapsedInput, collapsedOutput, onselect, onrunNext, ondragstart, ondragend, lineNumbers, wordWrap, outputWordWrap, ontrace, onready }: {
    entry: NotebookEntry; cell: NotebookCell; revision: number; api: typeof M | null; active: boolean; path: string;
    desktop: DesktopPort; theme: PreviewThemeId; onfocus(): void; onmodel(): void;
    run(): unknown; executionState?: CellExecutionState; duration?: number; selected: boolean; collapsedInput: boolean; collapsedOutput: boolean;
    onselect(event?: MouseEvent): void; onrunNext(insert: boolean): void;
    onready(id: string, ready: boolean): void;
    lineNumbers: boolean; wordWrap: boolean; outputWordWrap: boolean; ontrace(target: TraceTarget): Promise<void>;
    ondragstart(event: DragEvent): void; ondragend(): void;
    reveal?: { id: string; range: M.IRange; sequence: number; edit?: boolean };
  } = $props();
  let container: HTMLElement;
  let host = $state<HTMLDivElement>(), viewportHost = $state<HTMLDivElement>();
  let nearby = $state(false), editing = $state(false), html = $state(''), renderError = $state('');
  let renderedSource = $state<string>();
  let editor = $state.raw<M.editor.IStandaloneCodeEditor>();
  let observed = $state(false);
  let focused = $state(false), selectionHeld = $state(false), composing = $state(false), outputHeight = $state(0);
  const source = $derived.by(() => { void revision; return cell.source; });
  const kind = $derived.by(() => { void revision; return cell.kind; });
  const outputs = $derived.by(() => { void revision; return cell.outputs; });
  const count = $derived.by(() => { void revision; return cell.executionCount; });
  const executedSource = $derived.by(() => { void revision; return cell.executedSource ?? cell.originalSource; });
  const clear = $derived.by(() => { void revision; return cell.clearOutputs; });
  const sourceMode = $derived(kind !== 'markdown' || editing);
  const keepEditor = $derived(active && sourceMode && !collapsedInput && (nearby || focused || composing));

  let height = $state(100);
  $effect(() => {
    if (!active) { nearby = false; observed = false; return; }
    const observer = new IntersectionObserver(entries => { nearby = entries[0].isIntersecting; observed = true; },
      { root: container.closest('.notebook-scroll'), rootMargin: '250px' });
    observer.observe(container); return () => observer.disconnect();
  });
  onMount(() => {
    const selection = () => { const range = window.getSelection(); selectionHeld = !!range && !range.isCollapsed && (container.contains(range.anchorNode) || container.contains(range.focusNode)); };
    document.addEventListener('selectionchange', selection);
    return () => document.removeEventListener('selectionchange', selection);
  });
  // Release Chromium's native EditContext while its DOM is still attached.
  // A post-update cleanup can leave ordinary inputs receiving beforeinput but no text.
  $effect.pre(() => {
    if (!api || !host || !viewportHost || !keepEditor) return;
    const syntax = kind, monaco = api, element = viewportHost, frame = host;
    return untrack(() => {
      const model = entry.model(monaco, cell);
      const view = monaco.editor.create(element, { model, theme: monacoThemeName(theme), automaticLayout: true,
        // Virtual cell views are destroyed/recreated independently of DOM focus.
        // Monaco's supported textarea input keeps Chromium's native EditContext
        // from retaining an input target after an offscreen cell is retired.
        editContext: false,
        renderLineHighlightOnlyWhenFocus: true,
        fontFamily: monaco.editor.EditorOptions.fontFamily.defaultValue, ...textZoomOptions(entry.id), lineHeight: 0, minimap: { enabled: false },
        scrollBeyondLastLine: false, wordWrap: wordWrap ? 'on' : 'off', lineNumbers: syntax === 'code' && lineNumbers ? 'on' : 'off',
        folding: true, showFoldingControls: 'mouseover', stickyScroll: { enabled: false }, glyphMargin: false, lineDecorationsWidth: 12,
        lineNumbersMinChars: 3, padding: { top: 12, bottom: 4 }, fixedOverflowWidgets: true,
        ariaLabel: `${syntax === 'code' ? 'Code' : syntax === 'markdown' ? 'Markdown' : 'Raw'} cell editor`,
        scrollbar: { vertical: 'hidden', horizontal: 'auto', handleMouseWheel: false,
          alwaysConsumeMouseWheel: false, useShadows: false }, overviewRulerLanes: 0 });
      editor = view;
      // Reserve the complete logical cell, but render only one outer viewport.
      // CSS sticky placement and the synchronized offset keep a single user scroll.
      const scroll = container.closest('.notebook-scroll') as HTMLElement;
      const syncScroll = () => {
        // Follow the actual sticky placement, including its clamp at the cell's end.
        const offset = Math.max(0, element.getBoundingClientRect().top - frame.getBoundingClientRect().top);
        if (Math.abs(view.getScrollTop() - offset) > .5) view.setScrollPosition({ scrollTop: offset });
        // Monaco scrolls in integer CSS pixels; sticky layout can be fractional
        // under app zoom, especially at the cell's end. Compensate the actual
        // rendered editor, without moving its viewport or changing scroll height.
        view.getDomNode()!.style.top = `${view.getScrollTop() - offset}px`;
      };
      const updateHeight = () => {
        const next = Math.max(35, view.getContentHeight()), viewportHeight = Math.min(next, Math.max(35, scroll.clientHeight));
        height = next;
        frame.style.height = `${next}px`;
        if (element.style.height !== `${viewportHeight}px`) {
          element.style.height = `${viewportHeight}px`;
          view.layout({ width: frame.clientWidth, height: viewportHeight });
        }
        syncScroll();
      };
      const horizontalWheel = (event: WheelEvent) => {
        const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
        if (!delta || view.getScrollWidth() <= element.clientWidth) return;
        event.preventDefault(); event.stopPropagation();
        view.setScrollLeft(view.getScrollLeft() + delta * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 20 : 1));
      };
      element.addEventListener('wheel', horizontalWheel, { passive: false });
      const size = view.onDidContentSizeChange(updateHeight); updateHeight();
      scroll.addEventListener('scroll', syncScroll, { passive: true });
      const viewportSize = new ResizeObserver(updateHeight); viewportSize.observe(scroll);
      const focus = view.onDidFocusEditorText(() => { focused = true; onfocus(); onselect(); });
      const blur = view.onDidBlurEditorText(() => { focused = false; });
      const startComposition = view.onDidCompositionStart(() => { composing = true; });
      const endComposition = view.onDidCompositionEnd(() => { composing = false; });
      if (syntax === 'code') view.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => { if (!composing) run(); });
      view.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => { if (!composing) { if (syntax === 'markdown') void preview().then(ready => { if (ready) onrunNext(false); }); else onrunNext(false); } });
      view.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.Enter, () => { if (!composing) { if (syntax === 'markdown') void preview().then(ready => { if (ready) onrunNext(true); }); else onrunNext(true); } });
      view.addCommand(monaco.KeyCode.Escape, () => { if (!composing) { if (syntax === 'markdown') void preview(); else { container.focus(); onselect(); } } },
        '!suggestWidgetVisible && !findInputFocussed && !renameInputVisible');
      const zoom = onTextZoom(id => { if (!id || id === entry.id) { view.updateOptions({ ...textZoomOptions(entry.id), lineHeight: 0 }); updateHeight(); } });
      const saved = entry.views.get(cell.id); if (saved) view.restoreViewState(saved);
      syncScroll();
      const cursor = view.onDidChangeCursorPosition(event => {
        entry.controller.cursors.set(cell.id, model.getOffsetAt(event.position));
        if (!view.hasTextFocus() || composing || event.source === 'mouse') return;
        const scroll = container.closest('.notebook-scroll'); if (!(scroll instanceof HTMLElement)) return;
        const viewport = scroll.getBoundingClientRect(), bounds = frame.getBoundingClientRect();
        const top = bounds.top + view.getTopForPosition(event.position.lineNumber, event.position.column);
        const lineHeight = view.getOption(monaco.editor.EditorOption.lineHeight);
        if (top < viewport.top + 12) scroll.scrollTop += top - viewport.top - 12;
        else if (top + lineHeight > viewport.bottom - 12) scroll.scrollTop += top + lineHeight - viewport.bottom + 12;
      });
      untrack(() => onmodel());
      return () => { element.removeEventListener('wheel', horizontalWheel); entry.views.set(cell.id, view.saveViewState()); scroll.removeEventListener('scroll', syncScroll); viewportSize.disconnect(); cursor.dispose(); startComposition.dispose(); endComposition.dispose(); zoom(); size.dispose(); focus.dispose(); blur.dispose(); view.dispose(); if (editor === view) editor = undefined; };
    });
  });
  $effect(() => { editor?.updateOptions({ lineNumbers: kind === 'code' && lineNumbers ? 'on' : 'off', wordWrap: wordWrap ? 'on' : 'off' }); });
  $effect(() => {
    if (!active || !nearby || sourceMode || kind !== 'markdown' || renderedSource === source) return;
    const text = source, version = cell.version; let canceled = false;
    renderError = '';
    if (text.length > 1024 * 1024) { renderError = 'This Markdown cell is too large to preview. Its complete source is preserved.'; return; }
    void desktop.renderNotebookMarkdown(path, text).then(result => {
      if (!canceled && version === cell.version) { html = notebookHtml(result.html, result.baseHref, cell.attachments); renderedSource = text; }
    }).catch(error => { if (!canceled) renderError = String(error); });
    return () => { canceled = true; };
  });
  $effect(() => {
    if (!reveal || reveal.id !== cell.id) return;
    const target = reveal; if (target.edit !== false) editing = true; nearby = true;
    void tick().then(() => {
      revealInNotebook(container);
      if (target.edit !== false) { editor?.focus(); editor?.setSelection(target.range); }
      else if (editor) editor.setSelection(target.range);
      else {
        const line = container.querySelector(`[data-source-line="${target.range.startLineNumber}"]`);
        if (line) revealInNotebook(line);
      }
    });
  });
  // The first notebook frame waits for geometry and visible Markdown. An
  // IntersectionObserver still reports geometry while the parent is hidden.
  $effect(() => {
    const ready = observed && (!nearby || collapsedInput || (sourceMode ? !!editor : !source || renderedSource === source || !!renderError));
    untrack(() => onready(cell.id, ready));
  });
  async function preview(): Promise<boolean> {
    if (composing) return false;
    const text = cell.source, version = cell.version;
    if (renderedSource !== text) {
      try {
        if (text.length > 1024 * 1024) throw Error('This Markdown cell is too large to preview. Its complete source is preserved.');
        const result = await desktop.renderNotebookMarkdown(path, text);
        if (version !== cell.version || composing) return false;
        html = notebookHtml(result.html, result.baseHref, cell.attachments); renderedSource = text; renderError = '';
      } catch (error) { if (version !== cell.version) return false; renderError = String(error); }
    }
    editing = false; await tick(); container.focus({ preventScroll: true }); onselect(); return true;
  }
  function revealInNotebook(element: Element) {
    const scroll = container.closest('.notebook-scroll') as HTMLElement, bounds = element.getBoundingClientRect();
    scroll.scrollTop += bounds.top - scroll.getBoundingClientRect().top - Math.max(12, (scroll.clientHeight - bounds.height) / 2);
  }
  async function edit(event?: MouseEvent) {
    const line = event?.target instanceof Element ? Number(event.target.closest('[data-source-line]')?.getAttribute('data-source-line')) : 0;
    editing = true; nearby = true; await tick();
    editor?.focus();
    if (line > 0 && editor) editor.setPosition({ lineNumber: Math.min(line, editor.getModel()!.getLineCount()), column: 1 });
  }
  function measureOutput(node: HTMLElement) {
    const observer = new ResizeObserver(() => { outputHeight = node.getBoundingClientRect().height; });
    observer.observe(node); return { destroy: () => observer.disconnect() };
  }
  function link(event: Event) {
    const anchor = (event.target as HTMLElement).closest('a'); if (!anchor) return;
    event.preventDefault(); const href = anchor.getAttribute('href'); if (href) void desktop.openLink(href);
  }
</script>

<section role="group" aria-label="Notebook cell" tabindex="-1" class="notebook-cell" class:selected class:editor-focused={focused} class:markdown-cell={kind === 'markdown'} class:reading={!sourceMode} bind:this={container} data-cell-id={cell.id} data-cell-kind={kind}>
  <div class="cell-gutter">
    {#if kind === 'code' && entry.document.language === 'python'}<button class="run-cell" aria-label="Run cell" title="Run cell (Ctrl/Cmd+Enter)" onclick={() => run()}><NotebookIcon name={executionState === 'running' ? 'sync' : 'play'} spinning={executionState === 'running'} /></button>{/if}
    <button class="drag-handle" draggable="true" {ondragstart} {ondragend} title="Drag to move cell" aria-label="Drag to move cell"><NotebookIcon name="gripper" /></button>
  </div>
  <div class="cell-toolbar" role="group" aria-label="Cell actions">
    {#if kind === 'markdown'}<button aria-label={editing ? 'Preview' : 'Edit'} title={editing ? 'Preview Markdown' : 'Edit Markdown'} onclick={() => editing ? void preview() : void edit()}><NotebookIcon name={editing ? 'check' : 'edit'} /></button>{/if}
    <button title="Move cell up" aria-label="Move cell up" onclick={() => entry.document.move(cell.id, -1)}><NotebookIcon name="up" /></button>
    <button title="Move cell down" aria-label="Move cell down" onclick={() => entry.document.move(cell.id, 1)}><NotebookIcon name="down" /></button>
    <NotebookMenu label="More cell actions" onopen={() => onselect()}>
      <label>Cell type<select aria-label="Cell type" value={kind} onchange={event => entry.document.convert(cell.id, event.currentTarget.value as CellKind)}><option value="code">Code</option><option value="markdown">Markdown</option><option value="raw">Raw</option></select></label>
      <button onclick={() => entry.controller.toggleInput(cell.id)}>{collapsedInput ? 'Expand cell input' : 'Collapse cell input'}</button>
      <button onclick={() => entry.controller.lineNumbers(cell.id)}>Toggle cell line numbers</button>
      <button onclick={() => entry.document.add('code', cell.id)}>Add code cell below</button>
      <button onclick={() => entry.document.duplicate(cell.id)}>Duplicate cell</button>
      {#if kind === 'code' && outputs.length && !clear}<hr />
        <button onclick={() => entry.controller.toggleOutput(cell.id)}>{collapsedOutput ? 'Expand cell output' : 'Collapse cell output'}</button>
        <button onclick={() => entry.document.clear(cell.id)}>Clear output</button>
      {/if}
    </NotebookMenu>
    <button title="Delete cell (Undo Cell Operation restores it)" aria-label="Delete cell" onclick={() => entry.document.remove(cell.id)}><NotebookIcon name="trash" /></button>
  </div>
  <div class="cell-input" class:source-mode={sourceMode && !collapsedInput}>
  {#if collapsedInput}
    <button class="collapsed-input" aria-label="Expand cell input" onclick={() => entry.controller.toggleInput(cell.id)}>{source.split(/\r\n|\r|\n/)[0] || 'Empty cell'} …</button>
  {:else if sourceMode}
    <div class="cell-editor" bind:this={host} style:height={`${height}px`}>
      {#if !api || !keepEditor}<div class="editor-placeholder" aria-hidden="true"></div>
      {:else}<div class="editor-viewport" bind:this={viewportHost} style:height="65px"></div>{/if}
    </div>
  {:else}
    <!-- The reader remains selectable; a separate Edit button also supports keyboards. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="cell-markdown notebook-prose" ondblclick={edit} onclick={link} onkeydown={event => { if (event.key === 'Enter') link(event); }}>
      {#if renderError}<p role="alert">{renderError}</p><pre>{source.slice(0, 4000)}</pre>
      {:else if !source}<p class="hint">Double-click to write Markdown.</p>
      {:else if html && renderedSource === source}{@html html}{:else}<div class="markdown-placeholder" aria-label="Rendering Markdown"></div>{/if}
    </div>
  {/if}
  <div class="cell-status">
    <button class="execution" aria-label="Select cell" aria-pressed={selected} title="Select cell · Shift selects a range · Ctrl/Cmd toggles selection" onclick={onselect}>{kind === 'code' ? `[${executionState === 'running' ? '*' : executionState === 'queued' ? '…' : clear ? ' ' : count ?? ' '}]` : kind === 'raw' ? 'Raw' : 'Md'}</button>
    {#if executionState}<span class="cell-state" class:error-state={executionState === 'error'} role="status">
      <span title={executionState}>{#if executionState === 'succeeded'}<NotebookIcon name="check" />{:else if executionState === 'running'}<NotebookIcon name="sync" spinning />{:else}{executionState}{/if}</span>
      {#if duration !== undefined}<span>{(duration / 1000).toFixed(2)}s</span>{/if}
    </span>{/if}
    {#if sourceMode}<span class="cell-language">{kind === 'code' ? entry.document.language : kind === 'markdown' ? 'Markdown' : 'Raw'}</span>{/if}
  </div>
  </div>
  {#if kind === 'code' && outputs.length && !clear}
    {#if source !== executedSource}<div class="output-stale" role="status">From an earlier version of this cell</div>{/if}
    {#if collapsedOutput}<button class="collapsed-output" onclick={() => entry.controller.toggleOutput(cell.id)}>▸ Show output</button>{/if}
    {#if !collapsedOutput}
      {#if nearby || focused || selectionHeld}<div use:measureOutput><NotebookOutputs {outputs} {path} {desktop} {ontrace} wordWrap={outputWordWrap} /></div>
      {:else}<div class="output-placeholder" style:height={`${outputHeight}px`} aria-hidden="true"></div>{/if}
    {/if}
  {/if}
</section>

<style>
  .notebook-cell { position: relative; padding-left: 36px; min-width: 0; min-height: 35px; outline: none; }
  .notebook-cell::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; border-radius: 2px; background: transparent; }
  .notebook-cell.selected::before { background: var(--app-accent); }
  .notebook-cell:focus-visible::before { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .cell-gutter { position: absolute; left: 6px; top: 6px; width: 24px; display: flex; flex-direction: column; color: var(--notebook-secondary-text); }
  .cell-gutter button, .cell-toolbar > button { width: 24px; height: 24px; padding: 3px; display: inline-flex; align-items: center; justify-content: center; }
  .execution { position: absolute; left: -36px; width: 36px; padding: 0; min-height: 22px; font-family: var(--notebook-code-font); font-variant-numeric: tabular-nums; font-size: 11px; }
  .cell-toolbar { position: absolute; right: 16px; top: -14px; z-index: 2; display: flex; align-items: center; gap: 2px; padding: 2px; color: var(--app-text); background: var(--app-surface); border: 1px solid var(--notebook-cell-border); border-radius: 5px; font-size: 12px; opacity: 0; }
  button { font: inherit; color: inherit; background: transparent; border: 1px solid transparent; border-radius: 3px; cursor: pointer; white-space: nowrap; }
  button:hover { background: var(--app-hover); color: var(--app-text); }
  button:focus-visible { outline: 1px solid var(--app-focus-ring); }
  .cell-gutter .drag-handle { position: absolute; top: -20px; left: 0; height: 16px; cursor: grab; opacity: 0; }
  .notebook-cell:hover .cell-toolbar, .notebook-cell:focus-within .cell-toolbar, .notebook-cell.selected .cell-toolbar,
  .notebook-cell:hover .drag-handle, .notebook-cell:focus-within .drag-handle, .notebook-cell.selected .drag-handle { opacity: 1; }
  .cell-input { position: relative; }
  .source-mode { border-radius: 6px; background: var(--notebook-input-background); }
  /* Monaco paints its own backgrounds. Draw the frame above them so its top and
     side edges stay visible, without clipping sticky editors or popup widgets. */
  .source-mode::after { content: ''; position: absolute; inset: 0; z-index: 1; border: 1px solid var(--notebook-cell-border); border-radius: inherit; pointer-events: none; }
  .editor-focused .source-mode::after { border-color: var(--app-focus-ring); }
  .source-mode :global(.monaco-editor), .source-mode :global(.monaco-editor-background), .source-mode :global(.monaco-editor .margin) { background: var(--notebook-input-background); }
  .source-mode :global(.monaco-editor) { border-radius: 6px 6px 0 0; }
  .cell-status { height: 22px; display: flex; align-items: center; padding: 0 8px; font-size: 12px; color: var(--notebook-secondary-text); }
  .reading .cell-status { height: 0; }
  .cell-state { display: inline-flex; align-items: center; gap: 4px; }
  .cell-state > span { display: inline-flex; }
  .cell-language { margin-left: auto; text-transform: capitalize; }
  .error-state { color: var(--app-danger-text); }
  .output-stale { margin: 4px 0; padding: 4px 8px; border-left: 2px solid var(--app-warning-border); background: var(--app-warning-surface); color: var(--app-warning-text); font-size: 12px; }
  .collapsed-output { color: var(--notebook-secondary-text); margin: 8px 0; }
  .collapsed-input { display: block; padding: 10px 8px; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .cell-editor { min-height: 35px; position: relative; }
  .editor-viewport { position: sticky; top: 0; }
  .editor-placeholder { height: 100%; }
  .markdown-placeholder { min-height: 64px; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font-family: var(--notebook-code-font); }
  .cell-markdown { padding: 8px; overflow-x: auto; contain: content; }
  .reading .execution { bottom: 0; opacity: 0; }
  .reading:hover .execution, .reading.selected .execution, .reading:focus-within .execution { opacity: 1; }
  .hint { color: var(--notebook-secondary-text); }
</style>
