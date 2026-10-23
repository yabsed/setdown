import type * as Monaco from 'monaco-editor';
const values = new Map<string, Monaco.editor.IEditorOptions>();
export function displayOptions(id: string): Monaco.editor.IEditorOptions {
  return { lineNumbers: 'on', renderWhitespace: 'selection', wordWrap: 'on', rulers: [], guides: { indentation: true },
    quickSuggestions: { other: 'on', comments: 'off', strings: 'off' }, quickSuggestionsDelay: 10, ...values.get(id) };
}
export function setDisplayOptions(id: string, value: Monaco.editor.IEditorOptions): void { values.set(id, { ...values.get(id), ...value }); }
export function copyDisplayOptions(from: string, to: string): void { const value = values.get(from); if (value) values.set(to, structuredClone(value)); }
export function releaseDisplayOptions(id: string): void { values.delete(id); }
export function restoreDisplayOptions(id: string, value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const source = value as Record<string, unknown>, options: Monaco.editor.IEditorOptions = {};
  if (['on', 'off', 'relative', 'interval'].includes(String(source.lineNumbers))) options.lineNumbers = source.lineNumbers as 'on' | 'off' | 'relative' | 'interval';
  if (['none', 'boundary', 'selection', 'trailing', 'all'].includes(String(source.renderWhitespace))) options.renderWhitespace = source.renderWhitespace as 'none' | 'selection' | 'all';
  if (['off', 'on', 'wordWrapColumn', 'bounded'].includes(String(source.wordWrap))) options.wordWrap = source.wordWrap as 'off' | 'on';
  if (Array.isArray(source.rulers)) options.rulers = source.rulers.filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 500).slice(0, 6);
  if (typeof source.quickSuggestions === 'boolean') options.quickSuggestions = source.quickSuggestions;
  if (typeof source.quickSuggestionsDelay === 'number' && source.quickSuggestionsDelay >= 0 && source.quickSuggestionsDelay <= 2000) options.quickSuggestionsDelay = source.quickSuggestionsDelay;
  if (source.guides && typeof source.guides === 'object' && typeof (source.guides as { indentation?: unknown }).indentation === 'boolean') options.guides = { indentation: (source.guides as { indentation: boolean }).indentation };
  setDisplayOptions(id, options);
}
