import type * as Monaco from 'monaco-editor';
import type { DocumentSnapshot } from '../../protocol/desktop-api';
import { isComposingInput } from './composition-guard';

/** A capability for ONE editable surface, not whichever model happens to be active later. */
export type MarkdownEditingTarget = {
  identity: string;
  editor: Monaco.editor.IStandaloneCodeEditor;
  monaco: typeof Monaco;
  model: Monaco.editor.ITextModel;
  document: DocumentSnapshot;
};
export type EditingContext = { target(): MarkdownEditingTarget | null };
export type InsertionTarget = MarkdownEditingTarget & {
  selection: Monaco.Selection;
  version: number;
  path: string;
};

export function editableTarget(context: EditingContext): MarkdownEditingTarget | null {
  const target = context.target();
  if (!target || isComposingInput() || target.editor.getModel() !== target.model
    || target.model.isDisposed()
    || target.editor.getOption(target.monaco.editor.EditorOption.readOnly)) return null;
  return target;
}

export function captureInsertion(context: EditingContext): InsertionTarget | null {
  const target = editableTarget(context);
  const selection = target?.editor.getSelection();
  return target && selection ? { ...target, selection, version: target.model.getVersionId(),
    path: target.document.path } : null;
}

/** Dialogs and asynchronous clipboard/file work may never retarget another tab. */
export function stillCurrent(context: EditingContext, saved: InsertionTarget, checkVersion = true): boolean {
  const target = editableTarget(context);
  return !!target && target.identity === saved.identity && target.editor === saved.editor
    && target.model === saved.model && target.document.path === saved.path
    && (!checkVersion || saved.model.getVersionId() === saved.version);
}

/** A shell-level paste listener must not intercept the original pane or dialog inputs. */
export function pasteTarget(context: EditingContext, event: ClipboardEvent): InsertionTarget | null {
  if (event.defaultPrevented || !(event.target instanceof Node)) return null;
  const target = captureInsertion(context);
  return target?.editor.getDomNode()?.contains(event.target) ? target : null;
}

/** A single insertion is one undo step and follows the editor's usual content-change pipeline. */
export function replaceSelection(target: InsertionTarget, source: string, text: string): number {
  const range = target.monaco.Range.lift(target.selection);
  const start = target.model.getOffsetAt(range.getStartPosition());
  target.editor.pushUndoStop();
  target.editor.executeEdits(source, [{ range, text, forceMoveMarkers: true }]);
  target.editor.pushUndoStop();
  return start;
}
