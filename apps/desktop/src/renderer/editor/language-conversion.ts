import type * as M from 'monaco-editor';
import type * as L from 'vscode-languageserver-protocol';

export const toPosition = (p: M.IPosition): L.Position => ({ line: p.lineNumber - 1, character: p.column - 1 });
export const toRange = (r: M.IRange): L.Range => ({ start: toPosition({ lineNumber: r.startLineNumber, column: r.startColumn }),
  end: toPosition({ lineNumber: r.endLineNumber, column: r.endColumn }) });
export const fromRange = (r: L.Range): M.IRange => ({ startLineNumber: r.start.line + 1, startColumn: r.start.character + 1,
  endLineNumber: r.end.line + 1, endColumn: r.end.character + 1 });
export function markdown(value: L.MarkupContent | L.MarkedString | undefined): M.IMarkdownString {
  const text = typeof value === 'string' ? value : value?.value ?? '';
  const escaped = text.replace(/[\\`*_{}\[\]()#+\-.!<>|]/g, '\\$&');
  return { value: typeof value === 'object' && 'language' in value ? `\`\`\`${value.language}\n${text}\n\`\`\``
    : typeof value === 'object' && 'kind' in value && value.kind === 'plaintext' ? escaped : text,
  isTrusted: false, supportHtml: false };
}
export function marker(api: typeof M, diagnostic: L.Diagnostic): M.editor.IMarkerData {
  return { ...fromRange(diagnostic.range), message: typeof diagnostic.message === 'string' ? diagnostic.message : diagnostic.message.value, source: diagnostic.source ?? 'Pyright',
    severity: diagnostic.severity === 1 ? api.MarkerSeverity.Error : diagnostic.severity === 2 ? api.MarkerSeverity.Warning
      : diagnostic.severity === 4 ? api.MarkerSeverity.Hint : api.MarkerSeverity.Info,
    code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
    tags: diagnostic.tags?.map(tag => tag === 1 ? api.MarkerTag.Unnecessary : api.MarkerTag.Deprecated) };
}
export function completion(api: typeof M, item: L.CompletionItem, fallback: M.IRange): M.languages.CompletionItem {
  const K = api.languages.CompletionItemKind;
  const kinds = [K.Text, K.Text, K.Method, K.Function, K.Constructor, K.Field, K.Variable, K.Class,
    K.Interface, K.Module, K.Property, K.Unit, K.Value, K.Enum, K.Keyword, K.Snippet, K.Color,
    K.File, K.Reference, K.Folder, K.EnumMember, K.Constant, K.Struct, K.Event, K.Operator, K.TypeParameter];
  const edit = item.textEdit;
  return {
    label: item.label, kind: kinds[item.kind ?? 1] ?? K.Text, detail: item.detail,
    documentation: item.documentation ? markdown(item.documentation) : undefined,
    insertText: edit?.newText ?? item.insertText ?? item.label,
    insertTextRules: item.insertTextFormat === 2 ? api.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
    range: edit ? 'range' in edit ? fromRange(edit.range) : { insert: fromRange(edit.insert), replace: fromRange(edit.replace) } : fallback,
    additionalTextEdits: item.additionalTextEdits?.map(edit => ({ range: fromRange(edit.range), text: edit.newText })),
    sortText: item.sortText, filterText: item.filterText, preselect: item.preselect,
    commitCharacters: item.commitCharacters, tags: item.tags?.includes(1) ? [api.languages.CompletionItemTag.Deprecated] : undefined,
    // A server-supplied command is deliberately not executable in the shell.
  };
}
