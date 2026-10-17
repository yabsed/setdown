// The pinned Monaco ESM worker entry exports these, but ships no declaration.
// Keep this boundary local; integration tests execute the real worker.
declare module 'monaco-editor/language/typescript/ts.worker' {
  export class TypeScriptWorker {
    constructor(context: unknown, data: unknown);
    protected _languageService: { cleanupSemanticCache(): void };
    getScriptFileNames(): string[];
    getScriptKind(fileName: string): number;
    getCompilationSettings(): { allowJs?: boolean };
  }
  export function initialize(factory: (context: unknown, data: unknown) => TypeScriptWorker): void;
}
