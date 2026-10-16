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
        fontFamily: APP_FONT_FAMILY, ...textZoomOptions(entry.id), minimap: { enabled: false },
        scrollBeyondLastLine: false, wordWrap: 'on', lineNumbers: syntax === 'code' && lineNumbers ? 'on' : 'off',
        folding: false, stickyScroll: { enabled: false }, glyphMargin: false, lineDecorationsWidth: 8,
        lineNumbersMinChars: 3, padding: { top: 10, bottom: 10 }, fixedOverflowWidgets: true,
        ariaLabel: `${syntax === 'code' ? 'Code' : syntax === 'markdown' ? 'Markdown' : 'Raw'} cell editor`,
        scrollbar: { vertical: 'hidden', horizontal: 'hidden', handleMouseWheel: false,
          alwaysConsumeMouseWheel: false, useShadows: false }, overviewRulerLanes: 0 });
      editor = view;
      // Reserve the complete logical cell, but render only one outer viewport.
      // CSS sticky placement and the synchronized offset keep a single user scroll.
      const scroll = container.closest('.notebook-scroll') as HTMLElement;
      const syncScroll = () => {
        const offset = Math.max(0, Math.min(height - element.clientHeight, scroll.getBoundingClientRect().top - frame.getBoundingClientRect().top));
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

<section role="group" aria-label="Notebook cell" tabindex="-1" class="notebook-cell" class:selected class:markdown-cell={kind === 'markdown'} bind:this={container} data-cell-id={cell.id} data-cell-kind={kind}>
  <div class="cell-toolbar">
    <button class="drag-handle" draggable="true" {ondragstart} {ondragend} title="Drag to move cell" aria-label="Drag to move cell">⠿</button>
    <button class="execution" aria-label="Select cell" title="Select cell · Shift selects a range · Ctrl/Cmd toggles selection" onclick={onselect}>{kind === 'code' ? `[${executionState === 'running' ? '*' : executionState === 'queued' ? '…' : clear ? ' ' : count ?? ' '}]` : kind === 'raw' ? 'Raw' : 'Md'}</button>
    <select aria-label="Cell type" value={kind} onchange={event => entry.document.convert(cell.id, event.currentTarget.value as CellKind)}>
      <option value="code">Code</option><option value="markdown">Markdown</option><option value="raw">Raw</option>
    </select>
    {#if kind === 'markdown'}<button onclick={() => editing ? editing = false : void edit()}>{editing ? 'Preview' : 'Edit'}</button>{/if}
    {#if kind === 'code' && entry.document.language === 'python'}<button aria-label="Run cell" title="Run cell (Ctrl/Cmd+Enter)" onclick={() => run()}>▶ Run</button>{/if}
    <span class="cell-state" title={duration === undefined ? executionState : `${executionState} · ${(duration / 1000).toFixed(2)} s`}>{executionState === 'succeeded' ? '✓' : executionState === 'error' ? 'Error' : executionState === 'queued' ? 'Queued' : executionState === 'canceled' ? 'Canceled' : executionState === 'skipped' ? 'Skipped' : ''}</span>
    <span class="spacer"></span>
    <div class="cell-actions">
    <button aria-label="Collapse cell input" title="Collapse input" onclick={() => entry.controller.toggleInput(cell.id)}>−</button>
    <button title="Move cell up" aria-label="Move cell up" onclick={() => entry.document.move(cell.id, -1)}>↑</button>
    <button title="Move cell down" aria-label="Move cell down" onclick={() => entry.document.move(cell.id, 1)}>↓</button>
    <button title="Add code cell below" aria-label="Add code cell below" onclick={() => entry.document.add('code', cell.id)}>+</button>
    <button title="Duplicate cell" aria-label="Duplicate cell" onclick={() => entry.document.duplicate(cell.id)}>⧉</button>
    {#if kind === 'code' && outputs.length && !clear}<button onclick={() => entry.document.clear(cell.id)}>Clear output</button>{/if}
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
    <div class="cell-markdown" ondblclick={edit} onclick={link} onkeydown={event => { if (event.key === 'Enter') link(event); }}>
      {#if renderError}<p role="alert">{renderError}</p><pre>{source.slice(0, 4000)}</pre>
      {:else if !source}<p class="hint">Double-click to write Markdown.</p>
      {:else if !html || renderedSource !== source}<pre>{source.slice(0, 4000)}</pre>{:else}{@html html}{/if}
    </div>
  {/if}
  {#if kind === 'code' && outputs.length && !clear}
    <div class="output-toolbar">
      <button onclick={() => entry.controller.toggleOutput(cell.id)} aria-label={collapsedOutput ? 'Expand cell output' : 'Collapse cell output'}>{collapsedOutput ? '▸ Show output' : '▾ Output'}</button>
      {#if source !== executedSource}<span>From an earlier version of this cell</span>{/if}
    </div>
    {#if !collapsedOutput}
      {#if nearby || focused || selectionHeld}<div use:measureOutput><NotebookOutputs {outputs} {path} {desktop} {ontrace} /></div>
      {:else}<div class="output-placeholder" style:height={`${outputHeight}px`} aria-hidden="true"></div>{/if}
    {/if}
  {/if}
</section>

<style>
  .notebook-cell { margin: 0 0 18px; border: 1px solid var(--app-border); border-radius: 5px; background: var(--app-editor-background); min-width: 0; }
  .notebook-cell.selected, .notebook-cell:focus-within { border-color: var(--app-accent); }
  .cell-toolbar { display: flex; align-items: center; gap: 5px; padding: 4px 8px; min-height: 32px; color: var(--app-muted-text); background: var(--app-surface); border-radius: 5px 5px 0 0; font-size: 12px; }
  button, select { font: inherit; color: inherit; background: transparent; border: 1px solid transparent; border-radius: 3px; padding: 3px 6px; cursor: pointer; }
  select { max-width: 110px; } option { background: var(--app-surface); }
  button:hover, select:hover { background: var(--app-hover); color: var(--app-text); }
  button:focus-visible, select:focus-visible { outline: 1px solid var(--app-focus-ring); }
  .drag-handle { cursor: grab; font-size: 16px; }
  button:disabled { opacity: .4; cursor: default; }
  .cell-actions { display: flex; gap: 2px; opacity: 0; }
  .notebook-cell:hover .cell-actions, .notebook-cell:focus-within .cell-actions, .notebook-cell.selected .cell-actions { opacity: 1; }
  .cell-state, .output-toolbar { font-size: 11px; color: var(--app-muted-text); }
  .output-toolbar { display: flex; align-items: center; gap: 12px; padding: 2px 10px; border-top: 1px solid var(--app-border); }
  .collapsed-input { display: block; padding: 10px 16px; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .spacer { flex: 1; } .execution { min-width: 35px; font-variant-numeric: tabular-nums; }
  .cell-editor { min-height: 65px; position: relative; }
  .editor-viewport { position: sticky; top: 0; }
  .cell-editor > pre { margin: 0; padding: 12px; } pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 12px; font: inherit; }
  .cell-markdown { padding: 8px 22px 18px; overflow-wrap: anywhere; line-height: 1.7; contain: content; }
  .cell-markdown :global(img) { max-width: 100%; }
  .cell-markdown :global(table) { border-collapse: collapse; }
  .cell-markdown :global(td), .cell-markdown :global(th) { border: 1px solid var(--app-border); padding: 5px 10px; }
  .cell-markdown :global(pre) { white-space: pre-wrap; overflow-wrap: anywhere; }
  .cell-markdown :global(a) { color: var(--app-accent); }
  .hint { color: var(--app-muted-text); font-size: 12px; }
</style>
