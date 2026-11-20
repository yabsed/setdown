import { expect, test, vi } from 'vitest';
import type * as L from 'vscode-languageserver-protocol';
import { arrangeHere, gatherHere, hereLabel, hereRows, narrowHere, type HereItem } from './here-menu';
import { hereProbes, type HereContext } from './language-here';

const item = (id: string, group: HereItem['group'], label = id): HereItem => ({ id, group, label, run: () => {} });
const at = { line: 4, character: 7 }, point = { start: at, end: at };
const place = (uri: string, line: number, character = 0): L.Location => ({ uri, range: { start: { line, character }, end: { line, character: character + 3 } } });
const everything = { definitionProvider: true, declarationProvider: true, typeDefinitionProvider: true, implementationProvider: true, referencesProvider: true, documentHighlightProvider: true,
  renameProvider: { prepareProvider: true }, callHierarchyProvider: true, typeHierarchyProvider: true, codeActionProvider: true, codeLensProvider: { resolveProvider: true }, documentSymbolProvider: true,
  documentRangeFormattingProvider: true, executeCommandProvider: { commands: ['gopls.generate'] } };
/** A tool that answers each request with what the table says, and with nothing otherwise. */
function tool(answers: Record<string, unknown> = {}, more: Partial<HereContext> = {}) {
  const spies = { editorAction: vi.fn(), hierarchy: vi.fn(), codeAction: vi.fn(async () => {}), execute: vi.fn(async () => {}), toolCommand: vi.fn(async () => {}), showText: vi.fn(async () => {}),
    showLocations: vi.fn(async () => {}), link: vi.fn(async () => {}), edit: vi.fn(), inspectEnvironment: vi.fn() };
  const request = vi.fn(async (method: string, params: object) => { const answer = answers[method]; return (typeof answer === 'function' ? answer(params) : answer) ?? null; });
  const context = { capabilities: everything, position: at, selection: point, uri: 'file:///p/a.go', readOnly: false, diagnostics: [], request, runs: (name: string) => ['gopls.run_tests', 'gopls.generate'].includes(name), ...spies, ...more } as unknown as HereContext;
  return { context, request, ...spies, items: async () => arrangeHere((await Promise.all(hereProbes(context))).flat()) };
}
const labels = (items: HereItem[]) => items.map(entry => `${entry.group}: ${entry.label}`);

test('the groups have one order, a group is named once, and typing narrows by every word', () => {
  const items = [item('paste', 'edit', 'Paste'), item('run', 'run', 'Run test'), item('rename', 'change', 'Rename'), item('references', 'find', 'References'), item('definition', 'understand', 'Go to Definition'),
    item('type', 'understand', 'Go to Type Definition'), item('definition', 'understand', 'A second tool says the same')];
  expect(arrangeHere(items).map(entry => entry.id)).toEqual(['definition', 'type', 'references', 'rename', 'run', 'paste']);
  expect(hereRows(items).map(row => [row.group, row.item.label])).toEqual([['Understand', 'Go to Definition'], [undefined, 'Go to Type Definition'], ['Find', 'References'], ['Change', 'Rename'], ['Run', 'Run test'], ['Edit', 'Paste']]);
  expect(narrowHere(items, 'go def').map(entry => entry.id)).toEqual(['definition', 'type']);
  // Narrowing keeps the group's name beside the first entry that is left.
  expect(hereRows(items, 'type').map(row => [row.group, row.item.id])).toEqual([['Understand', 'type']]);
  expect(hereRows(items, 'nothing like this')).toEqual([]);
  expect([hereLabel('▶︎ Run Test'), hereLabel('run test'), hereLabel('  ⚙︎  Debug '), hereLabel('…')]).toEqual(['Run Test', 'Run test', 'Debug', '']);
});

test('a word the tool knows nothing about gets no entry at all', async () => {
  // A word in a comment: every request comes back empty, as the tools answer there.
  const comment = tool();
  expect(await comment.items()).toEqual([]);
  // Each question was asked for this position; none was assumed.
  expect(comment.request.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining(['textDocument/definition', 'textDocument/prepareRename', 'textDocument/prepareCallHierarchy', 'textDocument/codeAction', 'textDocument/codeLens']));
});

test('an entry exists because the tool answered for this position', async () => {
  const elsewhere = place('file:///p/b.go', 10);
  const used = tool({ 'textDocument/definition': [elsewhere], 'textDocument/declaration': [elsewhere], 'textDocument/typeDefinition': [place('file:///p/types.go', 3)],
    'textDocument/documentHighlight': [{ range: point }], 'textDocument/prepareRename': { range: point, placeholder: 'name' }, 'textDocument/prepareCallHierarchy': [{ name: 'f' }] });
  // The declaration is the definition under a second name: one entry. The type is somewhere else: its own entry.
  expect(labels(await used.items())).toEqual(['understand: Go to Definition', 'understand: Go to Type Definition', 'find: References', 'find: Callers', 'find: Callees', 'change: Rename']);
  (await used.items()).find(entry => entry.id === 'callers')!.run();
  expect(used.hierarchy).toHaveBeenCalledWith('incoming');
  // On the definition itself there is nowhere to go, and its uses can still be found.
  const own = tool({ 'textDocument/definition': [{ uri: 'file:///p/a.go', range: { start: { line: 4, character: 5 }, end: { line: 4, character: 9 } } }], 'textDocument/documentHighlight': [{ range: point }] });
  expect(labels(await own.items())).toEqual(['find: References']);
  // A tool that refuses to rename here has answered: no entry. A read-only document is not asked.
  expect(labels(await tool({ 'textDocument/prepareRename': { defaultBehavior: false } }).items())).toEqual([]);
  const reading = tool({ 'textDocument/prepareRename': { range: point } }, { readOnly: true });
  expect(await reading.items()).toEqual([]);
  expect(reading.request.mock.calls.map(call => call[0])).not.toContain('textDocument/prepareRename');
  // A tool that cannot be asked beforehand renames what it knows, and only that.
  const unprepared = { ...everything, renameProvider: true };
  expect(labels(await tool({ 'textDocument/documentHighlight': [{ range: point }] }, { capabilities: unprepared as never }).items())).toEqual(['find: References', 'change: Rename']);
  expect(labels(await tool({}, { capabilities: unprepared as never }).items())).toEqual([]);
});

test('repairs are entries, rewrites are one step in, and what concerns the whole file stays out', async () => {
  const diagnostic = { range: point, message: 'unused', code: 'unused' } as L.Diagnostic;
  const actions = [{ title: 'Remove unused variable', kind: 'quickfix' }, { title: 'Extract function', kind: 'refactor.extract' }, { title: 'Organize Imports', kind: 'source.organizeImports' },
    { title: 'Add test for Sum', kind: 'source.addTest' }, { title: 'Cannot do this here', kind: 'quickfix', disabled: { reason: 'no' } }];
  const fixing = tool({ 'textDocument/codeAction': actions }, { diagnostics: [diagnostic, { ...diagnostic, range: { start: { line: 40, character: 0 }, end: { line: 40, character: 1 } } }] });
  const items = await fixing.items();
  expect(labels(items)).toEqual(['change: Remove unused variable', 'change: Add test for Sum', 'change: Refactor…']);
  // The tool is asked about this place, with the problems of this line.
  expect(fixing.request).toHaveBeenCalledWith('textDocument/codeAction', { range: point, context: { diagnostics: [diagnostic], triggerKind: 1 } });
  await items[0].run();
  expect(fixing.codeAction).toHaveBeenCalledWith(actions[0]);
  // More repairs than the menu shows are one step further in.
  const many = Array.from({ length: 6 }, (_unused, index) => ({ title: `Fix ${index}`, kind: 'quickfix' }));
  expect(labels(await tool({ 'textDocument/codeAction': many }).items())).toEqual(['change: Fix 0', 'change: Fix 1', 'change: Fix 2', 'change: Fix 3', 'change: More Fixes…']);
  // A selection can be formatted; without one that entry is not there.
  expect(labels(await tool({}, { selection: { start: at, end: { line: 6, character: 0 } } }).items())).toEqual(['change: Format Selection']);
});

test('what a tool can start is taken from its lenses, for the thing the cursor is in', async () => {
  const lens = (line: number, title: string, command: string) => ({ range: { start: { line, character: 5 }, end: { line, character: 12 } }, command: { title, command, arguments: [line] } });
  const symbols = [{ name: 'TestAdd', kind: 12, range: { start: { line: 2, character: 0 }, end: { line: 8, character: 1 } }, selectionRange: { start: { line: 2, character: 5 }, end: { line: 2, character: 12 } } },
    { name: 'TestOther', kind: 12, range: { start: { line: 20, character: 0 }, end: { line: 28, character: 1 } }, selectionRange: { start: { line: 20, character: 5 }, end: { line: 20, character: 14 } } }];
  const run = lens(2, 'run test', 'gopls.run_tests'), unresolved = { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } }, data: 'later' };
  const lenses = [lens(0, 'run package tests', 'gopls.run_tests'), run, lens(2, 'debug test', 'gopls.debug_tests'), lens(20, 'run test', 'gopls.run_tests'), unresolved];
  const inside = tool({ 'textDocument/codeLens': lenses, 'textDocument/documentSymbol': symbols, 'codeLens/resolve': { range: point, command: { title: '3 references', command: 'editor.action.showReferences' } } });
  const items = await inside.items();
  // The cursor is inside TestAdd, six lines below its name: its lens applies, the other test's and the package's do
  // not. A command nothing here can run (debugging, showing references) is not an entry.
  expect(labels(items)).toEqual(['run: Run test']);
  await items[0].run();
  expect(inside.execute).toHaveBeenCalledWith(run.command);
  expect(inside.request).toHaveBeenCalledWith('codeLens/resolve', unresolved);
  // On the package line the package's lens is the one that applies.
  expect(labels(await tool({ 'textDocument/codeLens': lenses, 'textDocument/documentSymbol': symbols }, { position: { line: 0, character: 3 }, selection: { start: { line: 0, character: 3 }, end: { line: 0, character: 3 } } }).items())).toEqual(['run: Run package tests']);
});

test('a tool adds what its own extension offers at the cursor, with the answer it already gave', async () => {
  const link = { targetUri: 'file:///p/tests.rs', targetRange: point, targetSelectionRange: point };
  const rust = tool({ 'rust-analyzer/expandMacro': { name: 'vec', expansion: 'Vec::new()' }, 'experimental/externalDocs': { web: 'https://doc.rust-lang.org/std/macro.vec.html', local: 7 },
    'rust-analyzer/relatedTests': [{ runnable: { location: link } }], 'experimental/moveItem': (params: { direction: string }) => params.direction === 'Up' ? [{ range: point, newText: 'fn a() {}$0' }] : [] },
    { tool: 'rust-analyzer', capabilities: {} as never });
  const items = await rust.items();
  expect(labels(items)).toEqual(['understand: Expand Macro', 'understand: Open Documentation', 'find: Related Tests', 'change: Move Item Up']);
  // Choosing the entry shows the expansion that was made when the menu opened: it cannot come back empty.
  const asked = rust.request.mock.calls.length;
  await items[0].run(); await items[1].run(); await items[2].run(); await items[3].run();
  expect(rust.request.mock.calls.length).toBe(asked);
  expect(rust.showText).toHaveBeenCalledWith({ title: 'Macro expansion', languageId: 'rust', text: '// Recursive expansion of vec macro\n// ================================\n\nVec::new()' });
  expect(rust.link).toHaveBeenCalledWith('https://doc.rust-lang.org/std/macro.vec.html');
  expect(rust.showLocations).toHaveBeenCalledWith('Related Tests', [link], 'No related tests found.');
  expect(rust.edit).toHaveBeenCalledWith([{ range: point, newText: 'fn a() {}$0' }], true);
  // Away from a macro the tool expands nothing, so the entry is not there to disappoint.
  expect(await tool({ 'rust-analyzer/expandMacro': null }, { tool: 'rust-analyzer', capabilities: {} as never }).items()).toEqual([]);
  expect(labels(await tool({ 'intellij/relatedTests': { targets: [link], isTest: true } }, { tool: 'kotlin', capabilities: {} as never }).items())).toEqual(['find: Go to Test Subject']);
  // Extracting a component is about a selection.
  expect(await tool({}, { tool: 'svelte', capabilities: {} as never }).items()).toEqual([]);
  expect(labels(await tool({}, { tool: 'svelte', capabilities: {} as never, selection: { start: at, end: { line: 5, character: 0 } } }).items())).toEqual(['change: Extract Component…']);
});

test('the repair of an import that was not found is offered on its line', async () => {
  const missing = { range: point, message: "'torch/extension.h' file not found", code: 'pp_file_not_found' } as L.Diagnostic;
  const cpp = tool({}, { tool: 'clangd', capabilities: {} as never, environment: 'compilation', diagnostics: [missing] });
  const items = await cpp.items();
  expect(labels(items)).toEqual(['change: Choose build configuration…']);
  await items[0].run();
  expect(cpp.inspectEnvironment).toHaveBeenCalled();
  // On another line, for another problem, or where there is nothing to choose, it is not offered.
  expect(await tool({}, { tool: 'clangd', capabilities: {} as never, environment: 'compilation', diagnostics: [{ ...missing, range: { start: { line: 9, character: 0 }, end: { line: 9, character: 4 } } }] }).items()).toEqual([]);
  expect(await tool({}, { tool: 'clangd', capabilities: {} as never, environment: 'compilation', diagnostics: [{ ...missing, code: 'unused-variable' }] }).items()).toEqual([]);
  expect(await tool({}, { tool: 'clangd', capabilities: {} as never, diagnostics: [missing] }).items()).toEqual([]);
});

test('the menu opens complete when the tools answer in time, and a slow tool fills in once', async () => {
  const quick = Promise.resolve([item('definition', 'understand')]);
  expect(await gatherHere([quick, Promise.resolve([])], 50)).toEqual({ items: [expect.objectContaining({ id: 'definition' })] });
  let answer!: (items: HereItem[]) => void;
  const slow = new Promise<HereItem[]>(resolve => { answer = resolve; });
  const gathered = await gatherHere([quick, slow], 10);
  expect(gathered.items.map(entry => entry.id)).toEqual(['definition']);
  answer([item('rename', 'change')]);
  expect((await gathered.late)!.map(entry => entry.id)).toEqual(['definition', 'rename']);
  // A question that fails is a tool with nothing to add, not a menu that fails to open.
  expect(await gatherHere([quick, Promise.reject(Error('gone'))], 50)).toEqual({ items: [expect.objectContaining({ id: 'definition' })] });
  expect(await gatherHere([], 50)).toEqual({ items: [] });
});
