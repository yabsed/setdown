import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { createTypeStubCommand, organizeImportsCommand, organizeImportsEdits, pyrightCommands, pyrightHeapSize, pyrightInitializationOptions, pyrightNodeArguments,
  restartServerCommand } from './pyright-client';

const vendor = path.resolve(__dirname, '../../../../../vendor');
const source = (file: string) => readFileSync(path.join(vendor, file), 'utf8');
const properties = (tool: string) => JSON.parse(source(`${tool}/packages/vscode-pyright/package.json`)).contributes.configuration.properties as Record<string, { default?: unknown }>;
const uri = pathToFileURL(path.resolve('/project/app.py')).href;
const edit = (line: number, newText: string, end = line + 1) => ({ range: { start: { line, character: 0 }, end: { line: end, character: 0 } }, newText });

test('the server gets the heap the client asks for, as an argument for Node', () => {
  expect(pyrightHeapSize).toBe(3072);
  expect(pyrightNodeArguments).toEqual(['--max-old-space-size=3072']);
  const extension = source('pyright/packages/vscode-pyright/src/extension.ts');
  expect(extension).toContain(`const defaultHeapSize = ${pyrightHeapSize};`);
  expect(extension).toContain('const runOptions = { execArgv: [`--max-old-space-size=${defaultHeapSize}`] };');
  expect(source('basedpyright/packages/vscode-pyright/src/extension.ts')).toContain(`const defaultHeapSize = ${pyrightHeapSize};`);
});

test('the client starts another entry point over another transport than Setdown does', () => {
  const extension = source('pyright/packages/vscode-pyright/src/extension.ts');
  expect(extension).toContain("const bundlePath = context.asAbsolutePath(path.join('dist', 'server.js'));");
  expect(extension).toContain('transport: TransportKind.ipc,');
  // The two entry points differ in the number of workers, which only sizes the shared memory count.
  expect(source('pyright/packages/vscode-pyright/src/server.ts')).toContain('main(/* maxWorkers */ 1);');
  expect(source('pyright/packages/pyright/src/langserver.ts')).toContain('main(/* maxWorkers */ 0);');
  expect(source('pyright/packages/pyright/rspack.config.js')).toContain("'pyright-langserver': './src/langserver.ts',");
  expect(source('pyright/packages/pyright/langserver.index.js')).toContain("require('./dist/pyright-langserver');");
  const cache = source('pyright/packages/pyright-internal/src/analyzer/cacheManager.ts');
  expect(cache.match(/_maxWorkers/g)).toHaveLength(3);
  expect(cache).toContain('if (!this._sharedUsageBuffer && this._maxWorkers > 0) {');
});

test('the initialization options are the two settings, with the extension\'s defaults', () => {
  expect(pyrightInitializationOptions(undefined)).toEqual({ diagnosticMode: 'openFilesOnly', disablePullDiagnostics: false });
  expect(pyrightInitializationOptions({ python: { analysis: { diagnosticMode: 'workspace' } }, 'pyright.disablePullDiagnostics': true }))
    .toEqual({ diagnosticMode: 'workspace', disablePullDiagnostics: true });
  // What is not a mode or a switch is the default.
  expect(pyrightInitializationOptions({ python: { analysis: { diagnosticMode: 7 } }, pyright: { disablePullDiagnostics: 'yes' } }))
    .toEqual({ diagnosticMode: 'openFilesOnly', disablePullDiagnostics: false });
  // basedpyright has its own names and does not read Pyright's.
  const based = { basedpyright: { analysis: { diagnosticMode: 'workspace' }, disablePullDiagnostics: true } };
  expect(pyrightInitializationOptions(based, 'basedpyright')).toEqual({ diagnosticMode: 'workspace', disablePullDiagnostics: true });
  expect(pyrightInitializationOptions(based)).toEqual({ diagnosticMode: 'openFilesOnly', disablePullDiagnostics: false });

  const extension = source('pyright/packages/vscode-pyright/src/extension.ts');
  expect(extension).toContain("diagnosticMode: workspace.getConfiguration('python.analysis').get('diagnosticMode'),");
  expect(extension).toContain("disablePullDiagnostics: workspace.getConfiguration('pyright').get('disablePullDiagnostics'),");
  expect(properties('pyright')['python.analysis.diagnosticMode'].default).toBe('openFilesOnly');
  expect(properties('pyright')['pyright.disablePullDiagnostics'].default).toBe(false);
  const basedExtension = source('basedpyright/packages/vscode-pyright/src/extension.ts');
  expect(basedExtension).toContain("diagnosticMode: workspace.getConfiguration('basedpyright.analysis').get('diagnosticMode'),");
  expect(basedExtension).toContain("disablePullDiagnostics: workspace.getConfiguration('basedpyright').get('disablePullDiagnostics'),");
  expect(properties('basedpyright')['basedpyright.analysis.diagnosticMode'].default).toBe('openFilesOnly');
  expect(properties('basedpyright')['basedpyright.disablePullDiagnostics'].default).toBe(false);
  // The server reads one of the two from these options.
  expect(source('pyright/packages/pyright-internal/src/types.ts')).toMatch(/export type InitializationOptions = \{\s+diagnosticMode\?: string;\s+disablePullDiagnostics\?: boolean;\s+\};/);
  const base = source('pyright/packages/pyright-internal/src/languageServerBase.ts');
  expect(base).toContain('initializationOptions?.disablePullDiagnostics !== true;');
  expect(base).not.toContain('initializationOptions?.diagnosticMode');
  expect(source('pyright/packages/pyright-internal/src/pyrightServer.ts')).toContain('serverSettings.openFilesOnly = this.isOpenFilesOnly(pythonAnalysisSection.diagnosticMode);');
});

test('the commands and their arguments are the ones the client sends', () => {
  expect(organizeImportsCommand(uri)).toEqual({ command: 'pyright.organizeimports', arguments: [uri] });
  expect(organizeImportsCommand(uri, 'basedpyright')).toEqual({ command: 'basedpyright.organizeimports', arguments: [uri] });
  expect(restartServerCommand()).toEqual({ command: 'pyright.restartserver', arguments: [] });
  expect(restartServerCommand('basedpyright')).toEqual({ command: 'basedpyright.restartserver', arguments: [] });
  expect(createTypeStubCommand('file:///project', 'requests', uri)).toEqual({ command: 'pyright.createtypestub', arguments: ['file:///project', 'requests', uri] });
  expect(createTypeStubCommand('file:///project', 'requests')).toEqual({ command: 'pyright.createtypestub', arguments: ['file:///project', 'requests'] });

  const names = source('pyright/packages/pyright-internal/src/commands/commands.ts');
  expect(names).toContain(`createTypeStub = '${pyrightCommands.pyright.createTypeStub}',`);
  expect(names).toContain(`restartServer = '${pyrightCommands.pyright.restartServer}',`);
  expect(names).toContain(`orderImports = '${pyrightCommands.pyright.organizeImports}',`);
  const basedNames = source('basedpyright/packages/pyright-internal/src/commands/commands.ts');
  expect(basedNames).toContain(`createTypeStub = '${pyrightCommands.basedpyright.createTypeStub}',`);
  expect(basedNames).toContain(`restartServer = '${pyrightCommands.basedpyright.restartServer}',`);
  expect(basedNames).toContain(`orderImports = '${pyrightCommands.basedpyright.organizeImports}',`);
  expect(basedNames).toContain(`writeBaseline = '${pyrightCommands.basedpyright.writeBaseline}',`);

  const extension = source('pyright/packages/vscode-pyright/src/extension.ts');
  expect(extension).toContain('const textEditorCommands = [Commands.orderImports];');
  expect(extension).toContain('arguments: [editor.document.uri.toString(), ...args],');
  expect(extension).toContain('const genericCommands = [Commands.createTypeStub, Commands.restartServer];');
  expect(extension).toContain("client.sendRequest('workspace/executeCommand', { command, arguments: args });");
  // The server names none of them in its capabilities; basedpyright's names all but the first.
  expect(source('pyright/packages/pyright-internal/src/pyrightServer.ts')).not.toContain('supportedCommands');
  expect(source('basedpyright/packages/pyright-internal/src/realLanguageServer.ts')).toContain('supportedCommands: [Commands.createTypeStub, Commands.restartServer, Commands.writeBaseline],');
  // Where the server makes and reads the arguments of the type stub command.
  const actions = source('pyright/packages/pyright-internal/src/languageService/codeActionProvider.ts');
  expect(actions).toMatch(/Commands\.createTypeStub,\s+workspace\.rootUri\.toString\(\),\s+action\.moduleName,\s+fileUri\.toString\(\)/);
  const stub = source('pyright/packages/pyright-internal/src/commands/createTypeStub.ts');
  expect(stub).toContain('if (!cmdParams.arguments || cmdParams.arguments.length < 2) {');
  expect(stub).toContain('const importName = cmdParams.arguments[1] as string;');
  expect(stub).toContain('const callingFileArg = cmdParams.arguments[2] as string | undefined;');
  expect(source('pyright/packages/pyright-internal/src/analyzer/service.ts')).toMatch(/restart\(\) \{\s+this\.applyConfigOptions\(this\._hostFactory\(\)\);\s+this\._backgroundAnalysisProgram\.restart\(\);/);
});

test('organize imports gives the edits of the document, from either form of the answer', () => {
  const edits = [edit(0, 'import os\nimport sys\n', 2), edit(4, '')];
  // What the client reads: a list of edits.
  expect(organizeImportsEdits(edits, uri)).toEqual(edits);
  // What the server of this version answers: a workspace edit for the one document.
  expect(organizeImportsEdits({ changes: { [uri]: edits } }, uri)).toEqual(edits);
  // The server's spelling of the address need not be the one it was sent.
  expect(organizeImportsEdits({ changes: { [uri.replace('app.py', '%61pp.py')]: edits } }, uri)).toEqual(edits);
  // Another document's edits are not this document's.
  expect(organizeImportsEdits({ changes: { [uri.replace('app.py', 'other.py')]: edits } }, uri)).toEqual([]);
  expect(organizeImportsEdits({ changes: { 'untitled:Untitled-1': edits } }, 'untitled:Untitled-1')).toEqual(edits);
  expect(organizeImportsEdits({ changes: { 'untitled:Untitled-2': edits } }, 'untitled:Untitled-1')).toEqual([]);
  // Only what an edit is made of is passed on.
  expect(organizeImportsEdits([{ ...edit(1, 'x'), annotationId: 'a', range: { ...edit(1, 'x').range, extra: 1 } }], uri)).toEqual([edit(1, 'x')]);
  // Nothing to do.
  expect(organizeImportsEdits([], uri)).toEqual([]);
  expect(organizeImportsEdits({ changes: {} }, uri)).toEqual([]);
  expect(organizeImportsEdits({ changes: { [uri]: [] } }, uri)).toEqual([]);
});

test('an answer that cannot be read whole gives no edits at all', () => {
  for (const nothing of [undefined, null, 'edits', 7, true, {}, { changes: null }, { changes: [] }, { changes: { [uri]: 'x' } }, { documentChanges: [] }])
    expect(organizeImportsEdits(nothing, uri)).toEqual([]);
  const good = edit(0, 'import os\n');
  for (const bad of [null, 'x', {}, { range: good.range }, { newText: 'x' }, { range: { start: { line: 0, character: 0 } }, newText: 'x' },
    { range: { start: { line: -1, character: 0 }, end: { line: 0, character: 0 } }, newText: 'x' },
    { range: { start: { line: 0.5, character: 0 }, end: { line: 1, character: 0 } }, newText: 'x' },
    { range: { start: { line: 0, character: '0' }, end: { line: 1, character: 0 } }, newText: 'x' }, { ...good, newText: 7 }]) {
    expect(organizeImportsEdits([good, bad], uri)).toEqual([]);
    expect(organizeImportsEdits({ changes: { [uri]: [good, bad] } }, uri)).toEqual([]);
  }
  expect(organizeImportsEdits(Array.from({ length: 10_000 }, (_, line) => edit(line, '')), uri)).toHaveLength(10_000);
  expect(organizeImportsEdits(Array.from({ length: 10_001 }, (_, line) => edit(line, '')), uri)).toEqual([]);
});

test('the two forms of the answer are the client\'s and the server\'s, and the server applies its own', () => {
  const extension = source('pyright/packages/vscode-pyright/src/extension.ts');
  expect(extension).toContain("client.sendRequest<TextEdit[] | undefined>('workspace/executeCommand', cmd).then((edits) => {");
  expect(extension).toContain('if (edits && edits.length > 0) {');
  expect(extension).toContain('editBuilder.replace(range, edit.newText);');
  const command = source('pyright/packages/pyright-internal/src/commands/quickActionCommand.ts');
  expect(command).toContain('return convertToWorkspaceEdit(workspace.service.fs, convertToFileTextEdits(docUri, editActions ?? []));');
  expect(command).toContain('if (params.command === Commands.orderImports && workspace.disableOrganizeImports) {');
  const edits = source('pyright/packages/pyright-internal/src/common/workspaceEditUtils.ts');
  expect(edits).toMatch(/if \(isArray\(edits\)\) \{\s+return _convertToWorkspaceEditWithChanges\(fs, edits\);/);
  expect(edits).toContain('workspaceEdit.changes![uri].push({ range: edit.range, newText: edit.replacementText });');
  const base = source('pyright/packages/pyright-internal/src/languageServerBase.ts');
  expect(base).toMatch(/if \(WorkspaceEdit\.is\(result\) && hasWorkspaceEditChanges\(result\)\) \{\s+\/\/ Tell client to apply edits\.\s+\/\/ Do not await; the client isn't expecting a result\.\s+this\.connection\.workspace\.applyEdit\(\{/);
  expect(source('pyright/packages/pyright-internal/src/languageService/quickActions.ts')).toContain('if (!sourceFileInfo || !sourceFileInfo.isOpenByClient) {');
});
