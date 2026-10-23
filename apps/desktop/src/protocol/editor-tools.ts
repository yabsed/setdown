export type EditorSetting = { key: string; value: string; source: string; supported: boolean };
export type EditorPolicy = { settings: EditorSetting[]; warnings: string[]; tabSize?: number; indentSize?: number; insertSpaces?: boolean; eol?: '\n' | '\r\n' };
export type PathCandidate = { label: string; text: string; path: string; directory: boolean };
export type EditorToolsApi = {
  policy(path: string): Promise<EditorPolicy>;
  paths(path: string, prefix: string, modules?: boolean): Promise<PathCandidate[]>;
  spelling(words: string[]): Promise<Array<{ word: string; suggestions: string[] }>>;
  learnWord(word: string): Promise<void>;
  snapshots: {
    list(): Promise<Array<{ id: string; name: string; time: number; recovery: boolean }>>;
    read(id: string): Promise<unknown>;
    write(name: string, value: unknown, recovery?: boolean): Promise<string>;
    remove(id: string): Promise<void>;
  };
};
