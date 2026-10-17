import { initialize } from 'monaco-editor/internal/common/initialize';
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { JSONWorker } from 'monaco-editor/languages/features/json/jsonWorker';

/** The mirror URI owns the buffer; the resource URI owns schema associations.
 * Per-document dialect settings never change another model's validator. */
class DocumentJSONWorker extends JSONWorker {
  async validateDocument(uri: string, resource: string, settings: Record<string, unknown>) {
    const original = this._getTextDocument(uri);
    if (!original) return [];
    if (settings.jsonLines) {
      return original.getText().split(/\r?\n/).flatMap((line, index) => {
        if (!line.trim()) return [];
        const errors: ParseError[] = [];
        parse(line, errors, { disallowComments: true, allowTrailingComma: false });
        return errors.map(error => ({ severity: 1, code: `jsonl.${error.error}`, source: 'JSON Lines syntax',
          message: printParseErrorCode(error.error).replace(/([a-z])([A-Z])/g, '$1 $2'),
          range: { start: { line: index, character: error.offset }, end: { line: index, character: error.offset + error.length } },
        }));
      });
    }
    const document = Object.create(original);
    Object.defineProperty(document, 'uri', { value: resource });
    const parsed = this._languageService.parseJSONDocument(document);
    return this._languageService.doValidation(document, parsed, { ...this._languageSettings, ...settings });
  }
}
self.onmessage = () => initialize((context, data) => new DocumentJSONWorker(context, data));
