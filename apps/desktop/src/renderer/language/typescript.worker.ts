// Monaco's supported ESM worker entry. Keep editor identities (including query)
// intact; only the parser's file-kind decision uses the resource pathname.
import { initialize, TypeScriptWorker } from 'monaco-editor/language/typescript/ts.worker';
import { scriptKindForResource } from './typescript-resource';

class DocumentTypeScriptWorker extends TypeScriptWorker {
  private readonly kinds = new Map<string, number>();
  setScriptKind(uri: string, kind: number): void {
    if (this.kinds.get(uri) !== kind) { this.kinds.set(uri, kind); this._languageService.cleanupSemanticCache(); }
    const live = new Set(this.getScriptFileNames());
    for (const key of this.kinds.keys()) if (!live.has(key)) this.kinds.delete(key);
  }
  override getScriptKind(fileName: string): number {
    return this.kinds.get(fileName) ?? scriptKindForResource(fileName, this.getCompilationSettings().allowJs === true);
  }
  // The questions a project tool answers for a file (`builtin-diagnostics.ts`, `ownLanguageAnswers`).
  // This worker knows that one file and none of its imports. Beside the tool its answer is a
  // second, poorer one: `any` under the real type, every global twice in the completion list,
  // the import line itself as a second definition. So it says nothing where the tool speaks.
  private readonly answered = new Map<string, Set<string>>();
  setAnswered(uri: string, questions: string[]): void {
    if (questions.length) this.answered.set(uri, new Set(questions)); else this.answered.delete(uri);
    const live = new Set(this.getScriptFileNames());
    for (const key of this.answered.keys()) if (key !== uri && !live.has(key)) this.answered.delete(key);
  }
  private left(uri: string, question: string): boolean { return this.answered.get(uri)?.has(question) === true; }
  override async getQuickInfoAtPosition(fileName: string, position: number) { return this.left(fileName, 'hover') ? undefined : super.getQuickInfoAtPosition(fileName, position); }
  override async getCompletionsAtPosition(fileName: string, position: number) { return this.left(fileName, 'completion') ? undefined : super.getCompletionsAtPosition(fileName, position); }
  override async getDefinitionAtPosition(fileName: string, position: number) { return this.left(fileName, 'definition') ? undefined : super.getDefinitionAtPosition(fileName, position); }
  override async getReferencesAtPosition(fileName: string, position: number) { return this.left(fileName, 'references') ? undefined : super.getReferencesAtPosition(fileName, position); }
  override async getDocumentHighlights(fileName: string, position: number, filesToSearch: string[]) { return this.left(fileName, 'highlights') ? undefined : super.getDocumentHighlights(fileName, position, filesToSearch); }
  override async getSignatureHelpItems(fileName: string, position: number, options: unknown) { return this.left(fileName, 'signatureHelp') ? undefined : super.getSignatureHelpItems(fileName, position, options); }
  override async getNavigationTree(fileName: string) { return this.left(fileName, 'symbols') ? undefined : super.getNavigationTree(fileName); }
  override async getCodeFixesAtPosition(fileName: string, start: number, end: number, errorCodes: number[], formatOptions: unknown) { return this.left(fileName, 'codeActions') ? [] : super.getCodeFixesAtPosition(fileName, start, end, errorCodes, formatOptions); }
  override async provideInlayHints(fileName: string, start: number, end: number) { return this.left(fileName, 'inlayHints') ? [] : super.provideInlayHints(fileName, start, end); }
}
self.onmessage = () => initialize((context, data) => new DocumentTypeScriptWorker(context, data));
