import type * as Monaco from 'monaco-editor';
import { StandaloneServices } from 'monaco-editor/editor/standalone/browser/standaloneServices';
import { IModelService } from 'monaco-editor/editor/common/services/model';
import { ILanguageService } from 'monaco-editor/editor/common/languages/language';
import { createTextBufferFactoryFromSnapshot } from 'monaco-editor/editor/common/model/textModel';

type TextBuffer = {
  getEOL(): string; getLineCount(): number; getLineContent(line: number): string; getLineLength(line: number): number;
  getValueInRange(range: Monaco.IRange): string;
};
type BufferFactory = { create(defaultEOL: number): { textBuffer: TextBuffer; disposable: Monaco.IDisposable } };
type Models = { createModel(value: BufferFactory, language: unknown, uri: Monaco.Uri): Monaco.editor.ITextModel };

/** The pieces become the model's buffer as they are, the way VS Code streams a file into its piece
 * tree: no string of the whole text is built, so the text may be longer than a string can be. */
const buffer = (pieces: readonly string[]) => {
  let next = 0;
  return createTextBufferFactoryFromSnapshot({ read: () => next < pieces.length ? pieces[next++] : null }) as BufferFactory;
};

/** The model decides here, from the size of its buffer, what it turns off for a large file
 * (`isTooLargeForTokenization`, `isTooLargeForSyncing`); a model filled later would not. */
export function createLargeTextModel(pieces: readonly string[], language: string, uri: Monaco.Uri): Monaco.editor.ITextModel {
  return StandaloneServices.get<Models>(IModelService).createModel(buffer(pieces),
    StandaloneServices.get<{ createById(id: string): unknown }>(ILanguageService).createById(language), uri);
}

/** A reload as VS Code applies one (`ModelService.updateModel`, which the standalone editor leaves
 * out): one undoable edit of the lines between the unchanged start and the unchanged end. A file
 * that only grew at its end gets its new lines, and nothing else in the model is touched. */
export function updateLargeTextModel(api: typeof Monaco, model: Monaco.editor.ITextModel, pieces: readonly string[]): void {
  const lf = api.editor.DefaultEndOfLine.LF, crlf = api.editor.DefaultEndOfLine.CRLF;
  const { textBuffer, disposable } = buffer(pieces).create(model.getEOL() === '\r\n' ? crlf : lf);
  try {
    const edits = computeEdits(api, model, textBuffer);
    if (!edits.length && model.getEOL() === textBuffer.getEOL()) return;
    model.pushStackElement();
    model.pushEOL(textBuffer.getEOL() === '\r\n' ? api.editor.EndOfLineSequence.CRLF : api.editor.EndOfLineSequence.LF);
    model.pushEditOperations([], edits, () => []);
    model.pushStackElement();
  } finally { disposable.dispose(); }
}

/** VS Code's `ModelService._computeEdits`. */
function computeEdits(api: typeof Monaco, model: Monaco.editor.ITextModel, textBuffer: TextBuffer): Monaco.editor.IIdentifiedSingleEditOperation[] {
  const modelLines = model.getLineCount(), bufferLines = textBuffer.getLineCount(), shared = Math.min(modelLines, bufferLines);
  let prefix = 0;
  while (prefix < shared && model.getLineContent(1 + prefix) === textBuffer.getLineContent(1 + prefix)) prefix++;
  if (modelLines === bufferLines && prefix === modelLines) return [];
  let suffix = 0;
  while (suffix < shared - prefix && model.getLineContent(modelLines - suffix) === textBuffer.getLineContent(bufferLines - suffix)) suffix++;
  let from: Monaco.Range, to: Monaco.Range;
  if (suffix > 0) {
    from = new api.Range(prefix + 1, 1, modelLines - suffix + 1, 1);
    to = new api.Range(prefix + 1, 1, bufferLines - suffix + 1, 1);
  } else if (prefix > 0) {
    from = new api.Range(prefix, model.getLineMaxColumn(prefix), modelLines, model.getLineMaxColumn(modelLines));
    to = new api.Range(prefix, 1 + textBuffer.getLineLength(prefix), bufferLines, 1 + textBuffer.getLineLength(bufferLines));
  } else {
    from = new api.Range(1, 1, modelLines, model.getLineMaxColumn(modelLines));
    to = new api.Range(1, 1, bufferLines, 1 + textBuffer.getLineLength(bufferLines));
  }
  return [{ range: from, text: textBuffer.getValueInRange(to), forceMoveMarkers: true }];
}
