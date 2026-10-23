import type * as Monaco from 'monaco-editor';
import { isComposingInput } from '../composition-guard';
import { captureCommandInputs, type CommandInputs } from './editor-panel';
export type CommandContext = { editor: Monaco.editor.IStandaloneCodeEditor | null; model: Monaco.editor.ITextModel | null;
  resource: string | null; cellId?: string; groupId: string; viewId: string | null; version: number; readOnly: boolean;
  origin: 'user' | 'repeat' | 'history' | 'internal' };
export type EditorCommand = { id: string; title: string; detail: string; category: string; key?: string;
  mutates?: boolean; needsEditor?: boolean; repeatable?: boolean; available?(context: CommandContext): string | undefined;
  run(context: CommandContext, argument?: unknown): void | boolean | Promise<void | boolean> };
export class EditorCommandRegistry {
  private readonly commands = new Map<string, EditorCommand>();
  readonly history: Array<{ id: string; title: string; time: number; inputs: CommandInputs }> = [];
  readonly messages: Array<{ time: number; command: string; message: string }> = [];
  register(command: EditorCommand): () => void {
    if (this.commands.has(command.id)) throw Error(`Command ${command.id} is already registered.`);
    this.commands.set(command.id, command); return () => { if (this.commands.get(command.id) === command) this.commands.delete(command.id); };
  }
  list(): EditorCommand[] {
    const last = new Map(this.history.map((item, index) => [item.id, index]));
    return [...this.commands.values()].sort((a, b) => (last.get(b.id) ?? -1) - (last.get(a.id) ?? -1) || a.title.localeCompare(b.title));
  }
  disabled(command: EditorCommand, context: CommandContext): string | undefined {
    if (isComposingInput()) return 'Finish composing text before running this command.';
    if (command.needsEditor && (!context.editor || !context.model || context.model.isDisposed())) return 'Focus a source editor or notebook cell first.';
    if (command.mutates && context.readOnly) return 'This comparison or editor is read-only.';
    return command.available?.(context);
  }
  async execute(id: string, context: CommandContext, argument?: unknown): Promise<boolean> {
    const command = this.commands.get(id); if (!command) return false;
    try {
      const reason = this.disabled(command, context); if (reason) throw Error(reason);
      const captured = await captureCommandInputs(argument as CommandInputs | undefined, async () => command.run(context, argument));
      const result = captured.value;
      if (result === false) return false;
      this.history.push({ id, title: command.title, time: Date.now(), inputs: captured.inputs }); if (this.history.length > 100) this.history.shift();
      return true;
    } catch (error) {
      this.messages.push({ time: Date.now(), command: command.title, message: error instanceof Error ? error.message : String(error) });
      if (this.messages.length > 100) this.messages.shift();
      throw error;
    }
  }
}
