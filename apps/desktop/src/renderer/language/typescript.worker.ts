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
}
self.onmessage = () => initialize((context, data) => new DocumentTypeScriptWorker(context, data));
