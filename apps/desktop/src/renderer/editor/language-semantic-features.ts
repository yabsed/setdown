import type * as M from 'monaco-editor';
import type * as L from 'vscode-languageserver-protocol';
import type { LanguageFeatureContext } from './language-feature-context';
import { refreshEvent, textEdit } from './language-feature-context';
import { fromRange, toRange, markdown } from './language-conversion';

/** Reject corrupt token payloads before they reach Monaco's typed-array decoder. */
export function semanticData(data: number[]): Uint32Array {
  if (!Array.isArray(data) || data.length > 5_000_000 || data.some(n => !Number.isSafeInteger(n) || n < 0 || n > 0xffffffff))
    throw Error('Invalid semantic token data.');
  return Uint32Array.from(data);
}
export function installSemanticFeatures(c: LanguageFeatureContext): void {
  const { api, selector, capabilities: cap, scoped } = c;
  const semantic = cap.semanticTokensProvider;
  if (semantic) {
    const legend = { tokenTypes: [...semantic.legend.tokenTypes], tokenModifiers: [...semantic.legend.tokenModifiers] };
    const shared = { getLegend: () => legend, onDidChange: refreshEvent<void>(c, 'semanticTokens') };
    if (semantic.full) {
      const results = new Map<string, Uint32Array>();
      c.add(c.onRefresh('semanticTokens', () => results.clear()));
      c.add(api.languages.registerDocumentSemanticTokensProvider(selector, scoped({ ...shared,
        releaseDocumentSemanticTokens: id => { if (id) results.delete(id); },
        provideDocumentSemanticTokens: async (_model, previousResultId, token) => {
          const version = c.model.getVersionId();
          const delta = previousResultId && results.has(previousResultId) && typeof semantic.full === 'object' && semantic.full.delta;
          const result = await c.request<L.SemanticTokens | L.SemanticTokensDelta>(delta ? 'textDocument/semanticTokens/full/delta' : 'textDocument/semanticTokens/full',
            delta ? { previousResultId } : {}, token);
          if (!result) return null;
          const remember = (data: Uint32Array, id?: string) => { if (id) results.set(id, data); while (results.size > 4) results.delete(results.keys().next().value!); };
          const full = (value: L.SemanticTokens) => {
            if (value.data.length % 5) throw Error('Invalid semantic token tuple.');
            const data = semanticData(value.data); remember(data, value.resultId);
            return { resultId: value.resultId, data };
          };
          if ('data' in result) return full(result);
          try {
            const previous = previousResultId && results.get(previousResultId);
            if (!previous) throw Error('Semantic token delta has no base.');
            const edits = result.edits.map(edit => {
              if (!Number.isSafeInteger(edit.start) || edit.start < 0 || !Number.isSafeInteger(edit.deleteCount) || edit.deleteCount < 0 || edit.start + edit.deleteCount > previous.length)
                throw Error('Invalid semantic token delta.');
              return { start: edit.start, deleteCount: edit.deleteCount, data: edit.data && semanticData(edit.data) };
            }).sort((a, b) => a.start - b.start);
            if (edits.some((edit, index) => index && edit.start < edits[index - 1].start + edits[index - 1].deleteCount)) throw Error('Overlapping semantic token deltas.');
            const length = previous.length + edits.reduce((total, edit) => total + (edit.data?.length ?? 0) - edit.deleteCount, 0);
            if (length > 5_000_000 || length % 5) throw Error('Invalid semantic token delta size.');
            const updated = new Uint32Array(length);
            let source = 0, destination = 0;
            for (const edit of edits) {
              updated.set(previous.subarray(source, edit.start), destination); destination += edit.start - source;
              if (edit.data) { updated.set(edit.data, destination); destination += edit.data.length; }
              source = edit.start + edit.deleteCount;
            }
            updated.set(previous.subarray(source), destination); remember(updated, result.resultId);
            return { resultId: result.resultId, edits };
          } catch {
            // A lost/invalid delta base must not poison every later request.
            results.clear();
            if (token.isCancellationRequested || !c.alive(version)) return null;
            const replacement = await c.request<L.SemanticTokens>('textDocument/semanticTokens/full', {}, token);
            return replacement && full(replacement);
          }
        },
      })));
    }
    if (semantic.range) c.add(api.languages.registerDocumentRangeSemanticTokensProvider(selector, scoped({ ...shared,
      provideDocumentRangeSemanticTokens: async (_model, range, token) => {
        const result = await c.request<L.SemanticTokens>('textDocument/semanticTokens/range', { range: toRange(range) }, token);
        if (result && result.data.length % 5) throw Error('Invalid semantic token tuple.');
        return result && { resultId: result.resultId, data: semanticData(result.data) };
      },
    })));
  }
  if (cap.inlayHintProvider) {
    const originals = new WeakMap<M.languages.InlayHint, { hint: L.InlayHint; version: number }>();
    const convert = (hint: L.InlayHint): M.languages.InlayHint => {
      const version = c.model.getVersionId();
      const item: M.languages.InlayHint = { position: { lineNumber: hint.position.line + 1, column: hint.position.character + 1 },
        kind: hint.kind, paddingLeft: hint.paddingLeft, paddingRight: hint.paddingRight,
        tooltip: hint.tooltip && markdown(hint.tooltip), textEdits: hint.textEdits?.map(textEdit),
        label: typeof hint.label === 'string' ? hint.label : hint.label.map(part => {
          let location: M.languages.Location | undefined;
          try { if (part.location) location = { uri: c.uri(part.location.uri), range: fromRange(part.location.range) }; } catch { /* Unsupported URI. */ }
          return { label: part.value, tooltip: part.tooltip && markdown(part.tooltip), location,
            command: part.command && c.command(part.command, version) };
        }) };
      originals.set(item, { hint, version }); return item;
    };
    c.add(api.languages.registerInlayHintsProvider(selector, scoped({
      onDidChangeInlayHints: refreshEvent<void>(c, 'inlayHint'),
      provideInlayHints: async (_model, range, token) => {
        const hints = await c.request<L.InlayHint[]>('textDocument/inlayHint', { range: toRange(range) }, token);
        return hints && { hints: hints.map(convert), dispose() {} };
      },
      resolveInlayHint: typeof cap.inlayHintProvider !== 'object' || !cap.inlayHintProvider.resolveProvider ? undefined : async (hint, token) => {
        const original = originals.get(hint);
        if (!original || !c.alive(original.version)) return hint;
        const result = await c.request<L.InlayHint>('inlayHint/resolve', original.hint, token);
        return result ? convert(result) : hint;
      },
    })));
  }
}
