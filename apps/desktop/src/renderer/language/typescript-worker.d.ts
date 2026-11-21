// The pinned Monaco ESM worker entry exports these, but ships no declaration.
// Keep this boundary local; integration tests execute the real worker.
declare module 'monaco-editor/language/typescript/ts.worker' {
  export class TypeScriptWorker {
    constructor(context: unknown, data: unknown);
    protected _languageService: { cleanupSemanticCache(): void };
    getScriptFileNames(): string[];
    getScriptKind(fileName: string): number;
    getCompilationSettings(): { allowJs?: boolean };
    getQuickInfoAtPosition(fileName: string, position: number): Promise<unknown>;
    getCompletionsAtPosition(fileName: string, position: number): Promise<unknown>;
    getDefinitionAtPosition(fileName: string, position: number): Promise<unknown>;
    getReferencesAtPosition(fileName: string, position: number): Promise<unknown>;
    getDocumentHighlights(fileName: string, position: number, filesToSearch: string[]): Promise<unknown>;
    getSignatureHelpItems(fileName: string, position: number, options: unknown): Promise<unknown>;
    getNavigationTree(fileName: string): Promise<unknown>;
    getCodeFixesAtPosition(fileName: string, start: number, end: number, errorCodes: number[], formatOptions: unknown): Promise<unknown[]>;
    provideInlayHints(fileName: string, start: number, end: number): Promise<unknown[]>;
  }
  export function initialize(factory: (context: unknown, data: unknown) => TypeScriptWorker): void;
}
