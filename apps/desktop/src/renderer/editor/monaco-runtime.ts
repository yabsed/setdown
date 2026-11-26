import type * as Monaco from 'monaco-editor';
import { createLanguageWorker, installBuiltinDiagnostics } from '../language/language-runtime';
import { installEditorTools } from './tools/tools-runtime';
import { installSyntaxHighlighting } from '../language/syntax-runtime';

let loading: Promise<typeof Monaco> | undefined;
let largeText: typeof import('./monaco-large-text') | undefined;
/** Models of large text files, built from pieces. Loaded with the editor. */
export function largeTextModels(): typeof import('./monaco-large-text') {
  if (!largeText) throw new Error('Monaco is not loaded.');
  return largeText;
}
/** All editor surfaces share one worker dispatcher. Language workers are loaded
 * only when requested; opening Markdown does not load a TypeScript compiler. */
export function loadMonaco(): Promise<typeof Monaco> {
  return loading ??= Promise.all([
    import('monaco-editor/editor/editor.main'),
    import('monaco-editor/editor/editor.worker?worker'),
    import('./monaco-context-menu'),
    import('./monaco-hover-overlay'),
    import('./toggle-word-wrap'),
    import('./monaco-file-models'),
    // The desktop bridge exists only in the window; it is asked for when the editor is, not when this file is read.
    import('../adapters/electron-desktop'),
    import('./monaco-large-text'),
  ]).then(([api, editor, { installMonacoContextMenus }, { installMonacoHovers }, { installToggleWordWrap }, { installFilePreviews }, { electronDesktop }, large]) => {
    largeText = large;
    window.MonacoEnvironment = { getWorker: (_id, label) => createLanguageWorker(label) ?? new editor.default() };
    installMonacoContextMenus();
    installMonacoHovers(api);
    installToggleWordWrap(api);
    installFilePreviews(api, async path => {
      const file = await electronDesktop.readDocumentLocation(path, false);
      if (file.kind) throw Error('This file is not text.');
      if (file.large) throw Error('This file is too large to preview. Open it in a tab.');
      return file.text;
    });
    installBuiltinDiagnostics(api);
    installEditorTools(api);
    installSyntaxHighlighting(api);
    return api;
  }).catch(error => { loading = undefined; throw error; });
}
