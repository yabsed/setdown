import type { ToolFamily } from '../../protocol/language-tools';

// The commands each tool's own extension adds to the editor, by the name the extension gives
// them. Only what is listed here is offered, while the document's tool is the one the command
// belongs to. This file is plain data so that the editor can register the commands without
// loading language support; what each one does is in `tool-commands.ts`.
//   vendor/rust-analyzer/editors/code/package.json `contributes.commands`, `keybindings`
//   vendor/vscode-clangd/package.json
//   vendor/svelte-language-tools/packages/svelte-vscode/package.json
//   vendor/vscode-java/package.json (titles in package.nls.json)
//   vendor/kotlin-lsp/kotlin-vscode/package.json
//   vendor/vscode-intelephense/package.json
//   vendor/vscode/extensions/json-language-features/package.json (titles in package.nls.json)
//   vendor/vscode-yaml/src/schema-status-bar-item.ts (`yaml.select.json.schema`, registered in code)
//   vendor/vscode-go/extension/package.json
//
// An extension puts all of its commands into one list. Here every command has one place, chosen
// by the question it answers (docs/language-support.md, "Where a command lives"):
//   here         what can be done with the thing under the cursor. The menu at the cursor offers
//                it only where the tool said it applies (`here-menu.ts`); never by a fixed line.
//   document     what can be done with this file as a whole. Listed under "Here" in the command
//                list while the list is empty.
//   project      what is done to the project or the tool: reload, rebuild, check, a status
//                report. Lives behind the language name in the location bar, on the tool's page.
//   environment  a choice of what the analysis is based on. A row behind the language name.
//   settings     a setting of the tool. On the tool's page.
//   typed        the tool's inner views and file-wide transformations. Found by typing its name.
//   key          an editing behaviour of a key. Not a command a person looks for: never listed.
// Every place but `key` is found by typing the name in the command list, under the name its
// extension gives it: that is the name a person who used the extension knows.
export type ToolCommandPlace = 'here' | 'document' | 'project' | 'environment' | 'settings' | 'typed' | 'key';

/** `key`: the extension's own key for the command, in the names this file gives them.
 * `command`: the extension's name for the command where it does not start with the tool's name here.
 * `short`: what the command is called on the tool's own page, where the tool's name is the heading. */
export type ToolCommandInfo = { id: string; tool: ToolFamily; title: string; place: ToolCommandPlace; short?: string; command?: string; key?: 'ctrl-shift-u' | 'ctrl-shift-j' | 'enter' };

type More = Partial<Pick<ToolCommandInfo, 'short' | 'key'>>;
const rust = (id: string, title: string, place: ToolCommandPlace, more: More = {}): ToolCommandInfo => ({ id: `rust-analyzer.${id}`, tool: 'rust-analyzer', title: `rust-analyzer: ${title}`, place, ...more });
const clangd = (id: string, title: string, place: ToolCommandPlace): ToolCommandInfo => ({ id: `clangd.${id}`, tool: 'clangd', title: `clangd: ${title}`, place });
const svelte = (id: string, title: string, place: ToolCommandPlace): ToolCommandInfo => ({ id: `svelte.${id}`, tool: 'svelte', title: `Svelte: ${title}`, place });

export const toolCommandList: readonly ToolCommandInfo[] = [
  rust('run', 'Run', 'here'),
  rust('copyRunCommandLine', 'Copy Run Command Line', 'typed'),
  rust('peekTests', 'Peek Related Tests', 'here'),
  rust('expandMacro', 'Expand macro recursively at caret', 'here'),
  rust('parentModule', 'Locate parent module', 'typed', { key: 'ctrl-shift-u' }),
  rust('childModules', 'Locate child modules', 'typed'),
  rust('openCargoToml', 'Open Cargo.toml', 'project', { short: 'Open Cargo.toml' }),
  rust('openDocs', 'Open Docs', 'here'),
  rust('matchingBrace', 'Find matching brace', 'typed'),
  rust('joinLines', 'Join lines', 'typed', { key: 'ctrl-shift-j' }),
  rust('moveItemUp', 'Move Item Up', 'here'),
  rust('moveItemDown', 'Move Item Down', 'here'),
  rust('onEnter', 'Enhanced enter key', 'key', { key: 'enter' }),
  rust('ssr', 'Structural Search Replace', 'typed'),
  rust('reloadWorkspace', 'Reload workspace', 'project', { short: 'Reload project' }),
  rust('rebuildProcMacros', 'Rebuild proc macros and build scripts', 'project', { short: 'Rebuild macros and build scripts' }),
  rust('runFlycheck', 'Run flycheck', 'project', { short: 'Check now' }),
  rust('cancelFlycheck', 'Cancel running flychecks', 'project', { short: 'Cancel check' }),
  rust('clearFlycheck', 'Clear flycheck diagnostics', 'project', { short: 'Clear check results' }),
  rust('analyzerStatus', 'Status', 'project', { short: 'Status report' }),
  rust('memoryUsage', 'Memory Usage (Clears Database)', 'typed'),
  rust('viewSyntaxTree', 'Show Syntax Tree', 'typed'),
  rust('viewHir', 'View Hir', 'typed'),
  rust('viewMir', 'View Mir', 'typed'),
  rust('interpretFunction', 'Interpret', 'typed'),
  // What the tool is really reading is a question of trust, so it sits with the tool's reports.
  rust('viewFileText', 'View File Text (as seen by the server)', 'project', { short: 'Text as the tool sees it' }),
  rust('viewItemTree', 'Debug ItemTree', 'typed'),
  rust('viewCrateGraph', 'View Crate Graph', 'typed'),
  rust('viewFullCrateGraph', 'View Crate Graph (Full)', 'typed'),
  rust('viewMemoryLayout', 'View Memory Layout', 'typed'),
  rust('getFailedObligations', 'Get Failed Obligations', 'typed'),
  clangd('ast', 'Show AST', 'typed'),
  clangd('memoryUsage', 'Show memory usage', 'typed'),
  svelte('showCompiledCodeToSide', 'Show Compiled Code', 'typed'),
  svelte('showCompiledCSSToSide', 'Show Compiled CSS', 'typed'),
  svelte('extractComponent', 'Extract Component', 'here'),
  svelte('typescript.findAllFileReferences', 'Find File References', 'document'),
  svelte('typescript.findComponentReferences', 'Find Component References', 'document'),
  svelte('migrate_to_svelte_5', 'Migrate Component to Svelte 5 Syntax', 'typed'),
  { id: 'jdtls.projectConfiguration.update', command: 'java.projectConfiguration.update', tool: 'jdtls', title: 'Java: Reload Projects', place: 'project', short: 'Reload project' },
  { id: 'jdtls.project.import', command: 'java.project.import.command', tool: 'jdtls', title: 'Java: Import Java Projects into Workspace', place: 'project', short: 'Import Java projects' },
  { id: 'jdtls.workspace.compile', command: 'java.workspace.compile', tool: 'jdtls', title: 'Java: Force Java Compilation', place: 'project', short: 'Compile now…' },
  { id: 'kotlin.reloadWorkspace', command: 'jetbrains.kotlin.reloadWorkspace', tool: 'kotlin', title: 'Kotlin: Reload Workspace', place: 'project', short: 'Reload project' },
  { id: 'kotlin.goToTest', command: 'jetbrains.editor.goToTest', tool: 'kotlin', title: 'Kotlin: Go to Test or Test Subject', place: 'here' },
  { id: 'intelephense.index.workspace', tool: 'intelephense', title: 'Intelephense: Index workspace', place: 'project', short: 'Index project again' },
  { id: 'intelephense.cancel.indexing', tool: 'intelephense', title: 'Intelephense: Cancel indexing', place: 'project', short: 'Cancel indexing' },
  { id: 'intelephense.enter.key', tool: 'intelephense', title: 'Intelephense: Enter licence key', place: 'settings', short: 'Enter licence key…' },
  { id: 'json.sort', tool: 'json', title: 'JSON: Sort Document', place: 'typed' },
  { id: 'yaml.select.json.schema', tool: 'yaml', title: 'YAML: Select JSON Schema', place: 'environment' },
  { id: 'gopls.import.add', command: 'go.import.add', tool: 'gopls', title: 'Go: Add Import', place: 'document' },
  // gopls offers the next three itself where they apply, as actions at the cursor; the menu there
  // shows those. The extension's names stay for a person who types them.
  { id: 'gopls.test.generate.function', command: 'go.test.generate.function', tool: 'gopls', title: 'Go: Generate Unit Tests For Function', place: 'typed' },
  { id: 'gopls.add.tags', command: 'go.add.tags', tool: 'gopls', title: 'Go: Add Tags To Struct Fields', place: 'typed' },
  { id: 'gopls.remove.tags', command: 'go.remove.tags', tool: 'gopls', title: 'Go: Remove Tags From Struct Fields', place: 'typed' },
  { id: 'gopls.toggle.gc_details', command: 'go.toggle.gc_details', tool: 'gopls', title: 'Go: Toggle compiler optimization details', place: 'typed' },
  { id: 'gopls.environment.choose', command: 'go.environment.choose', tool: 'gopls', title: 'Go: Choose Go Environment', place: 'environment' },
];
/** The context key that is true while a document's tool belongs to the family. */
export const toolContextKey = (tool: ToolFamily): string => `setdownTool${tool.replace(/(^|-)(\w)/g, (_match, _dash, letter: string) => letter.toUpperCase())}`;
/** The Monaco action a command of the list is registered as. */
export const toolActionId = (id: string): string => `setdown.tool.${id}`;
/** The commands that concern the document as a whole. While the command list is empty they are
 * listed under "Here", each only while the editor offers it for the document. */
export const documentCommandIds: readonly string[] = ['editor.action.formatDocument', 'editor.action.quickOutline', 'setdown.language-problems', 'setdown.language-symbols',
  'setdown.language-companion', 'setdown.python-cells', 'setdown.language-support', ...toolCommandList.filter(command => command.place === 'document').map(command => toolActionId(command.id))];
/** What a tool's command for the document is called while the command list is empty. The file says
 * which tool it is, so the name stands without the tool's ("Add Import", not "Go: Add Import");
 * typed, the command is found under the name its extension gives it. */
export const documentCommandNames: Readonly<Record<string, string>> = Object.fromEntries(toolCommandList.filter(command => command.place === 'document')
  .map(command => [toolActionId(command.id), command.short ?? command.title.slice(command.title.indexOf(': ') + 2)]));
/** Behaviours of a key: registered so the key works, and listed nowhere. */
export const unlistedCommandIds: readonly string[] = toolCommandList.filter(command => command.place === 'key').map(command => toolActionId(command.id));
