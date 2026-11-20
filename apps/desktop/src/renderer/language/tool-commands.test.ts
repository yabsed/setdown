import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { clientCommands, mayEdit, toolFamilies, toolRequest } from '../../protocol/language-tools';
import { toolCommandList, toolContextKey } from './tool-command-list';
import { astText, clientCommandHandlers, commandLine, goVersionItems, javaBuildResult, kotlinNoRelatedTests, memoryLayout, memoryText, plainSnippet, runnable, toolCommands, yamlSchemaItems, type ToolCommandContext } from './tool-commands';

const vendor = path.resolve(__dirname, '../../../../../vendor');
const source = (file: string) => readFileSync(path.join(vendor, file), 'utf8');
const position = { line: 4, character: 7 }, selection = { start: position, end: position };
function context(answers: Record<string, unknown> = {}, more: Partial<ToolCommandContext> = {}) {
  const mocks = { request: vi.fn(async (method: string) => answers[method] ?? null), showText: vi.fn(async () => {}), showLocations: vi.fn(async () => {}), open: vi.fn(async () => {}),
    ask: vi.fn(async () => undefined), pick: vi.fn(async (_title: string, items: { value: unknown }[]) => items[0]?.value), edit: vi.fn(), workspaceEdit: vi.fn(async () => {}), select: vi.fn(),
    run: vi.fn(async () => true), copy: vi.fn(async () => {}), link: vi.fn(async () => {}), message: vi.fn(), editorAction: vi.fn(async () => {}), type: vi.fn(),
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
  c = context({ 'yaml/get/all/jsonSchemas': all }, { pick: vi.fn(async (_title: string, items: { value: unknown }[]) => items[2].value) as never });
  await toolCommands['yaml.select.json.schema'](c);
  expect(c.request).toHaveBeenLastCalledWith('setdown/yaml.selectSchemas', { selected: ['https://example.com/b.json'] }, true);
  c = context({ 'yaml/get/all/jsonSchemas': all }, { pick: vi.fn(async (_title: string, items: { value: unknown }[]) => items[0].value) as never });
  await toolCommands['yaml.select.json.schema'](c);
  expect(c.request).toHaveBeenLastCalledWith('setdown/yaml.selectSchemas', { selected: [] }, true);
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
  c = context({ 'setdown/go.versions': versions, 'setdown/go.chooseVersion': true }, { pick: vi.fn(async (_title: string, items: { value: unknown }[]) => items[2].value) as never });
  await toolCommands['gopls.environment.choose'](c);
  expect(c.pick.mock.calls[0][0]).toBe('Go: Choose Go Environment (in use: Go 1.22.3)');
  expect(c.request).toHaveBeenLastCalledWith('setdown/go.chooseVersion', { version: 'go1.23.4' }, true);
  expect(c.message.mock.calls.map(call => call[0])).toEqual(['Downloading go1.23.4…', 'Go changed; gopls is starting again.']);
  c = context({ 'setdown/go.versions': { refusal: 'Switching Go version when "go.goroot" is set is unsupported.' } });
  await toolCommands['gopls.environment.choose'](c);
  expect(c.pick).not.toHaveBeenCalled(); expect(c.message).toHaveBeenCalledWith('Switching Go version when "go.goroot" is set is unsupported.');

  // A "run test" lens runs `go test` in the terminal, with the line and the environment the main process made.
  c = context({ 'setdown/go.testCommand': { cwd: '/p/pkg', program: 'go', args: ['test', '-test.fullpath=true', '-timeout', '30s', '-run', '^TestAdd$', '.'], label: 'go test TestAdd', env: { GOFLAGS: '-mod=mod', 'bad name': 'x', N: 3 } } });
  await clientCommandHandlers.gopls!['gopls.run_tests'](c, [{ URI: 'file:///p/pkg/add_test.go', Tests: ['TestAdd'], Benchmarks: [] }]);
  expect(c.request).toHaveBeenCalledWith('setdown/go.testCommand', { arguments: [{ URI: 'file:///p/pkg/add_test.go', Tests: ['TestAdd'], Benchmarks: [] }] }, true);
  expect(c.run).toHaveBeenCalledWith({ cwd: '/p/pkg', program: 'go', args: ['test', '-test.fullpath=true', '-timeout', '30s', '-run', '^TestAdd$', '.'], env: { GOFLAGS: '-mod=mod' } });
  c = context({ 'setdown/go.testCommand': null });
  await clientCommandHandlers.gopls!['gopls.run_tests'](c, [{}]);
  expect(c.run).not.toHaveBeenCalled(); expect(c.message).toHaveBeenCalledWith('The tool did not say how to run this.');
});
