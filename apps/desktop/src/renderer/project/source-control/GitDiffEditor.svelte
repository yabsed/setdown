<script lang="ts">
  import { onDestroy } from 'svelte';
  import type * as Monaco from 'monaco-editor';
  import { normalizePreviewTheme } from '../../../core/preview/preview-preferences';
  import type { GitDiff } from '../../../protocol/desktop-api';
  import type { AppActions } from '../../view-state.svelte';
  import { monacoThemeName, registerMonacoThemes } from '../../theme';
  import { project } from '../project-state.svelte';

  type CachedModels = {
    original: Monaco.editor.ITextModel;
    modified: Monaco.editor.ITextModel;
    originalText: string;
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
  const models = new Map<string, CachedModels>();

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

  function ensureEditor(monaco: typeof Monaco) {
    if (editor || !host) return;
    editor = monaco.editor.createDiffEditor(host, {
      automaticLayout: true,
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
      staged: diff.staged,
      filePath: diff.filePath,
      listener: { dispose() {} },
      viewState: null,
    };
    cached.listener = modified.onDidChangeContent(() => {
      if (!cached.staged && project.activeGitDiffId === id) {
        actions.changeProjectGitWorkingTree(modified.getValue());
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
      && existing.modified.getValue() === diff.modifiedText
      && existing.staged === diff.staged && existing.filePath === diff.filePath) return existing;
    const viewState = existing?.viewState ?? null;
    if (shownId === id) saveShownView();
    disposeModels(id);
    const created = createModels(monaco, id, diff);
    if (created) {
      created.viewState = viewState;
      models.set(id, created);
    }
    return created;
  }

  function applySnapshots(
    monaco: typeof Monaco,
    snapshots: Array<{ id: string; diff: GitDiff | null }>,
    activeId: string | null,
    line: number,
    visible: boolean,
  ) {
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
    if (shownId !== activeId || editor.getModel()?.modified !== cached.modified) {
      saveShownView();
      editor.setModel({ original: cached.original, modified: cached.modified });
      shownId = activeId;
      const originalAriaLabel = active.diff.staged ? `${active.diff.originalLabel} version`
        : active.diff.originalLabel === 'EMPTY' ? 'Empty staged version' : 'Staged version';
      editor.getOriginalEditor().updateOptions({ ariaLabel: originalAriaLabel });
      editor.getModifiedEditor().updateOptions({
        ariaLabel: active.diff.staged ? 'Staged version' : 'Current document',
      });
      if (cached.viewState) editor.restoreViewState(cached.viewState);
    }
    editor.updateOptions({
      readOnly: active.diff.staged,
      originalEditable: false,
      renderMarginRevertIcon: !active.diff.staged,
    });
    const revealKey = `${activeId}:${line}:${visible}`;
    if (visible && revealKey !== lastRevealKey) {
      lastRevealKey = revealKey;
      const target = Math.min(Math.max(1, line), cached.modified.getLineCount());
      editor.getModifiedEditor().revealLineInCenter(target);
      if (!active.diff.staged) editor.getModifiedEditor().focus();
    }
    requestAnimationFrame(() => editor?.layout());
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

  $effect(() => {
    const snapshots = project.gitDiffTabs.map((tab) => ({ id: tab.id, diff: tab.diff }));
    const activeId = project.activeGitDiffId;
    const line = project.gitDiffLine;
    const visible = project.gitDiffActive && project.gitDiffMode === 'source';
    if (host) void reconcile(snapshots, activeId, line, visible);
  });

  $effect(() => {
    const target = host;
    if (!target) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => editor?.layout());
    });
    observer.observe(target);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  });

  onDestroy(() => {
    request += 1;
    for (const id of [...models.keys()]) disposeModels(id);
    editor?.dispose();
    editor = null;
  });
</script>

<div class="git-diff-editor" bind:this={host}></div>
{#if loading}<div class="git-review-state">Opening source diff…</div>{/if}
{#if error}<div class="git-review-state is-error">{error}</div>{/if}
