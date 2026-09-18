<script lang="ts">
  import type * as Monaco from 'monaco-editor';
  import { normalizePreviewTheme } from '../../../core/preview/preview-preferences';
  import { monacoThemeName, registerMonacoThemes } from '../../theme';
  import { project } from '../project-state.svelte';

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
        readOnly: true,
        originalEditable: false,
        renderSideBySide: true,
        useInlineViewWhenSpaceIsLimited: true,
        renderSideBySideInlineBreakpoint: 760,
        wordWrap: 'on',
        diffWordWrap: 'on',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderOverviewRuler: false,
        fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
        fontSize: 14,
        lineHeight: 22,
        padding: { top: 16, bottom: 48 },
      });
      disposeModels();
      const id = crypto.randomUUID();
      const syntax = language(diff.filePath);
      original = monaco.editor.createModel(diff.originalText, syntax,
        monaco.Uri.parse(`inmemory://setdown-diff/${id}/original`));
      modified = monaco.editor.createModel(diff.modifiedText, syntax,
        monaco.Uri.parse(`inmemory://setdown-diff/${id}/modified`));
      editor.setModel({ original, modified });
      const target = Math.min(Math.max(1, line), modified.getLineCount());
      editor.getModifiedEditor().revealLineInCenter(target);
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
