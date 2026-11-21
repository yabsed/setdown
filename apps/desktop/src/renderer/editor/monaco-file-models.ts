import type * as Monaco from 'monaco-editor';
import { StandaloneServices } from 'monaco-editor/editor/standalone/browser/standaloneServices';
import { ITextModelService } from 'monaco-editor/editor/common/services/resolverService';
import { documentLanguage } from '../../core/document/document-profile';
import { FilePreviews, previewScheme } from './file-previews';

type Reference = { object: { textEditorModel: Monaco.editor.ITextModel; dispose(): void }; dispose(): void };
type Service = { createModelReference(resource: Monaco.Uri): Promise<Reference> };

let installed = false;

/** Lets the editor show files that are not open (`file-previews.ts`). An open document answers
 * with its own model, unsaved text included; any other file is read from disk. */
export function installFilePreviews(api: typeof Monaco, read: (path: string) => Promise<string>): void {
  if (installed) return;
  installed = true;
  const previews = new FilePreviews(read, (text, path) => api.editor.createModel(text,
    documentLanguage(path, api.languages.getLanguages(), text.split(/[\r\n]/, 1)[0]), api.Uri.file(path).with({ scheme: previewScheme })));
  const subscription = StandaloneServices.withServices(() => {
    const service = StandaloneServices.get<Service>(ITextModelService), own = service.createModelReference.bind(service);
    service.createModelReference = async resource => {
      if (resource.scheme !== 'file' || api.editor.getModel(resource)) return own(resource);
      // A document's model carries which view it is; the file's plain address is the same text.
      const open = api.editor.getModels().find(model => model.uri.scheme === 'file' && model.uri.fsPath === resource.fsPath);
      if (open) return { object: { textEditorModel: open, dispose() {} }, dispose() {} };
      const { model, dispose } = await previews.reference(resource.fsPath);
      return { object: { textEditorModel: model, dispose() {} }, dispose };
    };
    return { dispose() { service.createModelReference = own; } };
  });
  window.addEventListener('beforeunload', () => subscription.dispose(), { once: true });
}
