import type * as Monaco from 'monaco-editor';

let loading: Promise<typeof Monaco> | undefined;
/** All editor surfaces share one worker dispatcher. Language workers are loaded
 * only when requested; opening Markdown does not load a TypeScript compiler. */
export function loadMonaco(): Promise<typeof Monaco> {
  return loading ??= Promise.all([
    import('monaco-editor/editor/editor.main'),
    import('monaco-editor/editor/editor.worker?worker'),
  ]).then(([api, editor]) => {
    window.MonacoEnvironment = { getWorker: (_id, label) => {
      switch (label) {
        case 'json': return import('monaco-editor/language/json/json.worker?worker').then(worker => new worker.default());
        case 'css': case 'scss': case 'less': return import('monaco-editor/language/css/css.worker?worker').then(worker => new worker.default());
        case 'html': case 'handlebars': case 'razor': return import('monaco-editor/language/html/html.worker?worker').then(worker => new worker.default());
        case 'typescript': case 'javascript': return import('monaco-editor/language/typescript/ts.worker?worker').then(worker => new worker.default());
        default: return new editor.default();
      }
    } };
    return api;
  }).catch(error => { loading = undefined; throw error; });
}
