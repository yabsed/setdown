import type * as L from 'vscode-languageserver-protocol';

export function completionDefaults(item: L.CompletionItem, defaults?: L.CompletionList['itemDefaults']): L.CompletionItem {
  if (!defaults) return item;
  const result = { ...item, commitCharacters: item.commitCharacters ?? defaults.commitCharacters,
    insertTextFormat: item.insertTextFormat ?? defaults.insertTextFormat, insertTextMode: item.insertTextMode ?? defaults.insertTextMode,
    data: item.data ?? defaults.data };
  if (!result.textEdit && defaults.editRange) result.textEdit = 'start' in defaults.editRange
    ? { range: defaults.editRange, newText: item.textEditText ?? item.insertText ?? item.label }
    : { ...defaults.editRange, newText: item.textEditText ?? item.insertText ?? item.label };
  return result;
}
