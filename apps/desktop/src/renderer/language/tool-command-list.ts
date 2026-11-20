import type { ToolFamily } from '../../protocol/language-tools';

// The commands each tool's own extension adds to the editor, by the name the extension gives
// them. Only what is listed here is offered: in the command list (F1) always, and with `menu` in
// the editor's menu, while the document's tool is the one the command belongs to. This file is
// plain data so that the editor can register the commands without loading language support;
// what each one does is in `tool-commands.ts`.
//   vendor/rust-analyzer/editors/code/package.json `contributes.commands`, `keybindings`
//   vendor/vscode-clangd/package.json
//   vendor/svelte-language-tools/packages/svelte-vscode/package.json
//   vendor/vscode-java/package.json (titles in package.nls.json)
//   vendor/kotlin-lsp/kotlin-vscode/package.json
//   vendor/vscode-intelephense/package.json
//   vendor/vscode/extensions/json-language-features/package.json (titles in package.nls.json)
//   vendor/vscode-yaml/src/schema-status-bar-item.ts (`yaml.select.json.schema`, registered in code)
//   vendor/vscode-go/extension/package.json (`menu`: on in `go.editorContextMenuCommands` unless a person turns it off)

/** `key`: the extension's own key for the command, in the names this file gives them.
 * `command`: the extension's name for the command where it does not start with the tool's name here. */
export type ToolCommandInfo = { id: string; tool: ToolFamily; title: string; command?: string; menu?: true; key?: 'ctrl-shift-u' | 'ctrl-shift-j' | 'ctrl-shift-m' | 'enter' };

const rust = (id: string, title: string, more: Partial<ToolCommandInfo> = {}): ToolCommandInfo => ({ id: `rust-analyzer.${id}`, tool: 'rust-analyzer', title: `rust-analyzer: ${title}`, ...more });
const clangd = (id: string, title: string, more: Partial<ToolCommandInfo> = {}): ToolCommandInfo => ({ id: `clangd.${id}`, tool: 'clangd', title: `clangd: ${title}`, ...more });
const svelte = (id: string, title: string, more: Partial<ToolCommandInfo> = {}): ToolCommandInfo => ({ id: `svelte.${id}`, tool: 'svelte', title: `Svelte: ${title}`, ...more });

export const toolCommandList: readonly ToolCommandInfo[] = [
  rust('run', 'Run', { menu: true }),
  rust('copyRunCommandLine', 'Copy Run Command Line'),
  rust('peekTests', 'Peek Related Tests'),
  rust('expandMacro', 'Expand macro recursively at caret', { menu: true }),
  rust('parentModule', 'Locate parent module', { key: 'ctrl-shift-u' }),
  rust('childModules', 'Locate child modules'),
  rust('openCargoToml', 'Open Cargo.toml'),
  rust('openDocs', 'Open Docs'),
  rust('matchingBrace', 'Find matching brace'),
  rust('joinLines', 'Join lines', { key: 'ctrl-shift-j' }),
  rust('moveItemUp', 'Move Item Up'),
  rust('moveItemDown', 'Move Item Down'),
  rust('onEnter', 'Enhanced enter key', { key: 'enter' }),
  rust('ssr', 'Structural Search Replace'),
  rust('reloadWorkspace', 'Reload workspace'),
  rust('rebuildProcMacros', 'Rebuild proc macros and build scripts'),
  rust('runFlycheck', 'Run flycheck'),
  rust('cancelFlycheck', 'Cancel running flychecks'),
  rust('clearFlycheck', 'Clear flycheck diagnostics'),
  rust('analyzerStatus', 'Status'),
  rust('memoryUsage', 'Memory Usage (Clears Database)'),
  rust('viewSyntaxTree', 'Show Syntax Tree'),
  rust('viewHir', 'View Hir'),
  rust('viewMir', 'View Mir'),
  rust('interpretFunction', 'Interpret'),
  rust('viewFileText', 'View File Text (as seen by the server)'),
  rust('viewItemTree', 'Debug ItemTree'),
  rust('viewCrateGraph', 'View Crate Graph'),
  rust('viewFullCrateGraph', 'View Crate Graph (Full)'),
  rust('viewMemoryLayout', 'View Memory Layout'),
  rust('getFailedObligations', 'Get Failed Obligations'),
  clangd('ast', 'Show AST', { menu: true }),
  clangd('memoryUsage', 'Show memory usage'),
  svelte('showCompiledCodeToSide', 'Show Compiled Code'),
  svelte('showCompiledCSSToSide', 'Show Compiled CSS'),
  svelte('extractComponent', 'Extract Component', { menu: true }),
  svelte('typescript.findAllFileReferences', 'Find File References', { menu: true }),
  svelte('typescript.findComponentReferences', 'Find Component References', { menu: true }),
  svelte('migrate_to_svelte_5', 'Migrate Component to Svelte 5 Syntax'),
  { id: 'jdtls.projectConfiguration.update', command: 'java.projectConfiguration.update', tool: 'jdtls', title: 'Java: Reload Projects', menu: true },
  { id: 'jdtls.project.import', command: 'java.project.import.command', tool: 'jdtls', title: 'Java: Import Java Projects into Workspace' },
  { id: 'jdtls.workspace.compile', command: 'java.workspace.compile', tool: 'jdtls', title: 'Java: Force Java Compilation' },
  { id: 'kotlin.reloadWorkspace', command: 'jetbrains.kotlin.reloadWorkspace', tool: 'kotlin', title: 'Kotlin: Reload Workspace' },
  { id: 'kotlin.goToTest', command: 'jetbrains.editor.goToTest', tool: 'kotlin', title: 'Kotlin: Go to Test or Test Subject', menu: true },
  { id: 'intelephense.index.workspace', tool: 'intelephense', title: 'Intelephense: Index workspace' },
  { id: 'intelephense.cancel.indexing', tool: 'intelephense', title: 'Intelephense: Cancel indexing' },
  { id: 'intelephense.enter.key', tool: 'intelephense', title: 'Intelephense: Enter licence key' },
  { id: 'json.sort', tool: 'json', title: 'JSON: Sort Document' },
  { id: 'yaml.select.json.schema', tool: 'yaml', title: 'YAML: Select JSON Schema' },
  { id: 'gopls.import.add', command: 'go.import.add', tool: 'gopls', title: 'Go: Add Import', menu: true },
  { id: 'gopls.test.generate.function', command: 'go.test.generate.function', tool: 'gopls', title: 'Go: Generate Unit Tests For Function', menu: true },
  { id: 'gopls.add.tags', command: 'go.add.tags', tool: 'gopls', title: 'Go: Add Tags To Struct Fields', menu: true },
  { id: 'gopls.remove.tags', command: 'go.remove.tags', tool: 'gopls', title: 'Go: Remove Tags From Struct Fields' },
  { id: 'gopls.toggle.gc_details', command: 'go.toggle.gc_details', tool: 'gopls', title: 'Go: Toggle compiler optimization details' },
  { id: 'gopls.environment.choose', command: 'go.environment.choose', tool: 'gopls', title: 'Go: Choose Go Environment' },
];
/** The context key that is true while a document's tool belongs to the family. */
export const toolContextKey = (tool: ToolFamily): string => `setdownTool${tool.replace(/(^|-)(\w)/g, (_match, _dash, letter: string) => letter.toUpperCase())}`;
