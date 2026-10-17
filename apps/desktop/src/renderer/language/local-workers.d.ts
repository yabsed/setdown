// Pinned Monaco 0.56 internal boundary; exercised by real Electron worker tests.
declare module 'monaco-editor/languages/features/css/workerManager' {
  export class WorkerManager {
    constructor(defaults: unknown);
    getLanguageServiceWorker(...resources: import('monaco-editor').Uri[]): Promise<import('./local-worker-types').LocalWorker>;
    dispose(): void;
  }
}
declare module 'monaco-editor/internal/common/initialize' {
  export function initialize(factory: (context: unknown, data: unknown) => object): void;
}
declare module 'monaco-editor/languages/features/json/jsonWorker' {
  export class JSONWorker {
    constructor(context: unknown, data: unknown);
    protected _languageSettings: Record<string, unknown>;
    protected _getTextDocument(uri: string): { getText(): string } | null;
    protected _languageService: {
      parseJSONDocument(document: object): unknown;
      doValidation(document: object, parsed: unknown, settings: object): Promise<import('vscode-languageserver-protocol').Diagnostic[]>;
    };
  }
}

