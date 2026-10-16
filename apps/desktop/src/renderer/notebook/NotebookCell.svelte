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
  import { hasNotebookMagic } from '../../core/notebook/notebook-projection';
  import { notebookHtml } from './notebook-content';
  import NotebookOutputs from './NotebookOutputs.svelte';
  let { entry, cell, revision, api, active, path, desktop, theme, onfocus, onmodel, reveal, busy, run, executionState, ondragstart, ondragend }: {
    entry: NotebookEntry; cell: NotebookCell; revision: number; api: typeof M | null; active: boolean; path: string;
    desktop: DesktopPort; theme: PreviewThemeId; onfocus(): void; onmodel(): void;
    busy: boolean; run(): unknown; executionState?: 'queued' | 'running' | 'error';
    ondragstart(event: DragEvent): void; ondragend(): void;
    reveal?: { id: string; range: M.IRange; sequence: number };
  } = $props();
  let container: HTMLElement;
  let host = $state<HTMLDivElement>();
  let nearby = $state(false), editing = $state(false), html = $state(''), renderError = $state('');
  let renderedSource = $state<string>();
  let editor: M.editor.IStandaloneCodeEditor | undefined;
  const source = $derived.by(() => { void revision; return cell.source; });
  const kind = $derived.by(() => { void revision; return cell.kind; });
  const outputs = $derived.by(() => { void revision; return cell.outputs; });
  const count = $derived.by(() => { void revision; return cell.executionCount; });
  const executedSource = $derived.by(() => { void revision; return cell.executedSource ?? cell.originalSource; });
  const clear = $derived.by(() => { void revision; return cell.clearOutputs; });
  const sourceMode = $derived(kind !== 'markdown' || editing);
  const magic = $derived(kind === 'code' && entry.document.language === 'python' && hasNotebookMagic(source));
  let height = $state(100);
  onMount(() => {
    const observer = new IntersectionObserver(entries => { nearby = entries[0].isIntersecting; },
      { root: container.closest('.notebook-scroll'), rootMargin: '250px' });
    observer.observe(container); return () => observer.disconnect();
  });
  $effect(() => {
    if (!api || !host || !active || !nearby || !sourceMode) return;
    const syntax = kind, monaco = api, element = host;
    return untrack(() => {
      const model = entry.model(monaco, cell);
      const view = monaco.editor.create(element, { model, theme: monacoThemeName(theme), automaticLayout: true,
        fontFamily: APP_FONT_FAMILY, ...textZoomOptions(entry.id), minimap: { enabled: false },
        scrollBeyondLastLine: false, wordWrap: 'on', lineNumbers: syntax === 'code' ? 'on' : 'off',
        folding: false, stickyScroll: { enabled: false }, glyphMargin: false, lineDecorationsWidth: 8,
        lineNumbersMinChars: 3, padding: { top: 10, bottom: 10 }, fixedOverflowWidgets: true,
        ariaLabel: `${syntax === 'code' ? 'Code' : syntax === 'markdown' ? 'Markdown' : 'Raw'} cell editor`,
        scrollbar: { vertical: 'hidden', horizontal: 'hidden', handleMouseWheel: false,
          alwaysConsumeMouseWheel: false, useShadows: false }, overviewRulerLanes: 0 });
      editor = view;
      // The notebook owns scrolling. Match the full wrapped content height, including
      // zoom/width changes, rather than turning long cells into nested scroll panes.
      const updateHeight = () => {
        const next = Math.max(65, view.getContentHeight());
        height = next;
        if (element.style.height !== `${next}px`) {
          element.style.height = `${next}px`;
          view.layout({ width: element.clientWidth, height: next });
        }
      };
      const size = view.onDidContentSizeChange(updateHeight); updateHeight();
      const focus = view.onDidFocusEditorText(() => onfocus());
      let composing = false;
      const startComposition = view.onDidCompositionStart(() => { composing = true; });
      const endComposition = view.onDidCompositionEnd(() => { composing = false; });
      if (syntax === 'code') view.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => { if (!composing) run(); });
      if (syntax === 'markdown') view.addCommand(monaco.KeyCode.Escape, () => { if (!composing) editing = false; },
        '!suggestWidgetVisible && !findInputFocussed && !renameInputVisible');
      const zoom = onTextZoom(id => { if (!id || id === entry.id) { view.updateOptions(textZoomOptions(entry.id)); updateHeight(); } });
      const saved = entry.views.get(cell.id); if (saved) view.restoreViewState(saved);
      view.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
      const cursor = view.onDidChangeCursorPosition(event => {
        if (!view.hasTextFocus() || composing || event.source === 'mouse') return;
        const scroll = container.closest('.notebook-scroll'); if (!(scroll instanceof HTMLElement)) return;
        const viewport = scroll.getBoundingClientRect(), bounds = element.getBoundingClientRect();
        const top = bounds.top + view.getTopForPosition(event.position.lineNumber, event.position.column);
        const lineHeight = view.getOption(monaco.editor.EditorOption.lineHeight);
        if (top < viewport.top + 12) scroll.scrollTop += top - viewport.top - 12;
        else if (top + lineHeight > viewport.bottom - 12) scroll.scrollTop += top + lineHeight - viewport.bottom + 12;
      });
      untrack(() => onmodel());
      return () => { entry.views.set(cell.id, view.saveViewState()); cursor.dispose(); startComposition.dispose(); endComposition.dispose(); zoom(); size.dispose(); focus.dispose(); view.dispose(); if (editor === view) editor = undefined; };
    });
  });
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
    const target = reveal; editing = true; nearby = true;
    void tick().then(() => { container.scrollIntoView({ block: 'center' }); editor?.focus(); editor?.setSelection(target.range); });
  });
  async function edit(event?: MouseEvent) {
    const line = event?.target instanceof Element ? Number(event.target.closest('[data-source-line]')?.getAttribute('data-source-line')) : 0;
    editing = true; nearby = true; await tick();
    editor?.focus();
    if (line > 0 && editor) editor.setPosition({ lineNumber: Math.min(line, editor.getModel()!.getLineCount()), column: 1 });
  }
  function link(event: Event) {
    const anchor = (event.target as HTMLElement).closest('a'); if (!anchor) return;
    event.preventDefault(); const href = anchor.getAttribute('href'); if (href) void desktop.openLink(href);
  }
</script>

<section class="notebook-cell" class:markdown-cell={kind === 'markdown'} bind:this={container} data-cell-id={cell.id} data-cell-kind={kind}>
  <div class="cell-toolbar">
    <button class="drag-handle" draggable="true" {ondragstart} {ondragend} title="Drag to move cell" aria-label="Drag to move cell">⠿</button>
    <span class="execution" title="Saved execution count">{kind === 'code' ? `[${executionState === 'running' ? '*' : executionState === 'queued' ? '…' : clear ? ' ' : count ?? ' '}]` : kind === 'raw' ? 'Raw' : 'Md'}</span>
    <select aria-label="Cell type" value={kind} onchange={event => entry.document.convert(cell.id, event.currentTarget.value as CellKind)}>
      <option value="code">Code</option><option value="markdown">Markdown</option><option value="raw">Raw</option>
    </select>
    {#if kind === 'markdown'}<button onclick={() => editing ? editing = false : void edit()}>{editing ? 'Preview' : 'Edit'}</button>{/if}
    {#if kind === 'code' && entry.document.language === 'python'}<button aria-label="Run cell" title="Run cell (Ctrl/Cmd+Enter)" disabled={busy} onclick={() => run()}>▶ Run</button>{/if}
    <span class="spacer"></span>
    <button title="Move cell up" aria-label="Move cell up" onclick={() => entry.document.move(cell.id, -1)}>↑</button>
    <button title="Move cell down" aria-label="Move cell down" onclick={() => entry.document.move(cell.id, 1)}>↓</button>
    <button title="Add code cell below" aria-label="Add code cell below" onclick={() => entry.document.add('code', cell.id)}>+</button>
    <button title="Duplicate cell" aria-label="Duplicate cell" onclick={() => entry.document.duplicate(cell.id)}>⧉</button>
    {#if kind === 'code' && outputs.length && !clear}<button onclick={() => entry.document.clear(cell.id)}>Clear output</button>{/if}
    <button title="Delete cell (Undo Cell Operation restores it)" aria-label="Delete cell" onclick={() => entry.document.remove(cell.id)}>×</button>
  </div>
  {#if sourceMode}
    <div class="cell-editor" bind:this={host} style:height={`${height}px`}>
      {#if !api || !active || !nearby}<pre>{source.slice(0, 4000) || ' '}</pre>{/if}
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
  {#if magic}<p class="cell-note">IPython magic/shell syntax: this cell is excluded from Python language analysis.</p>{/if}
  {#if kind === 'code' && outputs.length && !clear && nearby}
    {#if source !== executedSource}<p class="cell-note">Output is from an earlier version of this cell</p>{/if}
    <NotebookOutputs {outputs} {path} {desktop} />
  {/if}
</section>

<style>
  .notebook-cell { margin: 0 0 18px; border: 1px solid var(--app-border); border-radius: 5px; background: var(--app-editor-background); min-width: 0; }
  .notebook-cell:focus-within { border-color: var(--app-accent); }
  .cell-toolbar { display: flex; align-items: center; gap: 5px; padding: 4px 8px; min-height: 32px; color: var(--app-muted-text); background: var(--app-surface); border-radius: 5px 5px 0 0; font-size: 12px; }
  button, select { font: inherit; color: inherit; background: transparent; border: 1px solid transparent; border-radius: 3px; padding: 3px 6px; cursor: pointer; }
  select { max-width: 110px; } option { background: var(--app-surface); }
  button:hover, select:hover { background: var(--app-hover); color: var(--app-text); }
  button:focus-visible, select:focus-visible { outline: 1px solid var(--app-focus-ring); }
  .drag-handle { cursor: grab; font-size: 16px; }
  button:disabled { opacity: .4; cursor: default; }
  .spacer { flex: 1; } .execution { min-width: 35px; font-variant-numeric: tabular-nums; }
  .cell-editor { min-height: 65px; } pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 12px; font: inherit; }
  .cell-markdown { padding: 8px 22px 18px; overflow-wrap: anywhere; line-height: 1.7; contain: content; }
  .cell-markdown :global(img) { max-width: 100%; }
  .cell-markdown :global(table) { border-collapse: collapse; }
  .cell-markdown :global(td), .cell-markdown :global(th) { border: 1px solid var(--app-border); padding: 5px 10px; }
  .cell-markdown :global(pre) { white-space: pre-wrap; overflow-wrap: anywhere; }
  .cell-markdown :global(a) { color: var(--app-accent); }
  .hint, .cell-note { color: var(--app-muted-text); font-size: 12px; }
  .cell-note { padding: 0 16px; }
</style>
