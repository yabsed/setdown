import type * as M from 'monaco-editor';
import type * as L from 'vscode-languageserver-protocol';
import type { LanguageMethod } from '../../protocol/language';
import type { LanguageRefresh } from '../../protocol/language-features';

/** Features share the client's real model, version guard and edit coordinator. */
export interface LanguageFeatureContext {
  api: typeof M;
  model: M.editor.ITextModel;
  selector: M.languages.LanguageSelector;
  capabilities: L.ServerCapabilities;
  scoped<T extends object>(provider: T): T;
  add(...disposables: M.IDisposable[]): void;
  request<T>(method: LanguageMethod, params: unknown, token: M.CancellationToken): Promise<T | null>;
  uri(value: string): M.Uri;
  alive(version: number): boolean;
  onRefresh(feature: LanguageRefresh, listener: () => void): M.IDisposable;
  diagnostics(): L.Diagnostic[];
  snapshot(): Map<M.editor.ITextModel, number>;
  edit(edit: L.WorkspaceEdit, versions: Map<M.editor.ITextModel, number>, token: M.CancellationToken): Promise<M.languages.WorkspaceEdit>;
  apply(edit: M.languages.WorkspaceEdit): void;
  command(command: L.Command, version: number, afterCompletion?: boolean): M.languages.Command;
  action(title: string, run: () => Promise<void>): M.languages.Command;
}

export const noCancellation: M.CancellationToken = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
export const textEdit = (edit: L.TextEdit): M.languages.TextEdit => ({ range: {
  startLineNumber: edit.range.start.line + 1, startColumn: edit.range.start.character + 1,
  endLineNumber: edit.range.end.line + 1, endColumn: edit.range.end.character + 1 }, text: edit.newText });

export function refreshEvent<T>(context: LanguageFeatureContext, feature: LanguageRefresh): M.IEvent<T> {
  return listener => context.onRefresh(feature, () => listener(undefined as T));
}
