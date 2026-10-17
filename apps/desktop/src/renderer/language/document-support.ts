/** Small renderer store shared by editor groups. It has no Monaco/runtime imports. */
export type ProviderSupport = {
  id: string; name: string; kind: 'builtin' | 'server';
  state: 'starting' | 'ready' | 'failed' | 'missing' | 'selection-needed' | 'off';
  features: string[]; checks: string; message?: string; context?: string[];
};
export type DocumentSupport = {
  id: string; language: string; name: string; path: string;
  providers: ProviderSupport[]; choices: { id: string; name: string }[];
  setLanguage(id: string): void; restart(): void; problems(): void;
};
const documents = new Map<string, DocumentSupport>();
const listeners = new Set<() => void>();
export const documentSupport = {
  get: (id: string) => documents.get(id),
  set(value: DocumentSupport) { documents.set(value.id, value); listeners.forEach(fn => fn()); },
  remove(id: string) { if (documents.delete(id)) listeners.forEach(fn => fn()); },
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
};
export function supportLabel(providers: ProviderSupport[]): string {
  if (providers.some(p => p.state === 'failed')) return 'Analysis issue';
  if (providers.some(p => p.state === 'selection-needed')) return 'Choose analysis';
  if (providers.some(p => p.state === 'starting')) return 'Starting analysis';
  if (providers.some(p => p.kind === 'server' && p.state === 'ready')) return 'Language services';
  if (providers.some(p => p.state === 'ready' && p.checks !== 'none')) return 'Local checks';
  if (providers.some(p => p.state === 'ready' && p.features.length)) return 'Editing support';
  return 'Basic editing';
}

export function featureLabels(features: string[]): string[] {
  const names: Record<string, string> = {
    completion: 'Completion', hover: 'Hover', signatureHelp: 'Parameter hints',
    definition: 'Navigation', declaration: 'Navigation', typeDefinition: 'Navigation', implementation: 'Navigation', references: 'Navigation',
    documentSymbol: 'Symbols', workspaceSymbol: 'Symbols', documentHighlight: 'Symbol highlights',
    selectionRange: 'Smart selection', foldingRange: 'Folding', documentLink: 'Links', semanticTokens: 'Semantic colors',
    inlayHint: 'Inlay hints', color: 'Color picker', rename: 'Rename', codeAction: 'Quick fixes', codeLens: 'Code lenses',
    documentFormatting: 'Formatting', documentRangeFormatting: 'Formatting', documentOnTypeFormatting: 'Format on type',
    linkedEditingRange: 'Linked editing', diagnostic: 'Diagnostics', callHierarchy: 'Call hierarchy', typeHierarchy: 'Type hierarchy',
  };
  return [...new Set(features.map(feature => names[feature] ?? feature))];
}
