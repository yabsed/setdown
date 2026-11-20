/** Public, lightweight entry for editor surfaces. Project clients remain lazy. */
export { builtinSupport, onBuiltinSupport, retargetBuiltin, installBuiltinDiagnostics } from './builtin-diagnostics';
export { documentSupport, languageCatalogRequest, openLanguageSupport } from './document-support';
// The commands of each tool's own extension, as plain data: the editor lists them without loading the project client.
export { toolCommandList, toolContextKey, toolActionId, documentCommandIds, documentCommandNames, unlistedCommandIds } from './tool-command-list';
// The menu at the cursor: its rules are plain data, and its view loads when a person first asks for it.
export { gatherHere, arrangeHere, type HereItem, type HereMenuSource } from './here-menu';
export const openHereMenu = (source: import('./here-menu').HereMenuSource): Promise<void> => import('./here-menu-view').then(view => view.openHereMenu(source));

export function createLanguageWorker(label: string): Promise<Worker> | undefined {
  switch (label) {
    case 'json': return import('./json.worker?worker').then(worker => new worker.default());
    case 'css': case 'scss': case 'less': return import('monaco-editor/language/css/css.worker?worker').then(worker => new worker.default());
    case 'html': case 'handlebars': case 'razor': return import('monaco-editor/language/html/html.worker?worker').then(worker => new worker.default());
    case 'typescript': case 'javascript': return import('./typescript.worker?worker').then(worker => new worker.default());
  }
}
