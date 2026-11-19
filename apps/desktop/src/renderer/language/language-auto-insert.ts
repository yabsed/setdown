import type * as M from 'monaco-editor';
import type { LanguageAutoInsert } from '../../protocol/language';
import { toPosition } from './language-conversion';
import { noCancellation, type LanguageFeatureContext } from './language-feature-context';

// Carried over from the editor side of two extensions, which are the same code:
//   vendor/vscode/extensions/html-language-features/client/src/autoInsertion.ts   html/autoInsert
//   vendor/svelte-language-tools/packages/svelte-vscode/src/html/autoClose.ts     html/tag
// After `>` or `/` the tool is asked for the closing tag, after `=` for the quotes of an
// attribute, and its answer is written at the cursor as a snippet.

/** The pause after a keystroke before the tool is asked, as in both extensions. */
export const autoInsertDelay = 100;
type SnippetController = { insert(template: string, options?: { overwriteBefore?: number; overwriteAfter?: number; undoStopBefore?: boolean; undoStopAfter?: boolean }): void };

/** Which kind of text a change asks for. Only a single-line insertion that replaced nothing
 * counts: a paste over a selection or a new line never asks. */
export function autoInsertKind(change: Pick<M.editor.IModelContentChange, 'rangeLength' | 'text'>, enabled: Pick<LanguageAutoInsert, 'close' | 'quote'>): 'autoQuote' | 'autoClose' | undefined {
  if (change.rangeLength !== 0 || change.text.includes('\n')) return undefined;
  const last = change.text[change.text.length - 1];
  if (enabled.quote && last === '=') return 'autoQuote';
  return enabled.close && (last === '>' || last === '/') ? 'autoClose' : undefined;
}

export function installAutoInsertion(c: LanguageFeatureContext, settings: LanguageAutoInsert): void {
  if (!settings.close && !settings.quote) return;
  const { api, model } = c;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The editor a person is typing in: the extensions act on the active editor's document only. */
  const editor = () => { const shown = api.editor.getEditors().filter(candidate => candidate.getModel() === model); return shown.find(candidate => candidate.hasTextFocus()) ?? (shown.length === 1 ? shown[0] : undefined); };
  c.add(model.onDidChangeContent(event => {
    if (!event.changes.length || event.isUndoing || event.isRedoing || event.isFlush || !editor()) return;
    clearTimeout(timer); timer = undefined;
    const change = event.changes[event.changes.length - 1], kind = autoInsertKind(change, settings);
    if (!kind) return;
    const version = model.getVersionId();
    const position = { lineNumber: change.range.startLineNumber, column: change.range.startColumn + change.text.length };
    timer = setTimeout(() => {
      timer = undefined;
      if (!c.alive(version)) return;
      const params = settings.method === 'html/autoInsert' ? { kind, position: toPosition(position) } : { position: toPosition(position) };
      void c.request<string>(settings.method, params, noCancellation).then(text => {
        const target = editor();
        if (!text || typeof text !== 'string' || !target || !c.alive(version)) return;
        const controller = target.getContribution('snippetController2') as unknown as SnippetController | null;
        if (!controller?.insert) return;
        // Every cursor that stands where the keystroke ended gets the text; with none there, that place alone does.
        const cursors = target.getSelections() ?? [];
        const at = cursors.some(cursor => cursor.positionLineNumber === position.lineNumber && cursor.positionColumn === position.column)
          ? cursors.map(cursor => ({ lineNumber: cursor.positionLineNumber, column: cursor.positionColumn })) : [position];
        target.setSelections(at.map(place => new api.Selection(place.lineNumber, place.column, place.lineNumber, place.column)));
        controller.insert(text, { overwriteBefore: 0, overwriteAfter: 0, undoStopBefore: true, undoStopAfter: true });
      });
    }, autoInsertDelay);
  }), { dispose: () => clearTimeout(timer) });
}
