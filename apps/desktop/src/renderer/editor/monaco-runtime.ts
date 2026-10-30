import type * as Monaco from 'monaco-editor';
import { createLanguageWorker, installBuiltinDiagnostics } from '../language/language-runtime';
import { installEditorTools } from './tools/tools-runtime';

let loading: Promise<typeof Monaco> | undefined;
/** All editor surfaces share one worker dispatcher. Language workers are loaded
 * only when requested; opening Markdown does not load a TypeScript compiler. */
export function loadMonaco(): Promise<typeof Monaco> {
  return loading ??= Promise.all([
    import('monaco-editor/editor/editor.main'),
    import('monaco-editor/editor/editor.worker?worker'),
    import('./monaco-context-menu'),
  ]).then(([api, editor, { installMonacoContextMenus }]) => {
    window.MonacoEnvironment = { getWorker: (_id, label) => createLanguageWorker(label) ?? new editor.default() };
    installMonacoContextMenus();
    installBuiltinDiagnostics(api);
    installEditorTools(api);
    return api;
  }).catch(error => { loading = undefined; throw error; });
}
