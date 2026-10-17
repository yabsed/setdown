import type * as M from 'monaco-editor';
import type { Diagnostic } from 'vscode-languageserver-protocol';
export interface LocalWorker { doValidation(uri: string): Promise<Diagnostic[]> }
export interface LocalWorkerManager { getLanguageServiceWorker(...resources: M.Uri[]): Promise<LocalWorker>; dispose(): void }
