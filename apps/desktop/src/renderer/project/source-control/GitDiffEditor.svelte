<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type * as Monaco from 'monaco-editor';
  import { normalizePreviewTheme } from '../../../core/preview/preview-preferences';
  import type { GitDiff } from '../../../protocol/desktop-api';
  import type { AppActions } from '../../view-state.svelte';
  import { monacoThemeName, registerMonacoThemes } from '../../theme';
  import { CompositionGuard } from '../../editor/composition-guard';
  import { project } from '../project-state.svelte';
  import { readEditorViewport } from '../../editor/editor-viewport';
  import { reviewViewport, type ReviewSourceSide } from '../../../core/preview/review-viewport';
  import { gitDiffViewport } from './git-diff-viewport';
  import { workingTreeMarkdownEditor, isMarkdownPath } from '../../editor/markdown-editor-port';
  import { installMarkdownEditorActions } from '../../editor/markdown-editor-actions';

  type CachedModels = {
    original: Monaco.editor.ITextModel;
    modified: Monaco.editor.ITextModel;
    originalText: string;
    modifiedText: string;
    sourceSide: ReviewSourceSide;
    staged: boolean;
    filePath: string;
    listener: Monaco.IDisposable;
    viewState: Monaco.editor.IDiffEditorViewState | null;
  };

  let { actions }: { actions: AppActions } = $props();

  let host = $state<HTMLDivElement>();
  let loading = $state(true);
  let error = $state('');
  let editor: Monaco.editor.IStandaloneDiffEditor | null = null;
  let api: typeof Monaco | null = null;
  let apiPromise: Promise<typeof Monaco> | null = null;
  let request = 0;
  let shownId: string | null = null;
  let lastRevealKey = '';
  let pendingFirstReveal: Monaco.IDisposable | null = null;
  const models = new Map<string, CachedModels>();
  const input = new CompositionGuard(() => untrack(reconcileCurrent));
  const inputListeners: Monaco.IDisposable[] = [];
  function writableMarkdown() {
    if (!editor || !api || !shownId || shownId !== project.activeGitDiffId
      || !project.gitDiffActive || project.gitDiffMode !== 'source' || input.active
      || project.gitDiff?.staged) return null;
    const cached = models.get(shownId);
    if (!cached || cached.staged || !isMarkdownPath(cached.filePath)
      || editor.getModel()?.modified !== cached.modified) return null;
    return { identity: `review:${shownId}`, filePath: cached.filePath,
      editor: editor.getModifiedEditor(), monaco: api, model: cached.modified };
  }
  const unregisterMarkdown = workingTreeMarkdownEditor.register(writableMarkdown);
  const unregisterViewport = gitDiffViewport.register((tabId) => {
    if (!editor || !api || shownId !== tabId || !project.gitDiffActive
      || project.gitDiffMode !== 'source') return null;
    const cached = models.get(tabId);
    if (!cached) return null;
    const original = editor.getOriginalEditor();
    // Inline mode's original is hidden; otherwise honor the side last used.
    const sourceSide = cached.sourceSide === 'before' && original.getLayoutInfo().width > 0
      ? 'before' : 'after';
    const side = sourceSide === 'before' ? original : editor.getModifiedEditor();
    const model = sourceSide === 'before' ? cached.original : cached.modified;
    return { ...readEditorViewport(side, api, model, reviewViewport(project.gitDiffLine).anchor), sourceSide };
  });

  function rememberSourceSide(side: ReviewSourceSide) {
    const cached = shownId ? models.get(shownId) : null;
    if (cached) cached.sourceSide = side;
  }

  const language = (filePath: string) => {
    const extension = filePath.split('.').at(-1)?.toLowerCase();
    return ['md', 'markdown', 'mdown', 'mkdn', 'mkd', 'rmd', 'qmd', 'mdx'].includes(extension ?? '')
      ? 'markdown' : extension === 'json' ? 'json'
        : ['js', 'mjs', 'cjs'].includes(extension ?? '') ? 'javascript'
          : ['ts', 'mts', 'cts'].includes(extension ?? '') ? 'typescript'
            : extension === 'css' ? 'css' : ['html', 'htm'].includes(extension ?? '') ? 'html' : 'plaintext';
  };

  function loadApi(): Promise<typeof Monaco> {
    if (api) return Promise.resolve(api);
    apiPromise ??= Promise.all([
      import('monaco-editor/editor/editor.main'),
      import('monaco-editor/editor/editor.worker?worker'),
    ]).then(([monaco, workerModule]) => {
      window.MonacoEnvironment = { getWorker: () => new workerModule.default() };
      registerMonacoThemes(monaco);
      api = monaco;
      return monaco;
    });
    return apiPromise;
  }

  function interruptReveal() {
    input.interrupt();
    pendingFirstReveal?.dispose();
    pendingFirstReveal = null;
  }

  function ensureEditor(monaco: typeof Monaco) {
    if (editor || !host) return;
    editor = monaco.editor.createDiffEditor(host, {
      theme: monacoThemeName(normalizePreviewTheme(document.documentElement.dataset.theme)),
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: true,
      renderSideBySideInlineBreakpoint: 760,
      diffAlgorithm: 'advanced',
      ignoreTrimWhitespace: false,
      renderIndicators: true,
      renderMarginRevertIcon: false,
      wordWrap: 'on',
      diffWordWrap: 'on',
      wordWrapOverride1: 'on',
      wordWrapOverride2: 'on',
      wrappingIndent: 'same',
      enableSplitViewResizing: true,
      smoothScrolling: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
      fontSize: 14,
      lineHeight: 22,
      padding: { top: 16, bottom: 48 },
    });
    const modifiedEditor = editor.getModifiedEditor();
    inputListeners.push(
      installMarkdownEditorActions(monaco, modifiedEditor, {
        insertLink: actions.openLink, insertTable: actions.openTable,
      }, () => writableMarkdown() !== null),
      editor.getOriginalEditor().onDidFocusEditorText(() => rememberSourceSide('before')),
      modifiedEditor.onDidFocusEditorText(() => rememberSourceSide('after')),
      modifiedEditor.onDidCompositionStart(() => {
        interruptReveal();
        input.start();
      }),
      modifiedEditor.onDidCompositionEnd(() => input.end()),
      modifiedEditor.onDidBlurEditorText(() => {
        interruptReveal();
        input.end();
      }),
      modifiedEditor.onKeyDown(interruptReveal),
      modifiedEditor.onMouseDown(interruptReveal),
      modifiedEditor.onDidChangeModelContent(interruptReveal),
      modifiedEditor.onDidChangeCursorPosition(({ position }) => {
        if (project.gitDiffActive && project.gitDiffMode === 'source') {
          actions.updateProjectGitDiffLine(position.lineNumber);
        }
      }),
    );
  }

  function saveShownView() {
    if (!shownId || !editor) return;
    const cached = models.get(shownId);
    if (cached && editor.getModel()?.modified === cached.modified) {
      cached.viewState = editor.saveViewState();
    }
  }

  function disposeModels(id: string) {
    const cached = models.get(id);
    if (!cached) return;
    if (editor?.getModel()?.modified === cached.modified) editor.setModel(null);
    cached.listener.dispose();
    cached.original.dispose();
    cached.modified.dispose();
    models.delete(id);
    if (shownId === id) shownId = null;
  }

  function createModels(monaco: typeof Monaco, id: string, diff: GitDiff): CachedModels | null {
    if (diff.originalText === null || diff.modifiedText === null) return null;
    const syntax = language(diff.filePath);
    const modelId = crypto.randomUUID();
    const original = monaco.editor.createModel(diff.originalText, syntax,
      monaco.Uri.parse(`inmemory://setdown-diff/${id}/${modelId}/original`));
    const modified = monaco.editor.createModel(diff.modifiedText, syntax,
      monaco.Uri.parse(`inmemory://setdown-diff/${id}/${modelId}/modified`));
    const cached: CachedModels = {
      original,
      modified,
      originalText: diff.originalText,
      modifiedText: diff.modifiedText,
      sourceSide: 'after',
      staged: diff.staged,
      filePath: diff.filePath,
      listener: { dispose() {} },
      viewState: null,
    };
    cached.listener = modified.onDidChangeContent((event) => {
      if (!cached.staged && project.activeGitDiffId === id) {
        cached.modifiedText = modified.getValue();
        // Keep every ordered edit (including composition updates) in the shared
        // document. Never discard intermediate ranges or normalize the user's text.
        untrack(() => actions.changeProjectGitWorkingTree(cached.modifiedText, event.changes));
      }
    });
    return cached;
  }

  function ensureModels(monaco: typeof Monaco, id: string, diff: GitDiff): CachedModels | null {
    if (diff.originalText === null || diff.modifiedText === null) {
      disposeModels(id);
      return null;
    }
    const existing = models.get(id);
    if (existing && existing.originalText === diff.originalText
      && (existing.modifiedText === diff.modifiedText
        || existing.modified.getValue() === diff.modifiedText)
      && existing.staged === diff.staged && existing.filePath === diff.filePath) {
      existing.modifiedText = diff.modifiedText;
      return existing;
    }
    if (shownId === id) saveShownView();
    const viewState = existing?.viewState ?? null;
    disposeModels(id);
    const created = createModels(monaco, id, diff);
    if (created) {
      created.viewState = viewState;
      models.set(id, created);
    }
    return created;
  }

  function revealFirstChangeWhenReady(
    monaco: typeof Monaco,
    id: string,
    cached: CachedModels,
    line: number,
  ) {
    if (!editor) return;
    pendingFirstReveal?.dispose();
    pendingFirstReveal = null;
    const expectedEditor = editor;
    const valid = input.navigationTicket();
    const version = cached.modified.getVersionId();
    const reveal = () => {
      if (!valid() || !project.gitDiffActive || project.gitDiffMode !== 'source'
        || editor !== expectedEditor || shownId !== id
        || expectedEditor.getModel()?.modified !== cached.modified
        || cached.modified.getVersionId() !== version) return;
      // The initial synchronous reveal already chose the cursor. A late diff
      // calculation must never reset the caret/selection of a user who started typing.
      expectedEditor.getModifiedEditor().revealLineInCenter(line, monaco.editor.ScrollType.Immediate);
    };
    if (expectedEditor.getLineChanges() !== null) {
      const frame = requestAnimationFrame(() => {
        pendingFirstReveal = null;
        reveal();
      });
      pendingFirstReveal = { dispose: () => cancelAnimationFrame(frame) };
      return;
    }
    const listener = expectedEditor.onDidUpdateDiff(() => {
      listener.dispose();
      if (pendingFirstReveal === listener) pendingFirstReveal = null;
      reveal();
    });
    pendingFirstReveal = listener;
  }

  function applySnapshots(
    monaco: typeof Monaco,
    snapshots: Array<{ id: string; diff: GitDiff | null }>,
    activeId: string | null,
    line: number,
    visible: boolean,
  ) {
    // Reconcile the latest project snapshot after compositionend, not an
    // intermediate echo while the IME owns this model's selection and range.
    if (input.active) return;
    ensureEditor(monaco);
    const retained = new Set(snapshots.map((snapshot) => snapshot.id));
    for (const id of models.keys()) {
      if (!retained.has(id)) disposeModels(id);
    }
    for (const snapshot of snapshots) {
      if (snapshot.diff) ensureModels(monaco, snapshot.id, snapshot.diff);
    }
    const active = activeId ? snapshots.find((snapshot) => snapshot.id === activeId) : null;
    const cached = activeId ? models.get(activeId) : null;
    if (!active?.diff || !cached || !editor) return;
    let layout = false;
    if (shownId !== activeId || editor.getModel()?.modified !== cached.modified) {
      interruptReveal();
      saveShownView();
      editor.setModel({ original: cached.original, modified: cached.modified });
      shownId = activeId;
      editor.updateOptions({
        readOnly: active.diff.staged,
        originalEditable: false,
        renderMarginRevertIcon: !active.diff.staged,
      });
      if (cached.viewState) editor.restoreViewState(cached.viewState);
      layout = true;
    }
    const originalAriaLabel = active.diff.staged ? `${active.diff.originalLabel} version`
      : active.diff.originalLabel === 'EMPTY' ? 'Empty staged version' : 'Staged version';
    editor.getOriginalEditor().updateOptions({ ariaLabel: originalAriaLabel });
    editor.getModifiedEditor().updateOptions({
      ariaLabel: active.diff.staged ? 'Staged version' : 'Current document',
    });
    const revealKey = `${activeId}:${line}:${visible}`;
    const requested = visible ? gitDiffViewport.takeSourceTarget(active.id) : null;
    if (visible && (requested || revealKey !== lastRevealKey)) {
      lastRevealKey = revealKey;
      if (requested) {
        interruptReveal();
        cached.sourceSide = requested.sourceSide;
        const targetEditor = requested.sourceSide === 'before'
          ? editor.getOriginalEditor() : editor.getModifiedEditor();
        const targetModel = requested.sourceSide === 'before' ? cached.original : cached.modified;
        const position = targetModel.validatePosition({
          lineNumber: requested.anchor.sourceLine, column: requested.anchor.sourceColumn ?? 1,
        });
        targetEditor.setPosition(position);
        targetEditor.setScrollTop(targetEditor.getTopForPosition(position.lineNumber, position.column)
          - targetEditor.getLayoutInfo().height * requested.anchor.yRatio, monaco.editor.ScrollType.Immediate);
        targetEditor.focus();
      } else if (!cached.viewState) {
        const target = Math.min(Math.max(1, line), cached.modified.getLineCount());
        const modifiedEditor = editor.getModifiedEditor();
        modifiedEditor.setPosition({ lineNumber: target, column: 1 });
        modifiedEditor.revealLineInCenter(target);
        const first = active.diff.hunks[0];
        const firstChangedLine = first ? Math.max(1, first.newStart || first.oldStart || 1) : 1;
        if (target === firstChangedLine) revealFirstChangeWhenReady(monaco, active.id, cached, target);
        if (!active.diff.staged) modifiedEditor.focus();
      } else {
        (cached.sourceSide === 'before' ? editor.getOriginalEditor() : editor.getModifiedEditor()).focus();
      }
      // Ordinary tab resume keeps Monaco's saved caret/scroll state. Only an
      // explicit Viewer -> Source request is allowed to reposition it.
      layout = true;
    }
    if (layout) requestAnimationFrame(() => layoutEditor());
  }

  // While the tab is hidden the host is 0x0 (display:none). Laying the diff
  // editor out at zero width makes Monaco's useInlineViewWhenSpaceIsLimited
  // flip it into inline mode, which permanently clears word wrap on the
  // original (left) editor. Skip layout while hidden so the flip never
  // happens; the ResizeObserver below relayouts on the next real size.
  function layoutEditor() {
    if (!editor || !host || host.clientWidth === 0 || host.clientHeight === 0) return;
    editor.layout();
  }

  async function reconcile(
    snapshots: Array<{ id: string; diff: GitDiff | null }>,
    activeId: string | null,
    line: number,
    visible: boolean,
  ) {
    if (!host || !snapshots.some((snapshot) => snapshot.diff)) return;
    const current = ++request;
    error = '';
    if (api) {
      try {
        applySnapshots(api, snapshots, activeId, line, visible);
        loading = false;
      } catch (cause) {
        loading = false;
        error = cause instanceof Error ? cause.message : String(cause);
      }
      return;
    }
    loading = true;
    try {
      const monaco = await loadApi();
      if (current !== request || !host) return;
      applySnapshots(monaco, snapshots, activeId, line, visible);
      loading = false;
    } catch (cause) {
      if (current === request) {
        loading = false;
        error = cause instanceof Error ? cause.message : String(cause);
      }
    }
  }

  function reconcileCurrent() {
    const snapshots = project.gitDiffTabs.map((tab) => ({ id: tab.id, diff: tab.diff }));
    const activeId = project.activeGitDiffId;
    const line = project.gitDiffLine;
    const visible = project.gitDiffActive && project.gitDiffMode === 'source';
    // Track only explicit input state. Reads performed inside Monaco callbacks
    // must not accidentally become dependencies of this Svelte effect.
    if (host) untrack(() => void reconcile(snapshots, activeId, line, visible));
  }
  $effect(reconcileCurrent);

  $effect(() => {
    const target = host;
    if (!target) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => layoutEditor());
    });
    observer.observe(target);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  });

  onDestroy(() => {
    request += 1;
    unregisterViewport();
    unregisterMarkdown();
    input.dispose();
    for (const listener of inputListeners) listener.dispose();
    interruptReveal();
    for (const id of [...models.keys()]) disposeModels(id);
    editor?.dispose();
    editor = null;
  });
</script>

<div class="git-diff-editor" bind:this={host}></div>
{#if loading}<div class="git-review-state">Opening source diff…</div>{/if}
{#if error}<div class="git-review-state is-error">{error}</div>{/if}
