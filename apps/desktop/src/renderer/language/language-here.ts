import type * as L from 'vscode-languageserver-protocol';
import type { AnalysisEnvironmentKind } from '../../core/document/analysis-context';
import type { LanguageCapabilities, LanguageMethod } from '../../protocol/language';
import { isUnresolvedSymptom, type ToolFamily } from '../../protocol/language-tools';
import { environmentAction } from './document-presentation';
import { hereLabel, type HereItem } from './here-menu';
import { toolActionId } from './tool-command-list';

// The questions one tool is asked when the menu at the cursor opens, and the entry each answer
// becomes. An entry exists only because the tool answered for this position: a definition that
// was found, a rename the tool is prepared to do, an action or a lens it offers on this line, a
// macro it expanded. The answer is kept with the entry, so choosing "Expand Macro" shows the
// expansion that was already made instead of asking again and finding nothing.
//
// The sources are the protocol's own requests and, for each tool, the requests its extension
// sends at the cursor (`tool-commands.ts` names where each is read from).

type Places = L.Location | L.Location[] | L.LocationLink[] | null;
export type HereContext = {
  capabilities: LanguageCapabilities; tool?: ToolFamily;
  position: L.Position; selection: L.Range; uri: string; readOnly: boolean;
  /** The tool's diagnostics of this document, for the actions that repair them. */
  diagnostics: L.Diagnostic[];
  /** The kind of choice the analysis is based on, where the document has one. */
  environment?: AnalysisEnvironmentKind;
  /** Never rejects: no answer, a refusal and a failure are all null. */
  request<T>(method: LanguageMethod, params: object): Promise<T | null>;
  /** The tool's command is one this editor runs itself, or one the tool runs when asked. */
  runs(command: string): boolean;
  editorAction(id: string): void;
  hierarchy(kind: 'incoming' | 'outgoing' | 'supertypes' | 'subtypes'): void;
  codeAction(action: L.CodeAction | L.Command): Promise<void>;
  execute(command: L.Command): Promise<void>;
  toolCommand(id: string): Promise<void>;
  showText(source: { title: string; text: string; languageId?: string }): Promise<void>;
  showLocations(title: string, locations: (L.Location | L.LocationLink)[], empty: string): Promise<void>;
  link(href: string): Promise<void>;
  edit(edits: L.TextEdit[], snippet?: boolean): void;
  inspectEnvironment(): void;
};

const list = (value: Places): (L.Location | L.LocationLink)[] => !value ? [] : Array.isArray(value) ? value : [value];
const target = (place: L.Location | L.LocationLink) => 'targetUri' in place ? { uri: place.targetUri, range: place.targetSelectionRange } : { uri: place.uri, range: place.range };
const contains = (range: L.Range, at: L.Position) => (range.start.line < at.line || range.start.line === at.line && range.start.character <= at.character)
  && (range.end.line > at.line || range.end.line === at.line && range.end.character >= at.character);
const empty = (range: L.Range) => range.start.line === range.end.line && range.start.character === range.end.character;
/** The places as one value, to tell two answers that name the same places apart from two that differ. */
const same = (places: (L.Location | L.LocationLink)[]) => places.map(place => { const { uri, range } = target(place); return `${uri}#${range.start.line}:${range.start.character}`; }).sort().join('|');
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Every promise resolves with entries; a tool that fails to answer one question adds nothing. */
export function hereProbes(c: HereContext): Promise<HereItem[]>[] {
  const cap = c.capabilities, at = { position: c.position };
  const selected = !empty(c.selection);
  const probes: (() => Promise<HereItem[]>)[] = [];

  // Where it is defined, and where it is used. The cursor on the definition itself is not a
  // place to go to; the same answer under a second name (a declaration that is the definition)
  // is not a second entry.
  if (cap.definitionProvider || cap.referencesProvider) probes.push(async () => {
    const ask = (wanted: unknown, method: LanguageMethod) => wanted ? c.request<Places>(method, at).then(list) : Promise.resolve([]);
    const [definition, declaration, type, implementation, highlights] = await Promise.all([
      ask(cap.definitionProvider, 'textDocument/definition'), ask(cap.declarationProvider, 'textDocument/declaration'),
      ask(cap.typeDefinitionProvider, 'textDocument/typeDefinition'), ask(cap.implementationProvider, 'textDocument/implementation'),
      cap.documentHighlightProvider ? c.request<L.DocumentHighlight[]>('textDocument/documentHighlight', at).then(found => found ?? []) : Promise.resolve([] as L.DocumentHighlight[])]);
    const here = (places: (L.Location | L.LocationLink)[]) => places.every(place => { const { uri, range } = target(place); return uri === c.uri && contains(range, c.position); });
    const items: HereItem[] = [];
    const go = (id: string, label: string, action: string, places: (L.Location | L.LocationLink)[], key?: string) => {
      if (places.length && !here(places) && (id === 'definition' || same(places) !== same(definition))) items.push({ id, group: 'understand', label, key, action, run: () => c.editorAction(action) });
    };
    go('definition', 'Go to Definition', 'editor.action.revealDefinition', definition, 'F12');
    go('declaration', 'Go to Declaration', 'editor.action.revealDeclaration', declaration);
    go('type-definition', 'Go to Type Definition', 'editor.action.goToTypeDefinition', type);
    go('implementation', 'Go to Implementations', 'editor.action.goToImplementation', implementation, 'Ctrl+F12');
    // A name the tool knows: it marked its other uses, or it found where it is defined.
    const known = highlights.length > 0 || definition.length > 0;
    if (cap.referencesProvider && known) items.push({ id: 'references', group: 'find', label: 'References', key: 'Shift+F12', action: 'editor.action.goToReferences', run: () => c.editorAction('editor.action.goToReferences') });
    // A tool that cannot be asked beforehand renames what it knows.
    const prepares = typeof cap.renameProvider === 'object' && cap.renameProvider.prepareProvider;
    if (cap.renameProvider && !prepares && known && !c.readOnly) items.push(rename(c));
    return items;
  });
  if (typeof cap.renameProvider === 'object' && cap.renameProvider.prepareProvider && !c.readOnly) probes.push(async () => {
    const prepared = await c.request<L.Range | { range: L.Range } | { defaultBehavior: boolean }>('textDocument/prepareRename', at);
    return prepared && !('defaultBehavior' in prepared && !prepared.defaultBehavior) ? [rename(c)] : [];
  });
  if (cap.callHierarchyProvider) probes.push(async () => (await c.request<L.CallHierarchyItem[]>('textDocument/prepareCallHierarchy', at))?.length ? [
    { id: 'callers', group: 'find', label: 'Callers', action: 'setdown.language-incoming', run: () => c.hierarchy('incoming') },
    { id: 'callees', group: 'find', label: 'Callees', action: 'setdown.language-outgoing', run: () => c.hierarchy('outgoing') }] : []);
  if (cap.typeHierarchyProvider) probes.push(async () => (await c.request<L.TypeHierarchyItem[]>('textDocument/prepareTypeHierarchy', at))?.length ? [
    { id: 'supertypes', group: 'find', label: 'Supertypes', action: 'setdown.language-supertypes', run: () => c.hierarchy('supertypes') },
    { id: 'subtypes', group: 'find', label: 'Subtypes', action: 'setdown.language-subtypes', run: () => c.hierarchy('subtypes') }] : []);

  // What the tool offers to change here. A repair is an entry of its own, as it is the reason a
  // person opens the menu on an underlined place; the tool's rewrites stay one step further in.
  // An action that concerns the whole file (organize imports) is not about this position.
  const symptom = c.environment && c.diagnostics.some(diagnostic => diagnostic.range.start.line <= c.selection.end.line && diagnostic.range.end.line >= c.selection.start.line && isUnresolvedSymptom(c.tool, diagnostic.code));
  if (symptom) probes.push(async () => [{ id: 'environment', group: 'change', label: environmentAction(c.environment).label, run: () => c.inspectEnvironment() }]);
  if (cap.codeActionProvider && !c.readOnly) probes.push(async () => {
    const diagnostics = c.diagnostics.filter(diagnostic => diagnostic.range.start.line <= c.selection.end.line && diagnostic.range.end.line >= c.selection.start.line);
    const actions = (await c.request<(L.CodeAction | L.Command)[]>('textDocument/codeAction', { range: c.selection, context: { diagnostics, triggerKind: 1 } }) ?? [])
      .filter(action => typeof action?.title === 'string' && !('disabled' in action && action.disabled));
    const kind = (action: L.CodeAction | L.Command) => typeof action.command === 'string' ? '' : (action as L.CodeAction).kind ?? '';
    const repairs = actions.filter(action => kind(action).startsWith('quickfix') || !kind(action) && diagnostics.length > 0);
    const items: HereItem[] = repairs.slice(0, 4).map((action, index) => ({ id: `fix:${index}`, group: 'change', label: hereLabel(action.title), run: () => c.codeAction(action) }));
    if (repairs.length > 4) items.push({ id: 'more-fixes', group: 'change', label: 'More Fixes…', action: 'editor.action.quickFix', run: () => c.editorAction('editor.action.quickFix') });
    // gopls offers a test for the function at the cursor as a source action of its own kind.
    for (const [index, action] of actions.filter(action => kind(action) === 'source.addTest').slice(0, 2).entries()) items.push({ id: `add:${index}`, group: 'change', label: hereLabel(action.title), run: () => c.codeAction(action) });
    if (actions.some(action => kind(action).startsWith('refactor') || !kind(action) && !diagnostics.length)) items.push({ id: 'refactor', group: 'change', label: 'Refactor…', action: 'editor.action.refactor', run: () => c.editorAction('editor.action.refactor') });
    return items;
  });
  if (selected && cap.documentRangeFormattingProvider && !c.readOnly) probes.push(async () => [{ id: 'format-selection', group: 'change', label: 'Format Selection', action: 'editor.action.formatSelection', run: () => c.editorAction('editor.action.formatSelection') }]);

  // What the tool can start from here. A lens is the tool's own statement that its command
  // applies to a line; the lenses of this line and of the first lines of the thing the cursor is
  // in become entries, so a test can be run from anywhere inside it. Lenses are not drawn in the text.
  if (cap.codeLensProvider) probes.push(async () => {
    const [lenses, symbols] = await Promise.all([c.request<L.CodeLens[]>('textDocument/codeLens', {}),
      cap.documentSymbolProvider ? c.request<(L.DocumentSymbol | L.SymbolInformation)[]>('textDocument/documentSymbol', {}) : Promise.resolve(null)]);
    const lines = new Set([c.position.line]);
    const enclosing = innermost(symbols ?? [], c.position);
    if (enclosing) for (let line = enclosing.range.start.line; line <= Math.min(enclosing.selectionRange.start.line, enclosing.range.start.line + 20); line++) lines.add(line);
    const near = (lenses ?? []).filter(lens => lens?.range && lines.has(lens.range.start.line)).slice(0, 12);
    const resolves = typeof cap.codeLensProvider === 'object' && cap.codeLensProvider.resolveProvider;
    const resolved = await Promise.all(near.map(async lens => lens.command || !resolves ? lens : await c.request<L.CodeLens>('codeLens/resolve', lens) ?? lens));
    const seen = new Set<string>(), items: HereItem[] = [];
    for (const lens of resolved) {
      const command = lens.command, label = command && typeof command.title === 'string' ? hereLabel(command.title) : '';
      if (!command || !label || seen.has(label) || !c.runs(command.command)) continue;
      seen.add(label);
      items.push({ id: `run:${label}`, group: 'run', label, run: () => c.execute(command) });
    }
    return items.slice(0, 5);
  });

  if (c.tool === 'rust-analyzer') {
    // commands.ts `expandMacro`: an expansion exists only with the cursor in a macro call.
    probes.push(async () => {
      const expanded = record(await c.request<unknown>('rust-analyzer/expandMacro', at));
      if (typeof expanded?.expansion !== 'string' || !expanded.expansion.trim()) return [];
      const heading = `// Recursive expansion of ${String(expanded.name)} macro`;
      return [{ id: 'expand-macro', group: 'understand', label: 'Expand Macro', action: toolActionId('rust-analyzer.expandMacro'),
        run: () => c.showText({ title: 'Macro expansion', languageId: 'rust', text: `${heading}\n// ${'='.repeat(heading.length - 3)}\n\n${expanded.expansion as string}` }) }];
    });
    // commands.ts `openDocs`: the documentation built on this computer when it exists, else the web page.
    probes.push(async () => {
      const answer = await c.request<unknown>('experimental/externalDocs', at);
      const links = typeof answer === 'string' ? { web: answer } : record(answer) ?? {};
      const page = [links.local, links.web].find((link): link is string => typeof link === 'string' && /^(https?|file):\/\//.test(link));
      return page ? [{ id: 'documentation', group: 'understand', label: 'Open Documentation', action: toolActionId('rust-analyzer.openDocs'), run: () => c.link(page) }] : [];
    });
    // commands.ts `peekTests`: the tests that exercise the item at the cursor.
    probes.push(async () => {
      const tests = (await c.request<unknown[]>('rust-analyzer/relatedTests', at) ?? []).flatMap(test => { const place = record(record(record(test)?.runnable)?.location); return place && typeof place.targetUri === 'string' ? [place as unknown as L.LocationLink] : []; });
      return tests.length ? [{ id: 'related-tests', group: 'find', label: 'Related Tests', action: toolActionId('rust-analyzer.peekTests'), run: () => c.showLocations('Related Tests', tests, 'No related tests found.') }] : [];
    });
    // commands.ts `moveItem`: the tool answers with the edits when the item can move that way.
    if (!c.readOnly) for (const direction of ['Up', 'Down'] as const) probes.push(async () => {
      const edits = await c.request<L.TextEdit[]>('experimental/moveItem', { range: c.selection, direction });
      return edits?.length ? [{ id: `move-${direction.toLowerCase()}`, group: 'change', label: `Move Item ${direction}`, action: toolActionId(`rust-analyzer.moveItem${direction}`), run: () => c.edit(edits, true) }] : [];
    });
  }
  // relatedTests.ts: the tests of the class at the cursor, or what a test is a test of.
  if (c.tool === 'kotlin') probes.push(async () => {
    const answer = record(await c.request<unknown>('intellij/relatedTests', at)), targets = Array.isArray(answer?.targets) ? answer.targets as (L.Location | L.LocationLink)[] : [];
    return targets.length ? [{ id: 'related-tests', group: 'find', label: answer?.isTest === true ? 'Go to Test Subject' : 'Go to Test', action: toolActionId('kotlin.goToTest'), run: () => c.showLocations('Go to Test', targets, 'No tests found') }] : [];
  });
  // extension.ts `addExtracComponentCommand`: what is extracted is the selection.
  if (c.tool === 'svelte' && selected && !c.readOnly) probes.push(async () => [{ id: 'extract-component', group: 'change', label: 'Extract Component…', action: toolActionId('svelte.extractComponent'), run: () => c.toolCommand('svelte.extractComponent') }]);

  return probes.map(probe => probe().catch(() => []));
}

const rename = (c: HereContext): HereItem => ({ id: 'rename', group: 'change', label: 'Rename', key: 'F2', action: 'editor.action.rename', run: () => c.editorAction('editor.action.rename') });

/** The smallest symbol the tool lists that the cursor is inside: the function, not its module. */
function innermost(symbols: (L.DocumentSymbol | L.SymbolInformation)[], at: L.Position): L.DocumentSymbol | undefined {
  let found: L.DocumentSymbol | undefined;
  const visit = (items: (L.DocumentSymbol | L.SymbolInformation)[], depth: number) => {
    for (const item of items) if ('selectionRange' in item && item.range && contains(item.range, at) && depth < 64) { found = item; visit(item.children ?? [], depth + 1); }
  };
  visit(symbols, 0);
  return found;
}
