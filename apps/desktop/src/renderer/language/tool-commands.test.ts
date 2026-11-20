import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { clientCommands, mayEdit, toolFamilies, toolRequest } from '../../protocol/language-tools';
import { documentCommandIds, documentCommandNames, toolActionId, toolCommandList, toolContextKey, unlistedCommandIds } from './tool-command-list';
import { astText, clientCommandHandlers, commandLine, goChoice, goEnvironment, goVersionItems, javaBuildResult, kotlinNoRelatedTests, memoryLayout, memoryText, plainSnippet, runnable, syntaxTreeText, toolCommands, toolEnvironmentRows, yamlEnvironment, yamlSchemaItems, type ToolCommandContext } from './tool-commands';

const vendor = path.resolve(__dirname, '../../../../../vendor');
const source = (file: string) => readFileSync(path.join(vendor, file), 'utf8');
const position = { line: 4, character: 7 }, selection = { start: position, end: position };
function context(answers: Record<string, unknown> = {}, more: Partial<ToolCommandContext> = {}) {
  const mocks = { request: vi.fn(async (method: string) => answers[method] ?? null), showText: vi.fn(async () => {}), showLocations: vi.fn(async () => {}), open: vi.fn(async () => {}),
    ask: vi.fn(async () => undefined), pick: vi.fn(async (_title: string, items: { value: unknown }[]) => items[0]?.value), edit: vi.fn(), workspaceEdit: vi.fn(async () => {}), select: vi.fn(),
    run: vi.fn(async () => true), copy: vi.fn(async () => {}), link: vi.fn(async () => {}), message: vi.fn(), inspect: vi.fn(), editorAction: vi.fn(async () => {}), type: vi.fn(),
    formatting: { tabSize: 2, insertSpaces: true } };
  return { position, selection, selections: [selection], uri: 'file:///p/src/main.rs', line: '    let x = 1;', ...mocks, ...more } as unknown as ToolCommandContext & typeof mocks;
}

test('every listed command can run, belongs to a known tool, and is named as its extension names it', () => {
  expect(Object.keys(toolCommands).sort()).toEqual(toolCommandList.map(command => command.id).sort());
  expect(new Set(toolCommandList.map(command => command.id)).size).toBe(toolCommandList.length);
  for (const command of toolCommandList) { expect(toolFamilies).toContain(command.tool); expect(command.id.startsWith(`${command.tool}.`), command.id).toBe(true); }
  const manifests = { 'rust-analyzer': JSON.parse(source('rust-analyzer/editors/code/package.json')), clangd: JSON.parse(source('vscode-clangd/package.json')),
    svelte: JSON.parse(source('svelte-language-tools/packages/svelte-vscode/package.json')) } as Record<string, { contributes: { commands: { command: string; title: string }[]; keybindings?: { command: string; key: string }[] } }>;
  Object.assign(manifests, { jdtls: JSON.parse(source('vscode-java/package.json')), kotlin: JSON.parse(source('kotlin-lsp/kotlin-vscode/package.json')),
    intelephense: JSON.parse(source('vscode-intelephense/package.json')), json: JSON.parse(source('vscode/extensions/json-language-features/package.json')),
    gopls: JSON.parse(source('vscode-go/extension/package.json')) });
  // A title written as `%name%` is in the extension's `package.nls.json`.
  const words = { jdtls: JSON.parse(source('vscode-java/package.nls.json')), json: JSON.parse(source('vscode/extensions/json-language-features/package.nls.json')) } as Record<string, Record<string, string>>;
  // `viewSyntaxTree` is a view in the extension, not a command; here it is a command that shows the same tree.
  // The YAML extension registers its schema command in code, under the same name.
  expect(source('vscode-yaml/src/schema-status-bar-item.ts')).toContain("const commandId = 'yaml.select.json.schema';");
  for (const command of toolCommandList.filter(command => !['rust-analyzer.viewSyntaxTree', 'yaml.select.json.schema'].includes(command.id))) {
    const declared = manifests[command.tool].contributes.commands.find(item => item.command === (command.command ?? command.id));
    expect(declared, command.id).toBeDefined();
    const title = /^%(.+)%$/.test(declared!.title) ? words[command.tool][declared!.title.slice(1, -1)] : declared!.title;
    expect(command.title.replace(/^[^:]+: /, ''), command.id).toBe(title.replace(/^(?:Svelte|Go): /, ''));
  }
  const keys = Object.fromEntries((manifests['rust-analyzer'].contributes.keybindings ?? []).map(binding => [binding.command, binding.key]));
  for (const command of toolCommandList.filter(command => command.key && command.key !== 'enter')) expect(command.key!.replace(/-/g, '+'), command.id).toBe(keys[command.id]);
  expect(toolContextKey('rust-analyzer')).toBe('setdownToolRustAnalyzer'); expect(toolContextKey('clangd')).toBe('setdownToolClangd');
});

test('every command a tool is told its editor can run has a handler, and none starts a debugger', () => {
  for (const [tool, commands] of Object.entries(clientCommands)) {
    expect(Object.keys(clientCommandHandlers[tool as keyof typeof clientCommandHandlers] ?? {}).sort()).toEqual([...commands!].sort());
    expect(commands!.some(command => /debug/i.test(command))).toBe(false);
  }
});

test('a runnable becomes the command line its extension would run', () => {
  const cargo = { label: 'test tests::adds', kind: 'cargo', args: { cwd: '/p/crate', workspaceRoot: '/p', cargoArgs: ['test', '--package', 'demo', '--lib'], executableArgs: ['tests::adds', '--exact', '--show-output'],
    environment: { RUSTC_BOOTSTRAP: '1', 'bad name': 'x', NUMBER: 3 } } };
  expect(runnable(cargo)).toEqual({ label: 'test tests::adds', program: { cwd: '/p/crate', env: { RUSTC_BOOTSTRAP: '1' }, program: 'cargo', args: ['test', '--package', 'demo', '--lib', '--', 'tests::adds', '--exact', '--show-output'] } });
  expect(runnable({ ...cargo, args: { ...cargo.args, executableArgs: [], overrideCargo: 'cross', cwd: '' } })!.program).toMatchObject({ program: 'cross', cwd: '/p', args: ['test', '--package', 'demo', '--lib'] });
  expect(runnable({ label: 'make', kind: 'shell', args: { cwd: '/p', program: 'make', args: ['check'] } })!.program).toEqual({ cwd: '/p', env: {}, program: 'make', args: ['check'] });
  for (const bad of [null, {}, { label: 'x', kind: 'cargo' }, { label: 'x', kind: 'other', args: {} }, { label: 'x', kind: 'shell', args: { program: '' } }]) expect(runnable(bad)).toBeUndefined();
  const run = source('rust-analyzer/editors/code/src/run.ts');
  expect(run).toContain('args.push("--", ...runnableArgs.executableArgs);'); expect(run).toContain('command: runnableArgs.program');
  // Quoted so that a shell runs exactly these words.
  expect(commandLine({ program: 'cargo', args: ['test', '--', "it's", 'a b', '$HOME', 'tests::adds'], env: { A: 'x y' } })).toBe(`A='x y' cargo test -- 'it'\\''s' 'a b' '$HOME' tests::adds`);
  expect(commandLine({ program: 'C:\\tools\\cargo.exe', args: ['test', 'a b'], env: { A: '1' } }, true)).toBe('set "A=1" && C:\\tools\\cargo.exe test "a b"');
});

test('the cursor mark of a snippet edit is taken out and remembered', () => {
  expect(plainSnippet('\n    /// $0')).toEqual({ text: '\n    /// ', cursor: 9 });
  expect(plainSnippet('fn ${0:name}() {}')).toEqual({ text: 'fn name() {}', cursor: 3 });
  expect(plainSnippet('cost \\$5 \\} \\\\ $0 and $0')).toEqual({ text: 'cost $5 } \\  and ', cursor: 12 });
  expect(plainSnippet('plain $1 text')).toEqual({ text: 'plain $1 text', cursor: undefined });
});

test('rust-analyzer commands send what the extension sends and show the answer', async () => {
  const expand = context({ 'rust-analyzer/expandMacro': { name: 'vec', expansion: 'Vec::new()' } });
  await toolCommands['rust-analyzer.expandMacro'](expand);
  expect(expand.request).toHaveBeenCalledWith('rust-analyzer/expandMacro', { position });
  expect(expand.showText).toHaveBeenCalledWith({ title: 'Macro expansion', languageId: 'rust', text: '// Recursive expansion of vec macro\n// ================================\n\nVec::new()' });
  const nothing = context(); await toolCommands['rust-analyzer.expandMacro'](nothing);
  expect(nothing.showText).not.toHaveBeenCalled(); expect(nothing.message).toHaveBeenCalledWith('Not available in this position.');
  expect(source('rust-analyzer/editors/code/src/commands.ts')).toContain('`// Recursive expansion of ${expanded.name} macro\\n`');

  const link = { targetUri: 'file:///p/src/lib.rs', targetRange: selection, targetSelectionRange: selection };
  const parent = context({ 'experimental/parentModule': [link, { junk: true }] }); await toolCommands['rust-analyzer.parentModule'](parent);
  expect(parent.showLocations).toHaveBeenCalledWith('Parent Modules', [link], 'No parent module found.');

  const docs = context({ 'experimental/externalDocs': { local: 'file:///p/target/doc/x.html', web: 'https://docs.rs/x' } }); await toolCommands['rust-analyzer.openDocs'](docs);
  expect(docs.link).toHaveBeenCalledWith('file:///p/target/doc/x.html');
  const web = context({ 'experimental/externalDocs': 'https://docs.rs/x' }); await toolCommands['rust-analyzer.openDocs'](web); expect(web.link).toHaveBeenCalledWith('https://docs.rs/x');
  const unsafe = context({ 'experimental/externalDocs': { web: 'javascript:alert(1)' } }); await toolCommands['rust-analyzer.openDocs'](unsafe); expect(unsafe.link).not.toHaveBeenCalled();

  const brace = context({ 'experimental/matchingBrace': [{ line: 9, character: 0 }] }); await toolCommands['rust-analyzer.matchingBrace'](brace);
  expect(brace.request).toHaveBeenCalledWith('experimental/matchingBrace', { positions: [position] });
  expect(brace.select).toHaveBeenCalledWith([{ start: { line: 9, character: 0 }, end: { line: 9, character: 0 } }]);

  const join = context({ 'experimental/joinLines': [{ range: selection, newText: ' ' }] }); await toolCommands['rust-analyzer.joinLines'](join);
  expect(join.request).toHaveBeenCalledWith('experimental/joinLines', { ranges: [selection] }); expect(join.edit).toHaveBeenCalledWith([{ range: selection, newText: ' ' }]);
  const move = context({ 'experimental/moveItem': [{ range: selection, newText: 'x$0' }] }); await toolCommands['rust-analyzer.moveItemDown'](move);
  expect(move.request).toHaveBeenCalledWith('experimental/moveItem', { range: selection, direction: 'Down' }); expect(move.edit).toHaveBeenCalledWith([{ range: selection, newText: 'x$0' }], true);

  const run = context({ 'experimental/runnables': [{ label: 'run demo', kind: 'cargo', args: { cwd: '/p', cargoArgs: ['run'], executableArgs: [] } }, { broken: true }] });
  await toolCommands['rust-analyzer.run'](run);
  expect(run.pick).toHaveBeenCalledWith('Select Runnable', [{ label: 'run demo', detail: 'cargo run', value: expect.objectContaining({ label: 'run demo' }) }]);
  expect(run.run).toHaveBeenCalledWith({ cwd: '/p', env: {}, program: 'cargo', args: ['run'] });
  // Without a terminal the command line is handed over instead of being lost.
  const copied = context({ 'experimental/runnables': [{ label: 'run demo', kind: 'cargo', args: { cwd: '/p', cargoArgs: ['run'], executableArgs: [] } }] }, { run: vi.fn(async () => false) });
  await toolCommands['rust-analyzer.run'](copied); expect(copied.copy).toHaveBeenCalledWith('cargo run');

  for (const [id, method] of [['runFlycheck', 'rust-analyzer/runFlycheck'], ['cancelFlycheck', 'rust-analyzer/cancelFlycheck'], ['reloadWorkspace', 'rust-analyzer/reloadWorkspace']] as const) {
    const c = context(); await toolCommands[`rust-analyzer.${id}`](c); expect(c.request).toHaveBeenCalledWith(method, {}); expect(toolRequest(method)).toBeDefined();
  }
});

test('Enter asks rust-analyzer only where it has something to say, and never keeps the key', async () => {
  const plain = context({ 'experimental/onEnter': [{ range: selection, newText: 'never used' }] });
  await toolCommands['rust-analyzer.onEnter'](plain);
  expect(plain.request).not.toHaveBeenCalled(); expect(plain.type).toHaveBeenCalledWith('\n');
  const comment = context({ 'experimental/onEnter': [{ range: selection, newText: '\n    /// $0' }] }, { line: '    /// docs', position: { line: 4, character: 12 } });
  await toolCommands['rust-analyzer.onEnter'](comment);
  expect(comment.edit).toHaveBeenCalledWith([{ range: selection, newText: '\n    /// $0' }], true); expect(comment.type).not.toHaveBeenCalled();
  const silent = context({}, { line: 'fn main() {', position: { line: 0, character: 11 } });
  await toolCommands['rust-analyzer.onEnter'](silent); expect(silent.request).toHaveBeenCalled(); expect(silent.type).toHaveBeenCalledWith('\n');
  const slow = context({}, { line: '// note', position: { line: 0, character: 7 }, request: vi.fn(() => new Promise<null>(() => {})) as ToolCommandContext['request'] });
  const started = Date.now(); await toolCommands['rust-analyzer.onEnter'](slow);
  expect(slow.type).toHaveBeenCalledWith('\n'); expect(Date.now() - started).toBeLessThan(1000);
});

test('structural search is checked while typed and applied once', async () => {
  const edit = { changes: {} };
  let validate: ((value: string) => Promise<string | undefined>) | undefined;
  const c = context({ 'experimental/ssr': edit }, { ask: vi.fn(async source => { validate = source.validate; return 'Foo($a) ==>> Bar($a)'; }) });
  await toolCommands['rust-analyzer.ssr'](c);
  expect(c.request).toHaveBeenLastCalledWith('experimental/ssr', { query: 'Foo($a) ==>> Bar($a)', parseOnly: false, position, selections: [selection] });
  expect(c.workspaceEdit).toHaveBeenCalledWith(edit);
  c.request.mockRejectedValueOnce(Error('Parse error: missing ==>>'));
  expect(await validate!('Foo')).toBe('Parse error: missing ==>>');
  expect(c.request).toHaveBeenLastCalledWith('experimental/ssr', { query: 'Foo', parseOnly: true, position, selections: [selection] }, true);
  expect(await validate!('Foo ==>> Bar')).toBeUndefined();
  const left = context(); await toolCommands['rust-analyzer.ssr'](left); expect(left.request).not.toHaveBeenCalled();
});

test('the commands rust-analyzer hands back run in the editor', async () => {
  const handlers = clientCommandHandlers['rust-analyzer']!;
  const run = context(); await handlers['rust-analyzer.runSingle'](run, [{ label: 'test a', kind: 'cargo', args: { cwd: '/p', cargoArgs: ['test'], executableArgs: ['a', '--exact'] } }]);
  expect(run.run).toHaveBeenCalledWith({ cwd: '/p', env: {}, program: 'cargo', args: ['test', '--', 'a', '--exact'] });
  const broken = context(); await handlers['rust-analyzer.runSingle'](broken, [{}]); expect(broken.run).not.toHaveBeenCalled(); expect(broken.message).toHaveBeenCalled();
  const references = context(), places = [{ uri: 'file:///p/a.rs', range: selection }];
  await handlers['rust-analyzer.showReferences'](references, ['file:///p/a.rs', position, places]);
  expect(references.showLocations).toHaveBeenCalledWith('References', places, 'No references found.');
  const go = context(), target = { start: { line: 2, character: 3 }, end: { line: 2, character: 9 } };
  await handlers['rust-analyzer.gotoLocation'](go, [{ targetUri: 'file:///p/b.rs', targetRange: target, targetSelectionRange: target }]);
  expect(go.open).toHaveBeenCalledWith('file:///p/b.rs', { start: target.start, end: target.start });
  const hints = context(); await handlers['rust-analyzer.triggerParameterHints'](hints, []); expect(hints.editorAction).toHaveBeenCalledWith('editor.action.triggerParameterHints');
  const rename = context(); await handlers['rust-analyzer.rename'](rename, []); expect(rename.editorAction).toHaveBeenCalledWith('editor.action.rename');
});

test('trees a tool answers with are shown as indented text', async () => {
  const ast = { role: 'declaration', kind: 'Function', detail: 'main', range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
    children: [{ role: 'statement', kind: 'Compound', children: [{ role: 'type', kind: 'Builtin', detail: 'int' }] }, 'junk'] };
  expect(astText(ast)).toBe('Function main  [1:1]\n  Compound\n    Builtin type int');
  expect(astText(null)).toBeUndefined();
  expect(source('vscode-clangd/src/ast.ts')).toContain("role === 'template name'");
  expect(memoryText({ _self: 10, _total: 3 * 1024 * 1024, background_index: { _self: 2048, _total: 2048 }, preamble: { _self: 0, _total: 2 * 1024 * 1024, a: { _self: 5, _total: 5 } } }))
    .toBe('clangd  3.0 MB  (self 10 B)\n  preamble  2.0 MB  (self 0 B)\n    a  5 B\n  background_index  2.0 KB');
  expect(memoryLayout({ nodes: [{ itemName: 'S', typename: 'S', size: 8, alignment: 4, offset: 0, parentIdx: -1, childrenStart: 1, childrenLen: 2 },
    { itemName: 'a', typename: 'u32', size: 4, alignment: 4, offset: 0, parentIdx: 0, childrenStart: -1, childrenLen: 0 },
    { itemName: 'b', typename: 'u32', size: 4, alignment: 4, offset: 4, parentIdx: 0, childrenStart: -1, childrenLen: 0 }] }))
    .toBe('S: S  (size 8, align 4, offset 0)\n  a: u32  (size 4, align 4, offset 0)\n  b: u32  (size 4, align 4, offset 4)');
  const c = context({ 'textDocument/ast': ast }); await toolCommands['clangd.ast'](c);
  expect(c.request).toHaveBeenCalledWith('textDocument/ast', { range: selection }); expect(c.showText).toHaveBeenCalledWith({ title: 'AST', text: expect.stringContaining('Function main') });
  const none = context(); await toolCommands['clangd.ast'](none); expect(none.message).toHaveBeenCalledWith('No AST node at selection');
  expect(source('vscode-clangd/src/ast.ts')).toContain("'No AST node at selection'");
});

test('Svelte commands ask the tool what its extension asks', async () => {
  const compiled = context({ '$/getCompiledCode': { js: { code: 'export default 1' }, css: { code: 'a{}' } } });
  await toolCommands['svelte.showCompiledCodeToSide'](compiled); await toolCommands['svelte.showCompiledCSSToSide'](compiled);
  expect(compiled.showText).toHaveBeenNthCalledWith(1, { title: 'Compiled code', text: 'export default 1', languageId: 'javascript' });
  expect(compiled.showText).toHaveBeenNthCalledWith(2, { title: 'Compiled CSS', text: 'a{}', languageId: 'css' });
  const failed = context(); await toolCommands['svelte.showCompiledCodeToSide'](failed); expect(failed.message).toHaveBeenCalled();
  const places = [{ uri: 'file:///p/App.svelte', range: selection }];
  const references = context({ '$/getComponentReferences': places }); await toolCommands['svelte.typescript.findComponentReferences'](references);
  expect(references.showLocations).toHaveBeenCalledWith('Component References', places, 'No references found.');
  const extract = context({}, { ask: vi.fn(async () => 'Card') }); await toolCommands['svelte.extractComponent'](extract);
  expect(extract.request).toHaveBeenCalledWith('workspace/executeCommand:extract_to_svelte_component', { range: selection, filePath: 'Card' });
  const unnamed = context(); await toolCommands['svelte.extractComponent'](unnamed); expect(unnamed.request).not.toHaveBeenCalled();
});

test('the commands of the Java, Kotlin, PHP, JSON and YAML extensions', async () => {
  // Java: reload the project of this file, and a build that says how it ended (standardLanguageClient.ts).
  let c = context({ 'java/buildWorkspace': 2 }, { pick: vi.fn(async (_title: string, items: { value: unknown }[]) => items[1].value) as never });
  await toolCommands['jdtls.projectConfiguration.update'](c);
  expect(c.request).toHaveBeenCalledWith('java/projectConfigurationUpdate', {});
  await toolCommands['jdtls.workspace.compile'](c);
  expect(c.request).toHaveBeenLastCalledWith('java/buildWorkspace', { value: true }, true);
  expect(c.message).toHaveBeenLastCalledWith('Compilation finished with errors.');
  expect([0, 1, 3, undefined].map(javaBuildResult)).toEqual(['Compilation failed.', 'Compilation finished.', 'Compilation was cancelled.', 'Compilation failed.']);

  // Kotlin: the tests of the class at the caret, in the extension's words when there are none.
  const target = { uri: 'file:///p/src/test/kotlin/ATest.kt', range: { start: position, end: position } };
  c = context({ 'intellij/relatedTests': { isTest: false, targets: [target], sourceName: 'A' } });
  await toolCommands['kotlin.goToTest'](c);
  expect(c.request).toHaveBeenCalledWith('intellij/relatedTests', { position });
  expect(c.showLocations).toHaveBeenCalledWith('Go to Test', [target], 'No tests found for A');
  expect(kotlinNoRelatedTests(true)).toBe('No test subjects found');
  expect(source('kotlin-lsp/vscode-extension-core/src/relatedTestsModel.ts')).toContain("const what = options.isTest ? 'No test subjects found' : 'No tests found';");
  c = context({ 'setdown/kotlin.reloadWorkspace': true });
  await toolCommands['kotlin.reloadWorkspace'](c);
  expect(c.message).toHaveBeenCalledWith('Workspace reloaded');
  expect(source('kotlin-lsp/vscode-extension-core/src/extension.ts')).toContain('Workspace reloaded');

  // Intelephense: an entered key goes to the main process; a dismissed prompt changes nothing.
  c = context({}, { ask: vi.fn(async () => ' AbCdEfGhIjKlMn1 ') as never });
  await toolCommands['intelephense.enter.key'](c);
  expect(c.request).toHaveBeenCalledWith('setdown/intelephense.licenceKey', { key: ' AbCdEfGhIjKlMn1 ' }, true);
  const validate = (c.ask.mock.calls[0] as unknown as [{ validate(text: string): Promise<string | undefined> }])[0].validate;
  expect(await Promise.all([validate(''), validate('AbCdEfGhIjKlMn1'), validate('short')])).toEqual([undefined, undefined, 'A licence key must be a 15 character alphanumeric string.']);
  expect(source('vscode-intelephense/src/extension.ts')).toContain('A licence key must be a 15 character alphanumeric string.');
  c = context();
  await toolCommands['intelephense.enter.key'](c);
  expect(c.request).not.toHaveBeenCalled();
  await toolCommands['intelephense.cancel.indexing'](c); await toolCommands['intelephense.index.workspace'](c);
  expect(c.request.mock.calls.map(call => call[0])).toEqual(['cancelIndexing', 'setdown/intelephense.indexWorkspace']);

  // JSON: the server's edits are applied as they come (jsonClient.ts `json.sort`).
  const edit = { range: { start: { line: 0, character: 0 }, end: { line: 3, character: 1 } }, newText: '{}' };
  c = context({ 'json/sort': [edit, { newText: 1 }] });
  await toolCommands['json.sort'](c);
  expect(c.request).toHaveBeenCalledWith('json/sort', { options: { tabSize: 2, insertSpaces: true, trimTrailingWhitespace: false, trimFinalNewlines: false, insertFinalNewline: false } });
  expect(c.edit).toHaveBeenCalledWith([edit]);
  expect(source('vscode/extensions/json-language-features/client/src/jsonClient.ts')).toContain("'json/sort'");

  // YAML: the file's own schemas are marked, and the choice goes to the main process as addresses.
  const all = [{ uri: 'https://json.schemastore.org/github-workflow.json', name: 'GitHub Workflow', description: 'A workflow', usedForCurrentFile: true }, { uri: 'https://example.com/b.json' }, { name: 'no address' }];
  expect(yamlSchemaItems(all)).toEqual([{ label: 'GitHub Workflow', detail: 'Used for this file. A workflow', value: all[0].uri }, { label: all[1].uri, detail: all[1].uri, value: all[1].uri }]);
  // The choice is a row behind the language name, in the form every such choice has: what the
  // file is checked against first and marked, then "no schema", then the rest.
  expect(yamlEnvironment(all)).toEqual({ id: 'yaml-schema', label: 'Schema', value: 'GitHub Workflow', choices: [
    { id: all[0].uri, name: 'GitHub Workflow', detail: 'A workflow', current: true },
    { id: '', name: 'No schema', detail: 'This file is checked against no schema', current: false },
    { id: all[1].uri, name: all[1].uri, detail: all[1].uri, current: false }] });
  expect(yamlEnvironment([{ uri: 'https://example.com/b.json' }])).toMatchObject({ value: 'None', choices: [{ id: '', current: true }, { id: 'https://example.com/b.json', current: false }] });
  // The extension's command opens that row; it asks nothing itself.
  c = context({ 'yaml/get/all/jsonSchemas': all });
  await toolCommands['yaml.select.json.schema'](c);
  expect(c.inspect).toHaveBeenCalledWith('tool-environment', 'yaml-schema'); expect(c.request).not.toHaveBeenCalled(); expect(c.pick).not.toHaveBeenCalled();
});

test('the commands of the Go extension', async () => {
  // goImport.ts: the packages gopls knows are listed, and the picked one is added by gopls.
  let c = context({ 'workspace/executeCommand:gopls.list_known_packages': { Packages: ['fmt', 'net/http', '', 7] } }, { pick: vi.fn(async (_title: string, items: { value: unknown }[]) => items[1].value) as never });
  await toolCommands['gopls.import.add'](c);
  expect(c.pick.mock.calls[0][1]).toEqual([{ label: 'fmt', detail: '', value: 'fmt' }, { label: 'net/http', detail: '', value: 'net/http' }]);
  expect(c.request).toHaveBeenLastCalledWith('workspace/executeCommand:gopls.add_import', { importPath: 'net/http' }, true);
  expect(source('vscode-go/extension/src/goImport.ts')).toContain("'gopls.list_known_packages'");
  c = context({ 'workspace/executeCommand:gopls.list_known_packages': { Packages: [] } });
  await toolCommands['gopls.import.add'](c);
  expect(c.pick).not.toHaveBeenCalled(); expect(c.message).toHaveBeenCalledWith('No package to import was found.');

  // goGenerateTests.ts and toggleGCDetails.ts: the selection, and the document alone.
  c = context();
  await toolCommands['gopls.test.generate.function'](c); await toolCommands['gopls.toggle.gc_details'](c);
  expect(c.request.mock.calls).toEqual([['workspace/executeCommand:gopls.add_test', { range: selection }, true], ['workspace/executeCommand:gopls.gc_details', {}, true]]);

  // goModifytags.ts: sent with the settings' tags; where there are none the person types them.
  c = context({ 'setdown/go.modifyTags': null });
  await toolCommands['gopls.add.tags'](c);
  expect(c.request.mock.calls).toEqual([['setdown/go.modifyTags', { modification: 'add', range: selection }, true]]); expect(c.ask).not.toHaveBeenCalled();
  c = context({}, { request: vi.fn(async (_method: string, params: { tags?: string }) => params.tags === undefined ? { ask: 'Tags to remove' } : null) as never, ask: vi.fn(async () => ' json,xml ') as never });
  await toolCommands['gopls.remove.tags'](c);
  expect(c.request).toHaveBeenLastCalledWith('setdown/go.modifyTags', { modification: 'remove', range: selection, tags: 'json,xml' }, true);
  const validate = (c.ask.mock.calls[0] as unknown as [{ validate(text: string): Promise<string | undefined> }])[0].validate;
  expect(await Promise.all([validate('json'), validate('json, xml'), validate('a"b'), validate('')])).toEqual([undefined, undefined, 'Tag names separated by commas, for example json,xml', 'Tag names separated by commas, for example json,xml']);
  // gopls answers each of these with an edit of its own, which the editor takes only while such a request runs.
  expect(['setdown/go.modifyTags', 'workspace/executeCommand:gopls.add_import', 'workspace/executeCommand:gopls.add_test'].map(mayEdit)).toEqual([true, true, true]);
  expect(['setdown/go.versions', 'setdown/go.testCommand', 'textDocument/ast'].map(mayEdit)).toEqual([false, false, false]);

  // goEnvironmentStatus.ts `chooseGoEnvironment`: clear, the local ones, the downloadable ones; a refusal is said.
  const versions = { current: 'Go 1.22.3', chosen: true, local: [{ label: 'Go 1.21.0', program: '/home/me/sdk/go1.21.0/bin/go' }, { label: 7 }], downloadable: [{ label: 'Go 1.23.4', version: 'go1.23.4', importPath: 'golang.org/dl/go1.23.4', stable: true }] };
  expect(goVersionItems(versions).items.map(item => [item.label, item.value])).toEqual([['Clear selection', { clear: true }], ['Go 1.21.0', { program: '/home/me/sdk/go1.21.0/bin/go' }], ['Go 1.23.4', { version: 'go1.23.4' }]]);
  expect(goVersionItems({ ...versions, chosen: false }).items).toHaveLength(2);
  expect(source('vscode-go/extension/src/goEnvironmentStatus.ts')).toContain("const CLEAR_SELECTION = '$(clear-all) Clear selection';");
  // The same list as a row behind the language name: the Go in use first, and the Go of the
  // environment marked as what is in effect without a choice.
  const row = goEnvironment({ ...versions, current: 'Go 1.21.0' });
  expect(row).toMatchObject({ id: 'go', label: 'Go', value: 'Go 1.21.0' });
  expect(row.choices.map(choice => [choice.name, choice.detail, !!choice.current, !!choice.recommended])).toEqual([
    ['Go 1.21.0', '/home/me/sdk/go1.21.0/bin/go', true, false], ['Automatic', 'The Go of this environment', false, true], ['Go 1.23.4', 'Download', false, false]]);
  expect(row.choices.map(choice => goChoice(choice.id))).toEqual([{ program: '/home/me/sdk/go1.21.0/bin/go' }, { clear: true }, { version: 'go1.23.4' }]);
  // Without a choice the Go in use is the environment's own, so it is the recommended one and there is nothing to clear.
  expect(goEnvironment({ ...versions, current: 'Go 1.21.0', chosen: false }).choices.map(choice => [choice.name, !!choice.current, !!choice.recommended])).toEqual([['Go 1.21.0', true, true], ['Go 1.23.4', false, false]]);
  expect(goEnvironment({ refusal: 'Switching Go version when "go.goroot" is set is unsupported.', current: 'Go 1.22.3' })).toEqual({ id: 'go', label: 'Go', value: 'Go 1.22.3', choices: [], refusal: 'Switching Go version when "go.goroot" is set is unsupported.' });
  expect([goChoice('{"program":7}'), goChoice('not json'), goChoice('{}')]).toEqual([undefined, undefined, undefined]);
  expect(toolEnvironmentRows).toEqual({ gopls: { id: 'go', label: 'Go' }, yaml: { id: 'yaml-schema', label: 'Schema' } });
  c = context({ 'setdown/go.versions': versions });
  await toolCommands['gopls.environment.choose'](c);
  expect(c.inspect).toHaveBeenCalledWith('tool-environment', 'go'); expect(c.request).not.toHaveBeenCalled(); expect(c.pick).not.toHaveBeenCalled();

  // A "run test" lens runs `go test` in the terminal, with the line and the environment the main process made.
  c = context({ 'setdown/go.testCommand': { cwd: '/p/pkg', program: 'go', args: ['test', '-test.fullpath=true', '-timeout', '30s', '-run', '^TestAdd$', '.'], label: 'go test TestAdd', env: { GOFLAGS: '-mod=mod', 'bad name': 'x', N: 3 } } });
  await clientCommandHandlers.gopls!['gopls.run_tests'](c, [{ URI: 'file:///p/pkg/add_test.go', Tests: ['TestAdd'], Benchmarks: [] }]);
  expect(c.request).toHaveBeenCalledWith('setdown/go.testCommand', { arguments: [{ URI: 'file:///p/pkg/add_test.go', Tests: ['TestAdd'], Benchmarks: [] }] }, true);
  expect(c.run).toHaveBeenCalledWith({ cwd: '/p/pkg', program: 'go', args: ['test', '-test.fullpath=true', '-timeout', '30s', '-run', '^TestAdd$', '.'], env: { GOFLAGS: '-mod=mod' } });
  c = context({ 'setdown/go.testCommand': null });
  await clientCommandHandlers.gopls!['gopls.run_tests'](c, [{}]);
  expect(c.run).not.toHaveBeenCalled(); expect(c.message).toHaveBeenCalledWith('The tool did not say how to run this.');
});

test('every command has one place, and no place is a fixed line of a menu', () => {
  const at = (place: string) => toolCommandList.filter(command => command.place === place).map(command => command.id);
  expect(toolCommandList.every(command => ['here', 'document', 'project', 'environment', 'settings', 'typed', 'key'].includes(command.place))).toBe(true);
  expect(toolCommandList.some(command => 'menu' in command)).toBe(false);
  // A choice of what the analysis is based on is made behind the language name, for every language alike.
  expect(at('environment')).toEqual(['yaml.select.json.schema', 'gopls.environment.choose']);
  // The only behaviour of a key: Enter. It keeps its key and is listed nowhere.
  expect(at('key')).toEqual(['rust-analyzer.onEnter']);
  expect(unlistedCommandIds).toEqual([toolActionId('rust-analyzer.onEnter')]);
  // What acts on the project or the tool is named plainly on the tool's own page, without the tool's name.
  for (const command of toolCommandList.filter(command => command.place === 'project' || command.place === 'settings')) {
    expect(command.short, command.id).toBeTruthy();
    expect(command.short, command.id).not.toMatch(/rust-analyzer|flycheck|proc macro|Java:|Kotlin:|Intelephense:/i);
  }
  expect(at('project')).toEqual(['rust-analyzer.openCargoToml', 'rust-analyzer.reloadWorkspace', 'rust-analyzer.rebuildProcMacros', 'rust-analyzer.runFlycheck', 'rust-analyzer.cancelFlycheck',
    'rust-analyzer.clearFlycheck', 'rust-analyzer.analyzerStatus', 'rust-analyzer.viewFileText', 'jdtls.projectConfiguration.update', 'jdtls.project.import', 'jdtls.workspace.compile',
    'kotlin.reloadWorkspace', 'intelephense.index.workspace', 'intelephense.cancel.indexing']);
  // What concerns the file as a whole is offered in the command list while it is empty; nothing of a tool is.
  expect(at('document')).toEqual(['svelte.typescript.findAllFileReferences', 'svelte.typescript.findComponentReferences', 'gopls.import.add']);
  expect(documentCommandIds).toEqual(expect.arrayContaining(['editor.action.formatDocument', 'setdown.language-problems', ...at('document').map(toolActionId)]));
  expect(documentCommandIds.some(id => at('typed').map(toolActionId).includes(id))).toBe(false);
  // While the command list is empty a tool's command for the document carries no tool's name.
  expect(documentCommandNames).toEqual({ [toolActionId('svelte.typescript.findAllFileReferences')]: 'Find File References', [toolActionId('svelte.typescript.findComponentReferences')]: 'Find Component References',
    [toolActionId('gopls.import.add')]: 'Add Import' });
  // Every command of a tool is still found under the name its extension gives it.
  expect(toolCommandList.every(command => /^(rust-analyzer|clangd|Svelte|Java|Kotlin|Intelephense|JSON|YAML|Go): /.test(command.title))).toBe(true);
});

test('the syntax tree is a document with one node on a line', () => {
  // syntax_tree_provider.ts: nodes and tokens with `[offset, line, column]` from zero.
  const tree = JSON.stringify({ type: 'Node', kind: 'SOURCE_FILE', start: [0, 0, 0], end: [12, 0, 12], children: [
    { type: 'Node', kind: 'FN', start: [0, 0, 0], end: [12, 0, 12], children: [{ type: 'Token', kind: 'FN_KW', start: [0, 0, 0], end: [2, 0, 2] }, { type: 'Token', kind: 'WHITESPACE', start: [2, 0, 2], end: [3, 1, 0] }] }] });
  expect(syntaxTreeText(tree)).toBe('SOURCE_FILE  1:1-1:13\n  FN  1:1-1:13\n    FN_KW  1:1-1:3\n    WHITESPACE  1:3-2:1');
  expect([syntaxTreeText('not json'), syntaxTreeText('{}'), syntaxTreeText(null)]).toEqual([undefined, undefined, undefined]);
  expect(source('rust-analyzer/editors/code/src/syntax_tree_provider.ts')).toContain('const [startOffset, startLine, startCol] = value.start;');
});
