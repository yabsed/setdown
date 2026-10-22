<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type * as M from 'monaco-editor';
  import type { NotebookCell, CellKind } from '../../core/notebook/notebook-document';
  import type { NotebookEntry } from './notebook-store';
  import type { DesktopPort } from '../ports/desktop-port';
  import type { PreviewThemeId } from '../../core/preview/preview-preferences';
  import { APP_FONT_FAMILY } from '../../core/theme/typography';
  import { monacoThemeName } from '../theme';
  import { onTextZoom, textZoomOptions } from '../editor/text-zoom';
  import type { CellExecutionState } from './notebook-execution';
  import { notebookHtml } from './notebook-content';
  import type { TraceTarget } from '../../core/notebook/notebook-tools';
  import NotebookOutputs from './NotebookOutputs.svelte';
  let { entry, cell, revision, api, active, path, desktop, theme, onfocus, onmodel, reveal, run, executionState, duration, selected, collapsedInput, collapsedOutput, onselect, onrunNext, ondragstart, ondragend, lineNumbers, ontrace }: {
    entry: NotebookEntry; cell: NotebookCell; revision: number; api: typeof M | null; active: boolean; path: string;
    desktop: DesktopPort; theme: PreviewThemeId; onfocus(): void; onmodel(): void;
    run(): unknown; executionState?: CellExecutionState; duration?: number; selected: boolean; collapsedInput: boolean; collapsedOutput: boolean;
    onselect(event?: MouseEvent): void; onrunNext(insert: boolean): void;
    lineNumbers: boolean; ontrace(target: TraceTarget): Promise<void>;
    ondragstart(event: DragEvent): void; ondragend(): void;
    reveal?: { id: string; range: M.IRange; sequence: number; edit?: boolean };
  } = $props();
  let container: HTMLElement;
  let host = $state<HTMLDivElement>(), viewportHost = $state<HTMLDivElement>();
  let nearby = $state(false), editing = $state(false), html = $state(''), renderError = $state('');
  let renderedSource = $state<string>();
  let editor: M.editor.IStandaloneCodeEditor | undefined;
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
  onMount(() => {
    const observer = new IntersectionObserver(entries => { nearby = entries[0].isIntersecting; },
      { root: container.closest('.notebook-scroll'), rootMargin: '250px' });
    const selection = () => { const range = window.getSelection(); selectionHeld = !!range && !range.isCollapsed && (container.contains(range.anchorNode) || container.contains(range.focusNode)); };
    document.addEventListener('selectionchange', selection);
    observer.observe(container); return () => { observer.disconnect(); document.removeEventListener('selectionchange', selection); };
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
        fontFamily: APP_FONT_FAMILY, ...textZoomOptions(entry.id), minimap: { enabled: false },
        scrollBeyondLastLine: false, wordWrap: 'on', lineNumbers: syntax === 'code' && lineNumbers ? 'on' : 'off',
        folding: false, stickyScroll: { enabled: false }, glyphMargin: false, lineDecorationsWidth: 8,
        lineNumbersMinChars: 3, padding: { top: 16, bottom: 12 }, fixedOverflowWidgets: true,
        ariaLabel: `${syntax === 'code' ? 'Code' : syntax === 'markdown' ? 'Markdown' : 'Raw'} cell editor`,
        scrollbar: { vertical: 'hidden', horizontal: 'hidden', handleMouseWheel: false,
          alwaysConsumeMouseWheel: false, useShadows: false }, overviewRulerLanes: 0 });
      editor = view;
      // Reserve the complete logical cell, but render only one outer viewport.
      // CSS sticky placement and the synchronized offset keep a single user scroll.
      const scroll = container.closest('.notebook-scroll') as HTMLElement;
      const syncScroll = () => {
        // Follow the actual sticky placement, including its clamp at the cell's end.
        const offset = Math.max(0, Math.min(height - element.clientHeight, element.getBoundingClientRect().top - frame.getBoundingClientRect().top));
        if (Math.abs(view.getScrollTop() - offset) > .5) view.setScrollPosition({ scrollTop: offset, scrollLeft: 0 });
      };
      const updateHeight = () => {
        const next = Math.max(65, view.getContentHeight()), viewportHeight = Math.min(next, Math.max(65, scroll.clientHeight));
        height = next;
        frame.style.height = `${next}px`;
        if (element.style.height !== `${viewportHeight}px`) {
          element.style.height = `${viewportHeight}px`;
          view.layout({ width: frame.clientWidth, height: viewportHeight });
        }
        syncScroll();
      };
      const size = view.onDidContentSizeChange(updateHeight); updateHeight();
      scroll.addEventListener('scroll', syncScroll, { passive: true });
      const viewportSize = new ResizeObserver(updateHeight); viewportSize.observe(scroll);
      const focus = view.onDidFocusEditorText(() => { focused = true; onfocus(); onselect(); });
      const blur = view.onDidBlurEditorText(() => { focused = false; });
      const startComposition = view.onDidCompositionStart(() => { composing = true; });
      const endComposition = view.onDidCompositionEnd(() => { composing = false; });
      if (syntax === 'code') view.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => { if (!composing) run(); });
      view.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => { if (!composing) { if (syntax === 'markdown') editing = false; onrunNext(false); } });
      view.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.Enter, () => { if (!composing) { if (syntax === 'markdown') editing = false; onrunNext(true); } });
      view.addCommand(monaco.KeyCode.Escape, () => { if (!composing) { if (syntax === 'markdown') editing = false; container.focus(); onselect(); } },
        '!suggestWidgetVisible && !findInputFocussed && !renameInputVisible');
      const zoom = onTextZoom(id => { if (!id || id === entry.id) { view.updateOptions(textZoomOptions(entry.id)); updateHeight(); } });
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
      return () => { entry.views.set(cell.id, view.saveViewState()); scroll.removeEventListener('scroll', syncScroll); viewportSize.disconnect(); cursor.dispose(); startComposition.dispose(); endComposition.dispose(); zoom(); size.dispose(); focus.dispose(); blur.dispose(); view.dispose(); if (editor === view) editor = undefined; };
    });
  });
  $effect(() => { editor?.updateOptions({ lineNumbers: kind === 'code' && lineNumbers ? 'on' : 'off' }); });
  $effect(() => {
    if (!active || !nearby || sourceMode || kind !== 'markdown') return;
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
    {#if kind === 'code' && entry.document.language === 'python'}<button class="run-cell" aria-label="Run cell" title="Run cell (Ctrl/Cmd+Enter)" onclick={() => run()}>▷</button>{/if}
    <button class="drag-handle" draggable="true" {ondragstart} {ondragend} title="Drag to move cell" aria-label="Drag to move cell">⠿</button>
    <button class="execution" aria-label="Select cell" aria-pressed={selected} title="Select cell · Shift selects a range · Ctrl/Cmd toggles selection" onclick={onselect}>{kind === 'code' ? `[${executionState === 'running' ? '*' : executionState === 'queued' ? '…' : clear ? ' ' : count ?? ' '}]` : kind === 'raw' ? 'Raw' : 'Md'}</button>
  </div>
  <div class="cell-toolbar" role="group" aria-label="Cell actions">
    <select aria-label="Cell type" value={kind} onchange={event => entry.document.convert(cell.id, event.currentTarget.value as CellKind)}>
      <option value="code">Code</option><option value="markdown">Markdown</option><option value="raw">Raw</option>
    </select>
    {#if kind === 'markdown'}<button onclick={() => editing ? editing = false : void edit()}>{editing ? 'Preview' : 'Edit'}</button>{/if}
    <div class="cell-actions">
    <button aria-label="Collapse cell input" title="Collapse input" onclick={() => entry.controller.toggleInput(cell.id)}>−</button>
    <button title="Move cell up" aria-label="Move cell up" onclick={() => entry.document.move(cell.id, -1)}>↑</button>
    <button title="Move cell down" aria-label="Move cell down" onclick={() => entry.document.move(cell.id, 1)}>↓</button>
    <button title="Add code cell below" aria-label="Add code cell below" onclick={() => entry.document.add('code', cell.id)}>+</button>
    <button title="Duplicate cell" aria-label="Duplicate cell" onclick={() => entry.document.duplicate(cell.id)}>⧉</button>
    {#if kind === 'code' && outputs.length && !clear}
      <button onclick={() => entry.controller.toggleOutput(cell.id)} aria-label={collapsedOutput ? 'Expand cell output' : 'Collapse cell output'} title={collapsedOutput ? 'Expand output' : 'Collapse output'}>{collapsedOutput ? '▸' : '▾'}</button>
      <button onclick={() => entry.document.clear(cell.id)}>Clear output</button>
    {/if}
    <button title="Delete cell (Undo Cell Operation restores it)" aria-label="Delete cell" onclick={() => entry.document.remove(cell.id)}>×</button>
    </div>
  </div>
  {#if collapsedInput}
    <button class="collapsed-input" aria-label="Expand cell input" onclick={() => entry.controller.toggleInput(cell.id)}>{source.split(/\r\n|\r|\n/)[0] || 'Empty cell'} …</button>
  {:else if sourceMode}
    <div class="cell-editor" bind:this={host} style:height={`${height}px`}>
      {#if !api || !keepEditor}<pre>{source.slice(0, 4000) || ' '}</pre>
      {:else}<div class="editor-viewport" bind:this={viewportHost} style:height="65px"></div>{/if}
    </div>
  {:else}
    <!-- The reader remains selectable; a separate Edit button also supports keyboards. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="cell-markdown notebook-prose" ondblclick={edit} onclick={link} onkeydown={event => { if (event.key === 'Enter') link(event); }}>
      {#if renderError}<p role="alert">{renderError}</p><pre>{source.slice(0, 4000)}</pre>
      {:else if !source}<p class="hint">Double-click to write Markdown.</p>
      {:else if !html || renderedSource !== source}<pre>{source.slice(0, 4000)}</pre>{:else}{@html html}{/if}
    </div>
  {/if}
  {#if executionState}
    <div class="cell-state" class:error-state={executionState === 'error'} role="status">{executionState === 'succeeded' ? '✓ Completed' : executionState === 'running' ? 'Running…' : executionState === 'error' ? 'Error' : executionState === 'queued' ? 'Queued' : executionState === 'canceled' ? 'Canceled' : 'Skipped'}{#if duration !== undefined} · {(duration / 1000).toFixed(2)} s{/if}</div>
  {/if}
  {#if kind === 'code' && outputs.length && !clear}
    {#if source !== executedSource}<div class="output-stale" role="status">From an earlier version of this cell</div>{/if}
    {#if collapsedOutput}<button class="collapsed-output" onclick={() => entry.controller.toggleOutput(cell.id)}>▸ Show output</button>{/if}
    {#if !collapsedOutput}
      {#if nearby || focused || selectionHeld}<div use:measureOutput><NotebookOutputs {outputs} {path} {desktop} {ontrace} /></div>
      {:else}<div class="output-placeholder" style:height={`${outputHeight}px`} aria-hidden="true"></div>{/if}
    {/if}
  {/if}
</section>

<style>
  .notebook-cell { position: relative; margin: 0 0 28px; padding-left: 54px; min-width: 0; min-height: 64px; outline: none; }
  .notebook-cell::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; border-radius: 2px; background: transparent; }
  .notebook-cell.selected::before { background: var(--app-accent); }
  .notebook-cell:focus-visible::before { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .cell-gutter { position: absolute; left: 4px; top: 5px; width: 48px; display: grid; grid-template-columns: 24px 24px; align-items: center; color: var(--notebook-secondary-text); font-size: 12px; }
  .cell-gutter button { padding: 0; min-width: 24px; }
  .run-cell { font-size: 20px; grid-column: 1; }
  .execution { grid-column: 1 / -1; font-family: var(--notebook-code-font); font-variant-numeric: tabular-nums; font-size: 11px; }
  .cell-toolbar { position: absolute; right: 8px; top: 0; transform: translateY(-50%); z-index: 2; display: flex; align-items: center; gap: 2px; max-width: calc(100% - 54px); overflow-x: auto; scrollbar-width: thin; padding: 2px; color: var(--app-text); background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 5px; font-size: 12px; opacity: 0; }
  button, select { font: inherit; color: inherit; background: transparent; border: 1px solid transparent; border-radius: 3px; min-height: 26px; padding: 3px 6px; cursor: pointer; white-space: nowrap; }
  select { max-width: 110px; } option { background: var(--app-surface); }
  button:hover, select:hover { background: var(--app-hover); color: var(--app-text); }
  button:focus-visible, select:focus-visible { outline: 1px solid var(--app-focus-ring); }
  .drag-handle { cursor: grab; font-size: 16px; grid-column: 2; opacity: 0; }
  button:disabled { opacity: .4; cursor: default; }
  .cell-actions { display: flex; gap: 2px; }
  .notebook-cell:hover .cell-toolbar, .notebook-cell:focus-within .cell-toolbar, .notebook-cell.selected .cell-toolbar,
  .notebook-cell:hover .drag-handle, .notebook-cell:focus-within .drag-handle, .notebook-cell.selected .drag-handle { opacity: 1; }
  .cell-state { padding: 4px 12px 0; font-size: 12px; color: var(--notebook-secondary-text); }
  .error-state { color: var(--app-danger-text); }
  .output-stale { margin: 8px 0 4px; padding: 6px 12px; border-left: 2px solid var(--app-warning-border); background: var(--app-warning-surface); color: var(--app-warning-text); font-size: 12px; }
  .collapsed-output { color: var(--notebook-secondary-text); margin: 8px 0; }
  .collapsed-input { display: block; padding: 10px 16px; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .cell-editor { min-height: 65px; position: relative; outline: 1px solid var(--app-border); outline-offset: -1px; border-radius: 5px; background: var(--app-editor-background); }
  .editor-focused .cell-editor { outline-color: var(--app-focus-ring); }
  .editor-viewport { position: sticky; top: 0; }
  .cell-editor > pre { margin: 0; padding: 16px 12px 12px; } pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 12px; font-family: var(--notebook-code-font); }
  .cell-markdown { padding: 14px 12px 6px; contain: content; }
  .reading .execution { opacity: 0; }
  .reading:hover .execution, .reading.selected .execution, .reading:focus-within .execution { opacity: 1; }
  .hint { color: var(--notebook-secondary-text); }
</style>
