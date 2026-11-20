// A tool's own editor extension asks it things the protocol has no name for, and runs commands
// the tool hands back to its editor. This file is the list of both, shared by the editor (which
// offers them) and the main process (which sends each only to the tool it belongs to and makes
// its parameter). The editor never names a server command or a document address itself.

/** The tools whose extension's behaviour is carried over. A tool outside this list is spoken to in the protocol only. */
export const toolFamilies = ['rust-analyzer', 'clangd', 'svelte', 'typescript', 'gopls', 'jdtls', 'kotlin', 'intelephense', 'pyright', 'json', 'yaml', 'html', 'css'] as const;
export type ToolFamily = typeof toolFamilies[number];

/** How a tool says that it could not find what a file brings in. Until the tool says so, nothing on
 * the screen claims that the project needs setting up: a missing configuration file is not a symptom.
 *   clangd: the name of clang's diagnostic (`pp_file_not_found`), checked against clangd 22.
 *   Pyright: vendor/pyright/packages/pyright-internal/src/common/diagnosticRules.ts
 *   TypeScript: diagnosticMessages 2307 and 2792 ("Cannot find module …"). */
export const unresolvedSymptoms: Partial<Record<ToolFamily, { noun: 'include' | 'import'; codes: readonly (string | number)[] }>> = {
  clangd: { noun: 'include', codes: ['pp_file_not_found'] },
  pyright: { noun: 'import', codes: ['reportMissingImports', 'reportMissingModuleSource'] },
  typescript: { noun: 'import', codes: [2307, 2792] },
};
/** Whether this diagnostic of the tool is such a symptom. */
export function isUnresolvedSymptom(tool: ToolFamily | undefined, code: unknown): boolean {
  const value = code && typeof code === 'object' ? (code as { value?: unknown }).value : code;
  return !!tool && !!unresolvedSymptoms[tool]?.codes.some(known => known === value || String(known) === String(value));
}

/** How the parameter is made from the object the editor sends:
 *  `document`    the object with `textDocument: { uri }` added
 *  `identifier`  `{ uri }` alone (a `TextDocumentIdentifier`)
 *  `address`     the document's address alone, a string
 *  `located`     the object with `uri` added (the JSON server's `{ uri, options }`)
 *  `value`       the object's `value` alone: a request whose parameter is a number or a yes/no
 *  `none`        no parameter
 *  `plain`       the object as it is */
export type ToolRequestShape = 'document' | 'identifier' | 'address' | 'located' | 'value' | 'none' | 'plain';
export type ToolRequest = { tool: ToolFamily } & (
  /** Sent under its own name: a request, or with `notification` a notification. */
  | { shape: ToolRequestShape; notification?: true }
  /** Not sent as it is: the main process does what the extension's command does, which takes
   * more than one message to the tool (write a setting, start the tool again with other options).
   * `edits`: it ends in a command of the tool, which may change files while it runs. */
  | { own: true; edits?: true }
  /** Sent as `workspace/executeCommand` with this command name. The arguments are made here,
   * from the document's address and the editor's object, so the editor chooses neither. */
  | { command: string; arguments(uri: string, params: Record<string, unknown>): unknown[] });

const request = (tool: ToolFamily, shape: ToolRequestShape): ToolRequest => ({ tool, shape });
const notification = (tool: ToolFamily, shape: ToolRequestShape): ToolRequest => ({ tool, shape, notification: true });
const command = (tool: ToolFamily, name: string, args: (uri: string, params: Record<string, unknown>) => unknown[]): ToolRequest => ({ tool, command: name, arguments: args });
const own = (tool: ToolFamily, edits = false): ToolRequest => ({ tool, own: true, ...(edits ? { edits: true as const } : {}) });

/** Every request outside the protocol that may cross from the editor to a tool. The source of
 * each name and shape is the tool's extension:
 *   vendor/rust-analyzer/editors/code/src/lsp_ext.ts
 *   vendor/vscode-clangd/src/{switch-source-header,ast,memory-usage}.ts
 *   vendor/svelte-language-tools/packages/svelte-vscode/src/extension.ts, typescript/findFileReferences.ts, findComponentReferences.ts
 *   vendor/vscode/extensions/html-language-features/client/src/htmlClient.ts
 *   vendor/vscode/extensions/json-language-features/client/src/jsonClient.ts (`json/sort`)
 *   vendor/vscode-yaml/src/schema-status-bar-item.ts
 *   vendor/vscode-java/src/{protocol,commands}.ts
 *   vendor/kotlin-lsp/vscode-extension-core/src/{extension,relatedTests}.ts
 *   vendor/vscode-intelephense/src/extension.ts
 *   vendor/vscode-go/extension/src/{goImport,goGenerateTests,goModifytags,goEnvironmentStatus}.ts, commands/toggleGCDetails.ts */
export const toolRequests = {
  'html/autoInsert': request('html', 'document'),
  'html/tag': request('svelte', 'document'),
  // clangd takes the document itself as the parameter (switch-source-header.ts).
  'textDocument/switchSourceHeader': request('clangd', 'identifier'),
  'textDocument/ast': request('clangd', 'document'),
  // memory-usage.ts sends an empty object.
  '$/memoryUsage': request('clangd', 'plain'),

  'rust-analyzer/analyzerStatus': request('rust-analyzer', 'document'),
  'rust-analyzer/memoryUsage': request('rust-analyzer', 'none'),
  'rust-analyzer/reloadWorkspace': request('rust-analyzer', 'none'),
  'rust-analyzer/rebuildProcMacros': request('rust-analyzer', 'none'),
  'rust-analyzer/viewSyntaxTree': request('rust-analyzer', 'document'),
  'rust-analyzer/viewHir': request('rust-analyzer', 'document'),
  'rust-analyzer/viewMir': request('rust-analyzer', 'document'),
  'rust-analyzer/interpretFunction': request('rust-analyzer', 'document'),
  'rust-analyzer/viewFileText': request('rust-analyzer', 'identifier'),
  'rust-analyzer/viewItemTree': request('rust-analyzer', 'document'),
  'rust-analyzer/viewCrateGraph': request('rust-analyzer', 'plain'),
  'rust-analyzer/expandMacro': request('rust-analyzer', 'document'),
  'rust-analyzer/relatedTests': request('rust-analyzer', 'document'),
  'rust-analyzer/viewRecursiveMemoryLayout': request('rust-analyzer', 'document'),
  'rust-analyzer/getFailedObligations': request('rust-analyzer', 'document'),
  'rust-analyzer/runFlycheck': notification('rust-analyzer', 'document'),
  'rust-analyzer/cancelFlycheck': notification('rust-analyzer', 'none'),
  'rust-analyzer/clearFlycheck': notification('rust-analyzer', 'none'),
  'experimental/joinLines': request('rust-analyzer', 'document'),
  'experimental/matchingBrace': request('rust-analyzer', 'document'),
  'experimental/moveItem': request('rust-analyzer', 'document'),
  'experimental/onEnter': request('rust-analyzer', 'document'),
  'experimental/parentModule': request('rust-analyzer', 'document'),
  'experimental/childModules': request('rust-analyzer', 'document'),
  'experimental/openCargoToml': request('rust-analyzer', 'document'),
  'experimental/externalDocs': request('rust-analyzer', 'document'),
  'experimental/runnables': request('rust-analyzer', 'document'),
  'experimental/ssr': request('rust-analyzer', 'document'),

  '$/getFileReferences': request('svelte', 'address'),
  '$/getComponentReferences': request('svelte', 'address'),
  '$/getCompiledCode': request('svelte', 'address'),
  // extension.ts `addMigrateToSvelte5Command`: the document's address is the only argument.
  'workspace/executeCommand:migrate_to_svelte_5': command('svelte', 'migrate_to_svelte_5', uri => [uri]),
  // extension.ts `addExtracComponentCommand`: the selection and the name the person gave the new component.
  'workspace/executeCommand:extract_to_svelte_component': command('svelte', 'extract_to_svelte_component', (uri, params) => [uri, { uri, range: params.range, filePath: params.filePath }]),

  // jsonClient.ts `getSortTextEdits`: `{ uri, options }`, answered with text edits.
  'json/sort': request('json', 'located'),
  // The schemas of this file, and every schema the server knows with the file's own marked.
  'yaml/get/jsonSchema': request('yaml', 'address'),
  'yaml/get/all/jsonSchemas': request('yaml', 'address'),
  // The person's choice among them, written to `yaml.schemas` (`yaml-schema-choice.ts`).
  'setdown/yaml.selectSchemas': own('yaml'),

  // protocol.ts: reload the project of this build file; build everything (`true`: from nothing).
  'java/projectConfigurationUpdate': notification('jdtls', 'identifier'),
  'java/buildWorkspace': request('jdtls', 'value'),
  'workspace/executeCommand:java.project.import': command('jdtls', 'java.project.import', () => []),

  'intellij/relatedTests': request('kotlin', 'document'),
  // extension.ts `reloadWorkspace`: the initialization options are sent again, made in the main process.
  'setdown/kotlin.reloadWorkspace': own('kotlin'),

  // extension.ts: `cancelIndexing` has no parameter; the other two start the tool again.
  'cancelIndexing': request('intelephense', 'none'),
  'setdown/intelephense.indexWorkspace': own('intelephense'),
  'setdown/intelephense.licenceKey': own('intelephense'),

  // goImport.ts: the packages that can be imported into this file, then the one the person picked.
  'workspace/executeCommand:gopls.list_known_packages': command('gopls', 'gopls.list_known_packages', uri => [{ URI: uri }]),
  'workspace/executeCommand:gopls.add_import': command('gopls', 'gopls.add_import', (uri, params) => [{ ImportPath: params.importPath, URI: uri }]),
  // goGenerateTests.ts `goplsGenerateTest`: the selection in the function to test.
  'workspace/executeCommand:gopls.add_test': command('gopls', 'gopls.add_test', (uri, params) => [{ URI: uri, range: params.range }]),
  // toggleGCDetails.ts: the one argument is the document's address itself.
  'workspace/executeCommand:gopls.gc_details': command('gopls', 'gopls.gc_details', uri => [uri]),
  // goModifytags.ts: `gopls.modify_tags` with what `go.addTags` and `go.removeTags` say, which the main process reads.
  'setdown/go.modifyTags': own('gopls', true),
  // goEnvironmentStatus.ts `chooseGoEnvironment`: the Go versions to choose from, and the choice.
  'setdown/go.versions': own('gopls'),
  'setdown/go.chooseVersion': own('gopls'),
  // The `go test` command line of a "run test" lens, made from the lens and the `go.test*` settings.
  'setdown/go.testCommand': own('gopls'),
} as const satisfies Record<string, ToolRequest>;
export type ToolMethod = keyof typeof toolRequests;
export const toolMethods = Object.keys(toolRequests) as ToolMethod[];
export const toolRequest = (method: string): ToolRequest | undefined => Object.hasOwn(toolRequests, method) ? (toolRequests as Record<string, ToolRequest>)[method] : undefined;
/** The request is a command: the tool may change files while it runs, as for `workspace/executeCommand`. */
export const isToolCommand = (method: string): boolean => { const row = toolRequest(method); return !!row && 'command' in row; };
/** The editor accepts the tool's edits while this request runs: a command, or an action of the
 * main process that ends in one. Without it the tool's `workspace/applyEdit` is declined. */
export const mayEdit = (method: string): boolean => { const row = toolRequest(method); return !!row && ('command' in row || 'own' in row && row.edits === true); };
/** The request is done by the main process itself and never sent under this name. */
export const isOwnAction = (method: string): boolean => { const row = toolRequest(method); return !!row && 'own' in row; };

/** What a tool is sent for one of its own requests, and under which name. */
export function toolMessage(method: string, params: Record<string, unknown>, uri: string): { method: string; params: unknown; notification: boolean } | undefined {
  const row = toolRequest(method);
  if (!row || 'own' in row) return undefined;
  if ('command' in row) return { method: 'workspace/executeCommand', params: { command: row.command, arguments: row.arguments(uri, params) }, notification: false };
  const made = row.shape === 'document' ? { ...params, textDocument: { uri } } : row.shape === 'identifier' ? { uri }
    : row.shape === 'address' ? uri : row.shape === 'located' ? { ...params, uri } : row.shape === 'value' ? params.value : row.shape === 'none' ? undefined : params;
  return { method, params: made, notification: !!row.notification };
}

/** Commands a tool names in a code lens, a hover or a code action and expects its editor to
 * run, because only the editor can: open a place, start a program in a terminal, show a list.
 * The main process declares exactly these to the tool; the editor runs each one
 * (`renderer/language/tool-commands.ts`). A debugger is not part of Setdown, so the commands
 * that start one are not declared and the tool does not offer them.
 *   vendor/rust-analyzer/editors/code/src/client.ts `ExperimentalFeatures` */
export const clientCommands: Partial<Record<ToolFamily, readonly string[]>> = {
  'rust-analyzer': ['rust-analyzer.runSingle', 'rust-analyzer.showReferences', 'rust-analyzer.gotoLocation', 'rust-analyzer.triggerParameterHints', 'rust-analyzer.rename'],
  // gopls' "run test" and "run benchmark" lenses. Nothing is declared for them: gopls offers them
  // when its `codelenses.test` option is on, and the editor runs the test in a terminal
  // (vendor/zed/crates/languages/src/go.rs `client_command`, vendor/vscode-go/extension/src/goTest.ts).
  gopls: ['gopls.run_tests'],
};
