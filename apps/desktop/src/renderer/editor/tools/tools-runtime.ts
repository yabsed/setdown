import type * as Monaco from 'monaco-editor';
import type { EditorTools, EditorToolsOptions } from './editor-tools';
import type { ResultEntry } from '../../../core/editor/result-history';
let api: typeof Monaco | undefined, options: EditorToolsOptions | undefined;
let loading: Promise<EditorTools> | undefined;
let instance: EditorTools | undefined;
export function editorToolsNow(): EditorTools | undefined { return instance; }
export function resultGroup(): string { return options?.group() ?? 'group-0'; }
export function recordEditorResults(title: string, provider: string, entries: ResultEntry[], query = '', group = resultGroup(), truncated = false): void {
  void start()?.then(tools => tools.recordResults(title, provider, entries, query, group, truncated));
}
function start(): Promise<EditorTools> | undefined {
  if (!api || !options) return undefined;
  return loading ??= import('./editor-tools').then(({ EditorTools }) => instance = new EditorTools(api!, options!));
}
export function configureEditorTools(value: EditorToolsOptions): void { options = value; void start(); }
export function installEditorTools(value: typeof Monaco): void { api = value; void start(); }
export async function openEditorCommands(): Promise<void> {
  if (!api) await (await import('../monaco-runtime')).loadMonaco();
  await (await start())?.palette();
}
export async function runEditorCommand(id: string): Promise<void> {
  if (!api) await (await import('../monaco-runtime')).loadMonaco();
  const tools = await start(); if (tools) await tools.registry.execute(id, tools.context());
}
export function editorTools(): Promise<EditorTools> | undefined { return start(); }
