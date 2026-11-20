/** Public, lightweight entry for editor surfaces. Project clients remain lazy. */
export { builtinSupport, onBuiltinSupport, retargetBuiltin, installBuiltinDiagnostics } from './builtin-diagnostics';
export { documentSupport, languageCatalogRequest, openLanguageSupport } from './document-support';
// The commands of each tool's own extension, as plain data: the editor lists them without loading the project client.
export { toolCommandList, toolContextKey } from './tool-command-list';

export function createLanguageWorker(label: string): Promise<Worker> | undefined {
  switch (label) {
    case 'json': return import('./json.worker?worker').then(worker => new worker.default());
    case 'css': case 'scss': case 'less': return import('monaco-editor/language/css/css.worker?worker').then(worker => new worker.default());
    case 'html': case 'handlebars': case 'razor': return import('monaco-editor/language/html/html.worker?worker').then(worker => new worker.default());
    case 'typescript': case 'javascript': return import('./typescript.worker?worker').then(worker => new worker.default());
  }
}
