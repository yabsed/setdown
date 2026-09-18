<script lang="ts">
  import type * as Monaco from 'monaco-editor';
  import { normalizePreviewTheme } from '../../../core/preview/preview-preferences';
  import type { AppActions } from '../../view-state.svelte';
  import { monacoThemeName, registerMonacoThemes } from '../../theme';
  import { project } from '../project-state.svelte';

  let { actions }: { actions: AppActions } = $props();

  let host = $state<HTMLDivElement>();
  let loading = $state(true);
  let error = $state('');
  let editor: Monaco.editor.IStandaloneDiffEditor | null = null;
  let original: Monaco.editor.ITextModel | null = null;
  let modified: Monaco.editor.ITextModel | null = null;
  let request = 0;

  const language = (filePath: string) => {
    const extension = filePath.split('.').at(-1)?.toLowerCase();
    return ['md', 'markdown', 'mdown', 'mkdn', 'mkd', 'rmd', 'qmd', 'mdx'].includes(extension ?? '')
      ? 'markdown' : extension === 'json' ? 'json'
        : ['js', 'mjs', 'cjs'].includes(extension ?? '') ? 'javascript'
          : ['ts', 'mts', 'cts'].includes(extension ?? '') ? 'typescript'
            : extension === 'css' ? 'css' : ['html', 'htm'].includes(extension ?? '') ? 'html' : 'plaintext';
  };

  function disposeModels() {
    editor?.setModel(null);
    original?.dispose();
    modified?.dispose();
    original = modified = null;
  }

  async function show(diff: NonNullable<typeof project.gitDiff>, line: number) {
    if (!host || diff.originalText === null || diff.modifiedText === null) return;
    const current = ++request;
    loading = true;
    error = '';
    try {
      const [monaco, workerModule] = await Promise.all([
        import('monaco-editor/editor/editor.main'),
        import('monaco-editor/editor/editor.worker?worker'),
      ]);
      if (current !== request || !host) return;
      window.MonacoEnvironment = { getWorker: () => new workerModule.default() };
      registerMonacoThemes(monaco);
      editor ??= monaco.editor.createDiffEditor(host, {
        automaticLayout: true,
        theme: monacoThemeName(normalizePreviewTheme(document.documentElement.dataset.theme)),
        readOnly: diff.staged,
        originalEditable: false,
        renderSideBySide: true,
        useInlineViewWhenSpaceIsLimited: true,
        renderSideBySideInlineBreakpoint: 760,
        diffAlgorithm: 'advanced',
        ignoreTrimWhitespace: false,
        renderIndicators: true,
        renderMarginRevertIcon: !diff.staged,
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
      const originalAriaLabel = diff.staged ? `${diff.originalLabel} version`
        : diff.originalLabel === 'EMPTY' ? 'Empty staged version' : 'Staged version';
      const modifiedAriaLabel = diff.staged ? 'Staged version' : 'Current document';
      editor.updateOptions({
        readOnly: diff.staged,
        originalEditable: false,
        renderMarginRevertIcon: !diff.staged,
      });
      editor.getOriginalEditor().updateOptions({ ariaLabel: originalAriaLabel });
      editor.getModifiedEditor().updateOptions({ ariaLabel: modifiedAriaLabel });
      disposeModels();
      const id = crypto.randomUUID();
      const syntax = language(diff.filePath);
      original = monaco.editor.createModel(diff.originalText, syntax,
        monaco.Uri.parse(`inmemory://setdown-diff/${id}/original`));
      modified = monaco.editor.createModel(diff.modifiedText, syntax,
        monaco.Uri.parse(`inmemory://setdown-diff/${id}/modified`));
      editor.setModel({ original, modified });
      modified.onDidChangeContent(() => {
        if (!diff.staged && modified) actions.changeProjectGitWorkingTree(modified.getValue());
      });
      if (!diff.staged) {
        editor.getModifiedEditor().addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
          () => actions.saveProjectGitWorkingTree(),
        );
      }
      const target = Math.min(Math.max(1, line), modified.getLineCount());
      editor.getModifiedEditor().revealLineInCenter(target);
      if (!diff.staged) editor.getModifiedEditor().focus();
      loading = false;
      requestAnimationFrame(() => editor?.layout());
    } catch (cause) {
      if (current === request) {
        loading = false;
        error = cause instanceof Error ? cause.message : String(cause);
      }
    }
  }

  $effect(() => {
    const diff = project.gitDiff;
    const line = project.gitDiffLine;
    if (host && diff) void show(diff, line);
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

  $effect(() => () => {
    request += 1;
    disposeModels();
    editor?.dispose();
    editor = null;
  });
</script>

<div class="git-diff-editor" bind:this={host}></div>
{#if loading}<div class="git-review-state">Opening source diff…</div>{/if}
{#if error}<div class="git-review-state is-error">{error}</div>{/if}
