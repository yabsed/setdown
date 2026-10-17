import type * as M from 'monaco-editor';

export const hasBuiltinLanguageService = (language: string): boolean => ['json', 'css', 'scss', 'less', 'html', 'typescript', 'javascript'].includes(language);

/** Built-in diagnostic adapters run independently of Monaco's provider registry.
 * Hide only this model's built-in markers while its external server is healthy;
 * keep the adapters alive for other models and restore validation on release. */
export function ownLanguageDiagnostics(api: typeof M, model: M.editor.ITextModel): M.IDisposable {
  const language = model.getLanguageId();
  const builtin = hasBuiltinLanguageService(language);
  if (!builtin || !api.editor.onDidChangeMarkers) return { dispose() {} };
  const clear = () => {
    if (!model.isDisposed() && api.editor.getModelMarkers({ owner: language, resource: model.uri }).length)
      api.editor.setModelMarkers(model, language, []);
  };
  const listener = api.editor.onDidChangeMarkers(uris => { if (uris.some(uri => uri.toString() === model.uri.toString())) clear(); });
  clear();
  return { dispose() {
    listener.dispose();
    if (model.isDisposed()) return;
    // Revalidate without changing model text, version or Undo. Monaco 0.56
    // exports language defaults at the top level, not under api.languages.
    if (language === 'json') api.json.jsonDefaults.setDiagnosticsOptions(api.json.jsonDefaults.diagnosticsOptions);
    else if (language === 'html') api.html.htmlDefaults.setOptions(api.html.htmlDefaults.options);
    else if (language === 'typescript' || language === 'javascript') {
      const defaults = language === 'typescript' ? api.typescript.typescriptDefaults : api.typescript.javascriptDefaults;
      defaults.setDiagnosticsOptions(defaults.getDiagnosticsOptions());
    } else {
      const defaults = api.css[`${language}Defaults` as 'cssDefaults' | 'scssDefaults' | 'lessDefaults'];
      defaults.setOptions(defaults.options);
    }
  } };
}
