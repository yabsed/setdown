import type * as M from 'monaco-editor';
import type * as L from 'vscode-languageserver-protocol';
import type { LanguageFeatureContext } from './language-feature-context';
import { fromRange, toPosition, toRange } from './language-conversion';
import { textEdit } from './language-feature-context';

export function installNavigationFeatures(c: LanguageFeatureContext): void {
  const { api, selector, capabilities: cap, scoped } = c;
  for (const [capability, method, register] of [
    [cap.declarationProvider, 'textDocument/declaration', api.languages.registerDeclarationProvider],
    [cap.typeDefinitionProvider, 'textDocument/typeDefinition', api.languages.registerTypeDefinitionProvider],
    [cap.implementationProvider, 'textDocument/implementation', api.languages.registerImplementationProvider],
  ] as const) if (capability) {
    const provide = async (_model: M.editor.ITextModel, position: M.Position, token: M.CancellationToken) => {
      const result = await c.request<L.Location | L.Location[] | L.LocationLink[]>(method, { position: toPosition(position) }, token);
      return result && (Array.isArray(result) ? result : [result]).flatMap(item => {
        try { return ['targetUri' in item ? { uri: c.uri(item.targetUri), range: fromRange(item.targetRange),
          targetSelectionRange: fromRange(item.targetSelectionRange), originSelectionRange: item.originSelectionRange && fromRange(item.originSelectionRange) }
          : { uri: c.uri(item.uri), range: fromRange(item.range) }]; } catch { return []; }
      });
    };
    c.add(register(selector, scoped({ provideDeclaration: provide, provideTypeDefinition: provide, provideImplementation: provide })));
  }
  if (cap.documentHighlightProvider) c.add(api.languages.registerDocumentHighlightProvider(selector, scoped({
    provideDocumentHighlights: async (_model, position, token) => (await c.request<L.DocumentHighlight[]>('textDocument/documentHighlight', { position: toPosition(position) }, token))
      ?.map(item => ({ range: fromRange(item.range), kind: (item.kind ?? 1) - 1 })),
  })));
  if (cap.selectionRangeProvider) c.add(api.languages.registerSelectionRangeProvider(selector, scoped({
    provideSelectionRanges: async (_model, positions, token) => (await c.request<L.SelectionRange[]>('textDocument/selectionRange', { positions: positions.map(toPosition) }, token))
      ?.map(item => {
        const ranges: M.languages.SelectionRange[] = [];
        for (let current: L.SelectionRange | undefined = item; current && ranges.length < 100; current = current.parent) ranges.push({ range: fromRange(current.range) });
        return ranges;
      }),
  })));
  if (cap.foldingRangeProvider) c.add(api.languages.registerFoldingRangeProvider(selector, scoped({
    provideFoldingRanges: async (_model, _context, token) => (await c.request<L.FoldingRange[]>('textDocument/foldingRange', {}, token))?.slice(0, 5000)
      .map(item => ({ start: item.startLine + 1, end: item.endLine + 1, kind: item.kind === 'comment' ? api.languages.FoldingRangeKind.Comment
        : item.kind === 'imports' ? api.languages.FoldingRangeKind.Imports : item.kind === 'region' ? api.languages.FoldingRangeKind.Region : undefined })),
  })));
  if (cap.linkedEditingRangeProvider) c.add(api.languages.registerLinkedEditingRangeProvider(selector, scoped({
    provideLinkedEditingRanges: async (_model, position, token) => {
      const result = await c.request<L.LinkedEditingRanges>('textDocument/linkedEditingRange', { position: toPosition(position) }, token);
      // Server regular expressions are optional. Native linked ranges remain useful without running arbitrary patterns on every keystroke.
      return result && { ranges: result.ranges.map(fromRange) };
    },
  })));
  if (cap.documentLinkProvider) {
    const originals = new WeakMap<M.languages.ILink, { item: L.DocumentLink; version: number }>();
    const safeURL = (target?: string) => {
      if (!target) return undefined;
      try { const uri = api.Uri.parse(target); return ['file', 'http', 'https', 'mailto'].includes(uri.scheme) ? target : undefined; } catch { return undefined; }
    };
    const convert = (item: L.DocumentLink): M.languages.ILink => {
      const result = { range: fromRange(item.range), url: safeURL(item.target), tooltip: item.tooltip };
      originals.set(result, { item, version: c.model.getVersionId() }); return result;
    };
    c.add(api.languages.registerLinkProvider(selector, scoped({
      provideLinks: async (_model, token) => {
        const links = await c.request<L.DocumentLink[]>('textDocument/documentLink', {}, token);
        return links && { links: links.map(convert), dispose() {} };
      },
      resolveLink: !cap.documentLinkProvider.resolveProvider ? undefined : async (link, token) => {
        const original = originals.get(link);
        if (!original || !c.alive(original.version)) return null;
        const resolved = await c.request<L.DocumentLink>('documentLink/resolve', original.item, token);
        return resolved && convert(resolved);
      },
    })));
  }
  if (cap.colorProvider) c.add(api.languages.registerColorProvider(selector, scoped({
    provideDocumentColors: async (_model, token) => (await c.request<L.ColorInformation[]>('textDocument/documentColor', {}, token))
      ?.map(item => ({ range: fromRange(item.range), color: item.color })),
    provideColorPresentations: async (_model, info, token) => (await c.request<L.ColorPresentation[]>('textDocument/colorPresentation', { range: toRange(info.range), color: info.color }, token))
      ?.map(item => ({ label: item.label, textEdit: item.textEdit && textEdit(item.textEdit), additionalTextEdits: item.additionalTextEdits?.map(textEdit) })),
  })));
}
