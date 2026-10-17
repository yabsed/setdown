import type * as M from 'monaco-editor';
import type * as L from 'vscode-languageserver-protocol';
import { fromRange, marker, toRange, toPosition } from './language-conversion';
import { noCancellation, refreshEvent, textEdit, type LanguageFeatureContext } from './language-feature-context';

export function installEditFeatures(c: LanguageFeatureContext): void {
  const { api, selector, capabilities: cap, scoped } = c;
  const formatting = typeof selector === 'object' && !Array.isArray(selector) ? { ...selector, exclusive: true } : selector;
  if (cap.documentFormattingProvider) c.add(api.languages.registerDocumentFormattingEditProvider(formatting, scoped({
    displayName: 'Language Server',
    provideDocumentFormattingEdits: async (_model, options, token) => (await c.request<L.TextEdit[]>('textDocument/formatting', { options }, token))?.map(textEdit),
  })));
  if (cap.documentRangeFormattingProvider) c.add(api.languages.registerDocumentRangeFormattingEditProvider(formatting, scoped({
    displayName: 'Language Server',
    provideDocumentRangeFormattingEdits: async (_model, range, options, token) => (await c.request<L.TextEdit[]>('textDocument/rangeFormatting', { range: toRange(range), options }, token))?.map(textEdit),
  })));
  if (cap.documentOnTypeFormattingProvider) c.add(api.languages.registerOnTypeFormattingEditProvider(formatting, scoped({
    autoFormatTriggerCharacters: [cap.documentOnTypeFormattingProvider.firstTriggerCharacter, ...(cap.documentOnTypeFormattingProvider.moreTriggerCharacter ?? [])],
    provideOnTypeFormattingEdits: async (_model, position, ch, options, token) => (await c.request<L.TextEdit[]>('textDocument/onTypeFormatting', { position: toPosition(position), ch, options }, token))?.map(textEdit),
  })));
  if (cap.codeActionProvider) c.add(api.languages.registerCodeActionProvider(selector, scoped({
    provideCodeActions: async (_model, range, context, token) => {
      const version = c.model.getVersionId(), versions = c.snapshot();
      const result = await c.request<(L.CodeAction | L.Command)[]>('textDocument/codeAction', { range: toRange(range), context: {
        // Preserve server diagnostic data for rust-analyzer/clangd quick fixes.
        diagnostics: c.diagnostics().filter(d => d.range.start.line <= range.endLineNumber - 1 && d.range.end.line >= range.startLineNumber - 1),
        only: context.only ? [context.only] : undefined, triggerKind: context.trigger,
      } }, token);
      if (!result) return null;
      const actions: M.languages.CodeAction[] = result.map(original => {
        const action = original as L.CodeAction;
        return { title: original.title, kind: action.kind, disabled: action.disabled?.reason,
          isPreferred: action.isPreferred, diagnostics: action.diagnostics?.map(d => marker(api, d)),
          command: c.action(original.title, async () => {
            if (!c.alive(version)) throw Error('Document changed. Request the code action again.');
            let resolved = original;
            if (typeof original.command !== 'string' && typeof cap.codeActionProvider === 'object' && cap.codeActionProvider.resolveProvider) {
              const result = await c.request<L.CodeAction>('codeAction/resolve', original, noCancellation);
              if (!result) throw Error('Could not resolve the code action. Request it again.');
              resolved = result;
            }
            if (!c.alive(version)) throw Error('Document changed during code action.');
            if ('disabled' in resolved && resolved.disabled) throw Error(resolved.disabled.reason);
            if ('edit' in resolved && resolved.edit) c.apply(await c.edit(resolved.edit, versions, noCancellation));
            const command = typeof resolved.command === 'string' ? resolved as L.Command : resolved.command;
            // User activated this action before its edits. The command can legitimately follow that edit revision.
            if (command) await c.request('workspace/executeCommand', command, noCancellation);
          }),
        };
      });
      return { actions, dispose() {} };
    },
  }), typeof cap.codeActionProvider === 'object' ? { providedCodeActionKinds: cap.codeActionProvider.codeActionKinds } : undefined));
  if (cap.codeLensProvider) {
    const originals = new WeakMap<M.languages.CodeLens, { item: L.CodeLens; version: number }>();
    const convert = (item: L.CodeLens): M.languages.CodeLens => {
      const version = c.model.getVersionId();
      const lens = { range: fromRange(item.range), command: item.command && c.command(item.command, version) };
      originals.set(lens, { item, version }); return lens;
    };
    c.add(api.languages.registerCodeLensProvider(selector, scoped({
      onDidChange: refreshEvent<M.languages.CodeLensProvider>(c, 'codeLens'),
      provideCodeLenses: async (_model, token) => {
        const result = await c.request<L.CodeLens[]>('textDocument/codeLens', {}, token);
        return result && { lenses: result.map(convert), dispose() {} };
      },
      resolveCodeLens: !cap.codeLensProvider.resolveProvider ? undefined : async (_model, lens, token) => {
        const original = originals.get(lens);
        if (!original || !c.alive(original.version)) return lens;
        const result = await c.request<L.CodeLens>('codeLens/resolve', original.item, token);
        return result ? convert(result) : lens;
      },
    })));
  }
}
