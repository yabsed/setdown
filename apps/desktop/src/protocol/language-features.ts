import type { ClientCapabilities, ServerCapabilities } from 'vscode-languageserver-protocol';

/** One inventory for negotiation, request routing and the Language Support details. */
export const languageFeatures = {
  completion: 'completionProvider', hover: 'hoverProvider', signatureHelp: 'signatureHelpProvider',
  definition: 'definitionProvider', declaration: 'declarationProvider', typeDefinition: 'typeDefinitionProvider',
  implementation: 'implementationProvider', references: 'referencesProvider', documentSymbol: 'documentSymbolProvider',
  documentHighlight: 'documentHighlightProvider', selectionRange: 'selectionRangeProvider', foldingRange: 'foldingRangeProvider',
  documentLink: 'documentLinkProvider', semanticTokens: 'semanticTokensProvider', inlayHint: 'inlayHintProvider',
  color: 'colorProvider', rename: 'renameProvider', codeAction: 'codeActionProvider', codeLens: 'codeLensProvider',
  documentFormatting: 'documentFormattingProvider', documentRangeFormatting: 'documentRangeFormattingProvider',
  documentOnTypeFormatting: 'documentOnTypeFormattingProvider', linkedEditingRange: 'linkedEditingRangeProvider',
  diagnostic: 'diagnosticProvider', workspaceSymbol: 'workspaceSymbolProvider',
  callHierarchy: 'callHierarchyProvider', typeHierarchy: 'typeHierarchyProvider',
} as const satisfies Record<string, keyof ServerCapabilities>;
export const featureNames = (capabilities: ServerCapabilities) => Object.entries(languageFeatures)
  .filter(([, key]) => capabilities[key]).map(([name]) => name);
export const refreshMethods = {
  'workspace/semanticTokens/refresh': 'semanticTokens', 'workspace/inlayHint/refresh': 'inlayHint',
  'workspace/codeLens/refresh': 'codeLens', 'workspace/diagnostic/refresh': 'diagnostic',
} as const;
export type LanguageRefresh = typeof refreshMethods[keyof typeof refreshMethods];
export const resolveMethods = {
  'completionItem/resolve': 'textDocument/completion', 'codeAction/resolve': 'textDocument/codeAction',
  'codeLens/resolve': 'textDocument/codeLens', 'documentLink/resolve': 'textDocument/documentLink',
  'inlayHint/resolve': 'textDocument/inlayHint', 'workspaceSymbol/resolve': 'workspace/symbol',
  'callHierarchy/incomingCalls': 'textDocument/prepareCallHierarchy',
  'callHierarchy/outgoingCalls': 'textDocument/prepareCallHierarchy',
  'typeHierarchy/supertypes': 'textDocument/prepareTypeHierarchy',
  'typeHierarchy/subtypes': 'textDocument/prepareTypeHierarchy',
} as const;
export const isDocumentMethod = (method: string) => method.startsWith('textDocument/');

export function clientCapabilities(): ClientCapabilities {
  const formats: ('markdown' | 'plaintext')[] = ['markdown', 'plaintext'];
  const dynamic = { dynamicRegistration: true };
  return {
    general: { positionEncodings: ['utf-16'] },
    notebookDocument: { synchronization: { dynamicRegistration: false, executionSummarySupport: true } },
    window: { workDoneProgress: true, showMessage: { messageActionItem: { additionalPropertiesSupport: false } } },
    workspace: { configuration: true, workspaceFolders: true, applyEdit: true,
      workspaceEdit: { documentChanges: true, resourceOperations: [], failureHandling: 'abort' },
      fileOperations: { dynamicRegistration: true, willCreate: true, didCreate: true, willRename: true, didRename: true, willDelete: true, didDelete: true },
      didChangeWatchedFiles: { dynamicRegistration: true, relativePatternSupport: true },
      symbol: { ...dynamic, resolveSupport: { properties: ['location.range'] } },
      semanticTokens: { refreshSupport: true }, inlayHint: { refreshSupport: true },
      codeLens: { refreshSupport: true }, diagnostics: { refreshSupport: true } },
    textDocument: {
      synchronization: { dynamicRegistration: false, didSave: true, willSave: true, willSaveWaitUntil: true },
      completion: { ...dynamic, contextSupport: true,
        completionList: { itemDefaults: ['commitCharacters', 'editRange', 'insertTextFormat', 'insertTextMode', 'data'] },
        completionItem: { snippetSupport: true, documentationFormat: formats, insertReplaceSupport: true,
          labelDetailsSupport: true, deprecatedSupport: true, tagSupport: { valueSet: [1] },
          insertTextModeSupport: { valueSet: [1, 2] },
          resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits', 'command'] } } },
      hover: { ...dynamic, contentFormat: formats },
      signatureHelp: { ...dynamic, contextSupport: true, signatureInformation: { documentationFormat: formats,
        activeParameterSupport: true, parameterInformation: { labelOffsetSupport: true } } },
      definition: { ...dynamic, linkSupport: true }, declaration: { ...dynamic, linkSupport: true },
      typeDefinition: { ...dynamic, linkSupport: true }, implementation: { ...dynamic, linkSupport: true },
      references: dynamic, documentSymbol: { ...dynamic, hierarchicalDocumentSymbolSupport: true },
      documentHighlight: dynamic, selectionRange: dynamic,
      foldingRange: { ...dynamic, lineFoldingOnly: true, rangeLimit: 5000 },
      documentLink: { ...dynamic, tooltipSupport: true }, colorProvider: dynamic,
      semanticTokens: { ...dynamic, requests: { full: { delta: true }, range: true }, formats: ['relative'],
        tokenTypes: ['namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'parameter', 'variable',
          'property', 'enumMember', 'event', 'function', 'method', 'macro', 'keyword', 'modifier', 'comment', 'string',
          'number', 'regexp', 'operator', 'decorator'],
        tokenModifiers: ['declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract', 'async',
          'modification', 'documentation', 'defaultLibrary'], overlappingTokenSupport: false, multilineTokenSupport: false,
        serverCancelSupport: true, augmentsSyntaxTokens: true },
      inlayHint: { ...dynamic, resolveSupport: { properties: ['tooltip', 'textEdits', 'label.tooltip', 'label.location', 'label.command'] } },
      rename: { ...dynamic, prepareSupport: true, prepareSupportDefaultBehavior: 1 },
      codeAction: { ...dynamic, dataSupport: true, isPreferredSupport: true, disabledSupport: true,
        codeActionLiteralSupport: { codeActionKind: { valueSet: ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline',
          'refactor.rewrite', 'source', 'source.organizeImports', 'source.fixAll'] } },
        resolveSupport: { properties: ['edit', 'command'] } },
      codeLens: dynamic, formatting: dynamic, rangeFormatting: dynamic, onTypeFormatting: dynamic,
      linkedEditingRange: dynamic, callHierarchy: dynamic, typeHierarchy: dynamic,
      publishDiagnostics: { versionSupport: true, relatedInformation: true, codeDescriptionSupport: true,
        dataSupport: true, tagSupport: { valueSet: [1, 2] } },
      diagnostic: { ...dynamic, relatedDocumentSupport: false },
    },
  };
}
