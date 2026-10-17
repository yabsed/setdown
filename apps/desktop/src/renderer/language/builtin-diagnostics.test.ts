import { expect, test, vi } from 'vitest';
import type * as M from 'monaco-editor';
import { ownLanguageDiagnostics } from './builtin-diagnostics';

test('an external server owns only its model markers and restores built-in validation on release', () => {
  const uri = { toString: () => 'file:///a.json' }, other = { toString: () => 'file:///b.json' };
  let listener: (uris: typeof uri[]) => void = () => {}, count = 1;
  const dispose = vi.fn(), revalidate = vi.fn();
  const api = { editor: {
    onDidChangeMarkers: vi.fn(fn => { listener = fn; return { dispose }; }),
    getModelMarkers: vi.fn(() => count ? [{}] : []),
    setModelMarkers: vi.fn(() => { count = 0; listener([uri]); }),
  }, json: { jsonDefaults: { diagnosticsOptions: { validate: true }, setDiagnosticsOptions: revalidate } } } as unknown as typeof M;
  const model = { uri, getLanguageId: () => 'json', isDisposed: () => false } as M.editor.ITextModel;
  const ownership = ownLanguageDiagnostics(api, model);
  expect(api.editor.setModelMarkers).toHaveBeenCalledExactlyOnceWith(model, 'json', []);
  count = 1; listener([other]); expect(api.editor.setModelMarkers).toHaveBeenCalledTimes(1);
  listener([uri]); expect(api.editor.setModelMarkers).toHaveBeenCalledTimes(2);
  ownership.dispose(); expect(dispose).toHaveBeenCalledOnce();
  expect(revalidate).toHaveBeenCalledWith({ validate: true });
});
