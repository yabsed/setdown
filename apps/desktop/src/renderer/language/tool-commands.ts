import type * as L from 'vscode-languageserver-protocol';
import type { LanguageAnswer, LanguageMethod } from '../../protocol/language';
import type { ToolFamily } from '../../protocol/language-tools';
import type { EnvironmentChoice, ToolEnvironment } from './document-support';
import type { LanguageInputSource } from './language-text';

// What each command of `tool-command-list.ts` does, and what the editor does for the commands a
// tool hands back to it (`protocol/language-tools.ts` `clientCommands`). Each is carried over
// from the tool's own extension, named beside it. A command sees only this context: it cannot
// name a document address or a server command, which the main process fills in.

export type ProgramRun = { cwd?: string; program: string; args: string[]; env?: Record<string, string> };
export type ToolCommandContext = {
  /** The cursor and the selections, in the protocol's terms, and the text of the cursor's line. */
  position: L.Position; selection: L.Range; selections: L.Range[]; line: string;
  /** The document's own address, for telling a location in it from one elsewhere. */
  uri: string;
  /** Null when the tool gave no answer: the document changed, the tool failed or the answer was
   * empty. With `strict` a refusal of the tool is thrown with its own words. */
  request<T>(method: LanguageMethod, params: object, strict?: boolean): Promise<T | null>;
  /** Text the tool made for reading opens as a read-only document beside the code. */
  showText(source: LanguageAnswer): Promise<void>;
  /** One place is opened; several are listed under the title. */
  showLocations(title: string, locations: (L.Location | L.LocationLink)[], empty: string): Promise<void>;
  open(uri: string, range?: L.Range): Promise<void>;
  ask(source: LanguageInputSource): Promise<string | undefined>;
  pick<T>(title: string, items: { label: string; detail: string; value: T }[]): Promise<T | undefined>;
  /** Text edits of this document. `snippet`: the tool marks where the cursor goes with `$0`. */
  edit(edits: L.TextEdit[], snippet?: boolean): void;
  workspaceEdit(edit: L.WorkspaceEdit): Promise<void>;
  select(selections: L.Range[]): void;
  /** Starts the program in a new terminal of the app. False when this window has no terminal. */
  run(program: ProgramRun): Promise<boolean>;
  copy(text: string): Promise<void>;
  link(href: string): Promise<void>;
  /** A short message at the cursor. */
  message(text: string): void;
  /** Opens the panel behind the language name on the page where a choice of the tool is made. */
  inspect(page: 'environment' | 'tool-environment', item?: string): void;
  /** How the document is indented, for a tool that writes text itself. */
  formatting: { tabSize: number; insertSpaces: boolean };
  /** One of the editor's own actions (`editor.action.rename`). */
  editorAction(id: string): Promise<void>;
  /** Types text as the keyboard would. */
  type(text: string): void;
};
export type ToolCommand = (c: ToolCommandContext) => Promise<void>;
export type ClientCommand = (c: ToolCommandContext, args: unknown[]) => Promise<void>;

const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const isPosition = (value: unknown): value is L.Position => { const at = object(value); return !!at && Number.isSafeInteger(at.line) && Number.isSafeInteger(at.character); };
const isRange = (value: unknown): value is L.Range => { const range = object(value); return !!range && isPosition(range.start) && isPosition(range.end); };
function locations(value: unknown): (L.Location | L.LocationLink)[] {
  return (Array.isArray(value) ? value : value ? [value] : []).filter((item): item is L.Location | L.LocationLink => {
    const place = object(item);
    return !!place && (typeof place.uri === 'string' && isRange(place.range) || typeof place.targetUri === 'string' && isRange(place.targetSelectionRange));
  }).slice(0, 2000);
}

// ---- rust-analyzer: vendor/rust-analyzer/editors/code/src/{commands,run,lsp_ext}.ts ----

/** `lsp_ext.ts` `Runnable`: a program rust-analyzer knows how to start: a binary, a test, a benchmark. */
export type Runnable = { label: string; program: ProgramRun; location?: L.LocationLink };
/** `run.ts` `createCargoArgs` and `createTaskFromRunnable`: cargo's own arguments, then after
 * `--` the program's. `overrideCargo` replaces `cargo`. A shell runnable names its program. */
export function runnable(value: unknown): Runnable | undefined {
  const item = object(value), args = object(item?.args);
  if (!item || !args || typeof item.label !== 'string') return undefined;
  const env = Object.fromEntries(Object.entries(object(args.environment) ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry[0])));
  const location = locations(item.location)[0];
  const common = { label: item.label.slice(0, 300), ...(location && 'targetUri' in location ? { location } : {}) };
  const cwd = typeof args.cwd === 'string' && args.cwd ? args.cwd : typeof args.workspaceRoot === 'string' ? args.workspaceRoot : undefined;
  if (item.kind === 'cargo') {
    const program = strings(args.executableArgs);
    return { ...common, program: { cwd, env, program: typeof args.overrideCargo === 'string' && args.overrideCargo ? args.overrideCargo : 'cargo',
      args: [...strings(args.cargoArgs), ...(program.length ? ['--', ...program] : [])] } };
  }
  if (item.kind === 'shell' && typeof args.program === 'string' && args.program) return { ...common, program: { cwd, env, program: args.program, args: strings(args.args) } };
  return undefined;
}
/** The command line a person would type for a program, for a POSIX shell or for cmd.exe. */
export function commandLine(run: ProgramRun, windows = false): string {
  const quote = (text: string) => windows ? (/^[A-Za-z0-9_\-.:\\/=@+,]+$/.test(text) ? text : `"${text.replace(/"/g, '""')}"`)
    : (/^[A-Za-z0-9_\-.:/=@%+,]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`);
  const env = Object.entries(run.env ?? {});
  const line = [run.program, ...run.args].map(quote).join(' ');
  if (!env.length) return line;
  return windows ? `${env.map(([name, value]) => `set "${name}=${value.replace(/"/g, '')}"`).join(' && ')} && ${line}` : `${env.map(([name, value]) => `${name}=${quote(value)}`).join(' ')} ${line}`;
}
/** `snippets.ts` `applySnippetTextEdits`: the tool marks where the cursor goes with `$0` and
 * escapes `$`, `}` and `\` in the rest. The text without the marks, and where the mark was. */
export function plainSnippet(text: string): { text: string; cursor?: number } {
  let plain = '', cursor: number | undefined;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '\\' && index + 1 < text.length && '$}\\'.includes(text[index + 1])) { plain += text[++index]; continue; }
    const mark = char === '$' ? /^\$(?:0|\{0(?::([^}]*))?\})/.exec(text.slice(index)) : null;
    if (mark) { cursor ??= plain.length; plain += mark[1] ?? ''; index += mark[0].length - 1; continue; }
    plain += char;
  }
  return { text: plain, cursor };
}
async function start(c: ToolCommandContext, program: ProgramRun | undefined): Promise<void> {
  if (!program) { c.message('The tool did not say how to run this.'); return; }
  if (!await c.run(program)) { await c.copy(commandLine(program)); c.message('Copied the command line: this window has no terminal.'); }
}
async function chooseRunnable(c: ToolCommandContext): Promise<Runnable | undefined> {
  // `run.ts` `getRunnables`: everything that can be started at the cursor; a cargo check of the whole crate comes last.
  const found = (await c.request<unknown[]>('experimental/runnables', { position: c.position }) ?? []).map(runnable).filter((item): item is Runnable => !!item);
  if (!found.length) { c.message('Nothing to run here.'); return undefined; }
  return c.pick('Select Runnable', found.map(item => ({ label: item.label, detail: commandLine(item.program), value: item })));
}
const rustText = (method: LanguageMethod, title: string, languageId: string | undefined, params: (c: ToolCommandContext) => object): ToolCommand => async c => {
  // A refusal is said in rust-analyzer's own words: a released build has no memory profiling, for one.
  const text = await c.request<string>(method, params(c), true);
  if (typeof text === 'string' && text.trim()) await c.showText({ title, text, languageId }); else c.message(`rust-analyzer returned nothing for ${title}.`);
};
const atCursor = (c: ToolCommandContext) => ({ position: c.position });
const moveItem = (direction: 'Up' | 'Down'): ToolCommand => async c => {
  const edits = await c.request<L.TextEdit[]>('experimental/moveItem', { range: c.selection, direction });
  if (edits?.length) c.edit(edits, true);
};
/** `commands.ts` `viewMemoryLayout` draws the nodes as nested boxes; here they are an indented
 * table with the same facts: name, type, size, alignment and offset. */
export function memoryLayout(value: unknown): string | undefined {
  const nodes = Array.isArray(object(value)?.nodes) ? (object(value)!.nodes as unknown[]).map(object).filter((node): node is Record<string, unknown> => !!node) : [];
  if (!nodes.length) return undefined;
  const lines: string[] = [];
  const visit = (index: number, depth: number) => {
    const node = nodes[index]; if (!node || depth > 32 || lines.length > 5000) return;
    lines.push(`${'  '.repeat(depth)}${String(node.itemName)}: ${String(node.typename)}  (size ${Number(node.size)}, align ${Number(node.alignment)}, offset ${Number(node.offset)})`);
    const start = Number(node.childrenStart), count = Number(node.childrenLen);
    if (Number.isSafeInteger(start) && Number.isSafeInteger(count) && start > index) for (let child = start; child < start + count; child++) visit(child, depth + 1);
  };
  visit(0, 0);
  return lines.join('\n');
}

// ---- clangd: vendor/vscode-clangd/src/{ast,memory-usage}.ts ----

/** `ast.ts` `describe`: for the common roles the kind says enough ("Call", not "Call expression"). */
export function astText(value: unknown): string | undefined {
  const lines: string[] = [];
  const visit = (node: Record<string, unknown> | undefined, depth: number) => {
    if (!node || typeof node.role !== 'string' || typeof node.kind !== 'string' || depth > 200 || lines.length > 20_000) return;
    const name = ['expression', 'statement', 'declaration', 'template name'].includes(node.role) ? node.kind : `${node.kind} ${node.role}`;
    const range = isRange(node.range) ? `  [${node.range.start.line + 1}:${node.range.start.character + 1}]` : '';
    lines.push(`${'  '.repeat(depth)}${name}${typeof node.detail === 'string' && node.detail ? ` ${node.detail}` : ''}${range}`);
    for (const child of Array.isArray(node.children) ? node.children : []) visit(object(child), depth + 1);
  };
  visit(object(value), 0);
  return lines.length ? lines.join('\n') : undefined;
}
/** `memory-usage.ts` `convert`: a tree whose every node has its own bytes (`_self`) and the bytes
 * of everything under it (`_total`); the largest come first. */
export function memoryText(value: unknown): string | undefined {
  const lines: string[] = [];
  const size = (bytes: number) => bytes >= 1 << 20 ? `${(bytes / (1 << 20)).toFixed(1)} MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
  const visit = (node: Record<string, unknown> | undefined, title: string, depth: number) => {
    if (!node || typeof node._total !== 'number' || depth > 32 || lines.length > 5000) return;
    lines.push(`${'  '.repeat(depth)}${title}  ${size(node._total)}${typeof node._self === 'number' && node._self !== node._total ? `  (self ${size(node._self)})` : ''}`);
    const children = Object.entries(node).filter((entry): entry is [string, Record<string, unknown>] => !!object(entry[1]) && typeof object(entry[1])!._total === 'number');
    for (const [name, child] of children.sort((a, b) => (b[1]._total as number) - (a[1]._total as number))) visit(child, name, depth + 1);
  };
  visit(object(value), 'clangd', 0);
  return lines.length ? lines.join('\n') : undefined;
}

// ---- Svelte: vendor/svelte-language-tools/packages/svelte-vscode/src/{extension,CompiledCodeContentProvider}.ts, typescript/ ----

const svelteReferences = (method: LanguageMethod, title: string): ToolCommand => async c => {
  await c.showLocations(title, locations(await c.request<unknown>(method, {})), 'No references found.');
};
const svelteCompiled = (part: 'js' | 'css', languageId: string): ToolCommand => async c => {
  const code = object(object(await c.request<unknown>('$/getCompiledCode', {}))?.[part])?.code;
  if (typeof code === 'string') await c.showText({ title: `Compiled ${part === 'js' ? 'code' : 'CSS'}`, text: code, languageId });
  else c.message('Svelte could not compile this file.');
};

export const toolCommands: Record<string, ToolCommand> = {
  'rust-analyzer.run': async c => { const chosen = await chooseRunnable(c); if (chosen) await start(c, chosen.program); },
  'rust-analyzer.copyRunCommandLine': async c => { const chosen = await chooseRunnable(c); if (chosen) { await c.copy(commandLine(chosen.program)); c.message('Copied the command line.'); } },
  // `commands.ts` `peekTests`: the tests that exercise the item at the cursor.
  'rust-analyzer.peekTests': async c => {
    const tests = await c.request<unknown[]>('rust-analyzer/relatedTests', atCursor(c)) ?? [];
    await c.showLocations('Related Tests', tests.flatMap(test => locations(object(object(test)?.runnable)?.location)), 'No related tests found.');
  },
  // `commands.ts` `expandMacro` `codeFormat`: the expansion under a heading that names the macro.
  'rust-analyzer.expandMacro': async c => {
    const expanded = object(await c.request<unknown>('rust-analyzer/expandMacro', atCursor(c)));
    if (typeof expanded?.expansion !== 'string') { c.message('Not available in this position.'); return; }
    const heading = `// Recursive expansion of ${String(expanded.name)} macro`;
    await c.showText({ title: 'Macro expansion', languageId: 'rust', text: `${heading}\n// ${'='.repeat(heading.length - 3)}\n\n${expanded.expansion}` });
  },
  'rust-analyzer.parentModule': async c => { await c.showLocations('Parent Modules', locations(await c.request<unknown>('experimental/parentModule', atCursor(c))), 'No parent module found.'); },
  'rust-analyzer.childModules': async c => { await c.showLocations('Child Modules', locations(await c.request<unknown>('experimental/childModules', atCursor(c))), 'No child modules found.'); },
  'rust-analyzer.openCargoToml': async c => { await c.showLocations('Cargo.toml', locations(await c.request<unknown>('experimental/openCargoToml', {})), 'No Cargo.toml found for this file.'); },
  // `commands.ts` `openDocs`: the documentation built on this computer when it exists, else the web page.
  'rust-analyzer.openDocs': async c => {
    const answer = await c.request<unknown>('experimental/externalDocs', atCursor(c));
    const links = typeof answer === 'string' ? { web: answer } : object(answer) ?? {};
    const target = [links.local, links.web].find((link): link is string => typeof link === 'string' && /^(https?|file):\/\//.test(link));
    if (target) await c.link(target); else c.message('No documentation found for this item.');
  },
  // `commands.ts` `matchingBrace`: each cursor moves to the brace that closes or opens its pair.
  'rust-analyzer.matchingBrace': async c => {
    const found = await c.request<unknown[]>('experimental/matchingBrace', { positions: c.selections.map(selection => selection.end) });
    if (!found || found.length !== c.selections.length || !found.every(isPosition)) return;
    c.select(c.selections.map((selection, index) => { const active = found[index] as L.Position, empty = selection.start.line === selection.end.line && selection.start.character === selection.end.character;
      return { start: empty ? active : selection.start, end: active }; }));
  },
  'rust-analyzer.joinLines': async c => { const edits = await c.request<L.TextEdit[]>('experimental/joinLines', { ranges: c.selections }); if (edits?.length) c.edit(edits); },
  'rust-analyzer.moveItemUp': moveItem('Up'),
  'rust-analyzer.moveItemDown': moveItem('Down'),
  // `commands.ts` `onEnter`: the tool continues a comment or indents inside braces; when it has
  // nothing to say, Enter is typed as always. The tool is asked only on a line where it can have
  // something to say (a comment, or just after an opening brace), and is given a quarter of a
  // second, so that typing never waits for it.
  'rust-analyzer.onEnter': async c => {
    const before = c.line.slice(0, c.position.character);
    const edits = !before.includes('//') && !before.trimEnd().endsWith('{') ? null
      : await Promise.race([c.request<L.TextEdit[]>('experimental/onEnter', atCursor(c)), new Promise<null>(resolve => setTimeout(() => resolve(null), 250))]);
    if (edits?.length) c.edit(edits, true); else c.type('\n');
  },
  // `commands.ts` `ssr`: the query is checked as it is typed (`parseOnly`), then applied everywhere.
  'rust-analyzer.ssr': async c => {
    const where = { position: c.position, selections: c.selections };
    const query = await c.ask({ title: 'Structural Search Replace', value: '() ==>> ()', prompt: 'Enter request, for example \'Foo($a) ==>> Foo::new($a)\'',
      validate: async value => { try { await c.request('experimental/ssr', { query: value, parseOnly: true, ...where }, true); return undefined; } catch (error) { return String(error instanceof Error ? error.message : error); } } });
    if (!query) return;
    const edit = await c.request<L.WorkspaceEdit>('experimental/ssr', { query, parseOnly: false, ...where });
    if (edit) await c.workspaceEdit(edit);
  },
  'rust-analyzer.reloadWorkspace': async c => { await c.request('rust-analyzer/reloadWorkspace', {}); },
  'rust-analyzer.rebuildProcMacros': async c => { await c.request('rust-analyzer/rebuildProcMacros', {}); },
  'rust-analyzer.runFlycheck': async c => { await c.request('rust-analyzer/runFlycheck', {}); },
  'rust-analyzer.cancelFlycheck': async c => { await c.request('rust-analyzer/cancelFlycheck', {}); },
  'rust-analyzer.clearFlycheck': async c => { await c.request('rust-analyzer/clearFlycheck', {}); },
  'rust-analyzer.analyzerStatus': rustText('rust-analyzer/analyzerStatus', 'rust-analyzer status', undefined, () => ({})),
  'rust-analyzer.memoryUsage': rustText('rust-analyzer/memoryUsage', 'Memory usage', undefined, () => ({})),
  // syntax_tree_provider.ts shows the tree as a view of nodes; here it is a document with one
  // node on a line, indented by depth, each with the lines and columns it covers in the source.
  'rust-analyzer.viewSyntaxTree': async c => {
    const text = syntaxTreeText(await c.request<string>('rust-analyzer/viewSyntaxTree', {}, true));
    if (text) await c.showText({ title: 'Syntax tree', text }); else c.message('rust-analyzer returned no syntax tree for this file.');
  },
  'rust-analyzer.viewHir': rustText('rust-analyzer/viewHir', 'HIR', 'rust', atCursor),
  'rust-analyzer.viewMir': rustText('rust-analyzer/viewMir', 'MIR', 'rust', atCursor),
  'rust-analyzer.interpretFunction': rustText('rust-analyzer/interpretFunction', 'Interpretation', undefined, atCursor),
  'rust-analyzer.viewFileText': rustText('rust-analyzer/viewFileText', 'File text as seen by the server', 'rust', () => ({})),
  'rust-analyzer.viewItemTree': rustText('rust-analyzer/viewItemTree', 'ItemTree', 'rust', () => ({})),
  'rust-analyzer.getFailedObligations': rustText('rust-analyzer/getFailedObligations', 'Failed obligations', undefined, atCursor),
  'rust-analyzer.viewCrateGraph': async c => { await crateGraph(c, false); },
  'rust-analyzer.viewFullCrateGraph': async c => { await crateGraph(c, true); },
  'rust-analyzer.viewMemoryLayout': async c => {
    const text = memoryLayout(await c.request<unknown>('rust-analyzer/viewRecursiveMemoryLayout', atCursor(c)));
    if (text) await c.showText({ title: 'Memory layout', text }); else c.message('No memory layout here: put the cursor on a type or a value.');
  },
  // `ast.ts`: the syntax tree of the selection, as clangd parsed it.
  'clangd.ast': async c => {
    const text = astText(await c.request<unknown>('textDocument/ast', { range: c.selection }));
    if (text) await c.showText({ title: 'AST', text }); else c.message('No AST node at selection');
  },
  'clangd.memoryUsage': async c => {
    const text = memoryText(await c.request<unknown>('$/memoryUsage', {}));
    if (text) await c.showText({ title: 'clangd memory usage', text }); else c.message('clangd did not report its memory usage.');
  },
  'svelte.showCompiledCodeToSide': svelteCompiled('js', 'javascript'),
  'svelte.showCompiledCSSToSide': svelteCompiled('css', 'css'),
  'svelte.typescript.findAllFileReferences': svelteReferences('$/getFileReferences', 'File References'),
  'svelte.typescript.findComponentReferences': svelteReferences('$/getComponentReferences', 'Component References'),
  'svelte.migrate_to_svelte_5': async c => { await c.request('workspace/executeCommand:migrate_to_svelte_5', {}); },
  // extension.ts `addExtracComponentCommand`: the selection becomes a new component with the name the person gives.
  'svelte.extractComponent': async c => {
    const filePath = await c.ask({ title: 'Extract Component', prompt: 'Component Name: ', placeholder: 'NewComponent' });
    if (filePath) await c.request('workspace/executeCommand:extract_to_svelte_component', { range: c.selection, filePath });
  },

  // ---- Java: vendor/vscode-java/src/{standardLanguageClient,buildpath}.ts ----
  // `java.projectConfiguration.update`: the project of this file is read again from its build file.
  'jdtls.projectConfiguration.update': async c => { await c.request('java/projectConfigurationUpdate', {}); c.message('Reloading the Java project…'); },
  'jdtls.project.import': async c => { await c.request('workspace/executeCommand:java.project.import', {}); },
  // `java.workspace.compile`: asks which kind when it is not said, then reports how the build ended.
  'jdtls.workspace.compile': async c => {
    const full = await c.pick('Force Java Compilation', [{ label: 'Incremental', detail: 'Build what changed', value: false }, { label: 'Full', detail: 'Clean and build everything', value: true }]);
    if (full === undefined) return;
    const result = await c.request<number>('java/buildWorkspace', { value: full }, true);
    c.message(javaBuildResult(result));
  },

  // ---- Kotlin: vendor/kotlin-lsp/vscode-extension-core/src/{extension,relatedTests,relatedTestsModel}.ts ----
  'kotlin.reloadWorkspace': async c => { if (await c.request('setdown/kotlin.reloadWorkspace', {}, true)) c.message('Workspace reloaded'); },
  'kotlin.goToTest': async c => {
    const answer = object(await c.request<unknown>('intellij/relatedTests', { position: c.position }));
    if (answer) await c.showLocations('Go to Test', locations(answer.targets), kotlinNoRelatedTests(answer.isTest === true, typeof answer.sourceName === 'string' ? answer.sourceName : undefined));
  },

  // ---- Intelephense: vendor/vscode-intelephense/src/extension.ts ----
  'intelephense.index.workspace': async c => { await c.request('setdown/intelephense.indexWorkspace', {}, true); },
  'intelephense.cancel.indexing': async c => { await c.request('cancelIndexing', {}); },
  // `enterLicenceKey`: an empty answer removes the key. The main process checks its form and keeps it.
  'intelephense.enter.key': async c => {
    const key = await c.ask({ title: 'Intelephense Licence Key', prompt: 'A 15 character key; leave it empty to remove the key.', placeholder: 'Licence key',
      validate: async text => !text.trim() || /^[0-9a-zA-Z]{15}$/.test(text.trim()) ? undefined : 'A licence key must be a 15 character alphanumeric string.' });
    if (key !== undefined) await c.request('setdown/intelephense.licenceKey', { key }, true);
  },

  // ---- JSON: vendor/vscode/extensions/json-language-features/client/src/jsonClient.ts `json.sort` ----
  'json.sort': async c => {
    const edits = await c.request<L.TextEdit[]>('json/sort', { options: { ...c.formatting, trimTrailingWhitespace: false, trimFinalNewlines: false, insertFinalNewline: false } });
    if (Array.isArray(edits) && edits.length) c.edit(edits.filter(edit => isRange(edit?.range) && typeof edit.newText === 'string'));
    else if (!Array.isArray(edits)) c.message('Failed to sort the JSONC document, please consider opening an issue.');
  },

  // ---- YAML: vendor/vscode-yaml/src/schema-status-bar-item.ts `showSchemaSelection` ----
  // The schema is chosen behind the language name, where every such choice is made (`yamlEnvironment`).
  'yaml.select.json.schema': async c => { c.inspect('tool-environment', 'yaml-schema'); },

  // ---- Go: vendor/vscode-go/extension/src/{goImport,goGenerateTests,goModifytags,goEnvironmentStatus}.ts, commands/toggleGCDetails.ts ----
  // goImport.ts `addImport`: the packages gopls knows and the file does not import yet; gopls adds the picked one.
  'gopls.import.add': async c => {
    const packages = strings(object(await c.request<unknown>('workspace/executeCommand:gopls.list_known_packages', {}, true))?.Packages).filter(name => name && name.length <= 1024).slice(0, 50_000);
    if (!packages.length) { c.message('No package to import was found.'); return; }
    const importPath = await c.pick('Go: Add Import', packages.map(name => ({ label: name, detail: '', value: name })));
    if (importPath) await c.request('workspace/executeCommand:gopls.add_import', { importPath }, true);
  },
  // goGenerateTests.ts `goplsGenerateTest`: gopls writes a test for the function at the selection into the package's test file.
  'gopls.test.generate.function': async c => { await c.request('workspace/executeCommand:gopls.add_test', { range: c.selection }, true); },
  'gopls.add.tags': goTags('add'),
  'gopls.remove.tags': goTags('remove'),
  'gopls.toggle.gc_details': async c => { await c.request('workspace/executeCommand:gopls.gc_details', {}, true); },
  // goEnvironmentStatus.ts `chooseGoEnvironment`: the Go in use, the ones on this computer, and the releases that can be downloaded.
  'gopls.environment.choose': async c => { c.inspect('tool-environment', 'go'); },
};
/** goModifytags.ts: the tags are the ones `go.addTags` or `go.removeTags` name. Where they name
 * none, gopls would ask through a form of its own; here the person types them. */
function goTags(modification: 'add' | 'remove'): ToolCommand {
  return async c => {
    const send = (tags?: string) => c.request<unknown>('setdown/go.modifyTags', { modification, range: c.selection, ...(tags === undefined ? {} : { tags }) }, true);
    const answer = object(await send());
    if (typeof answer?.ask !== 'string') return;
    const tags = await c.ask({ title: modification === 'add' ? 'Add Tags To Struct Fields' : 'Remove Tags From Struct Fields', prompt: answer.ask.slice(0, 300), placeholder: 'json',
      validate: async text => /^[\w,\- ]{1,200}$/.test(text.trim()) ? undefined : 'Tag names separated by commas, for example json,xml' });
    if (tags?.trim()) await send(tags.trim());
  };
}
/** What `setdown/go.versions` answers, as the rows of the extension's list: "Clear selection"
 * while a Go is chosen, then the Go versions found on this computer, then the downloadable ones. */
export type GoVersionChoice = { clear: true } | { program: string } | { version: string };
export function goVersionItems(answer: unknown): { refusal?: string; current?: string; items: { label: string; detail: string; value: GoVersionChoice }[] } {
  const list = object(answer), rows = (value: unknown) => (Array.isArray(value) ? value : []).map(object).filter((row): row is Record<string, unknown> => !!row && typeof row.label === 'string').slice(0, 200);
  const current = typeof list?.current === 'string' ? list.current.slice(0, 100) : undefined;
  // A refusal still names the Go in use: that is what the row behind the language name shows.
  if (typeof list?.refusal === 'string') return { refusal: list.refusal.slice(0, 500), ...(current ? { current } : {}), items: [] };
  return { current, items: [
    ...(list?.chosen === true ? [{ label: 'Clear selection', detail: 'Use the Go of the environment', value: { clear: true as const } }] : []),
    ...rows(list?.local).flatMap(row => typeof row.program === 'string' ? [{ label: String(row.label).slice(0, 100), detail: `Locally discovered: ${row.program}`.slice(0, 300), value: { program: row.program } }] : []),
    ...rows(list?.downloadable).flatMap(row => typeof row.version === 'string' ? [{ label: String(row.label).slice(0, 100), detail: 'Downloadable', value: { version: row.version } }] : []),
  ] };
}
/** The choices a tool keeps itself, as rows behind the language name. They are known from the
 * tool alone, without asking it; the tool is asked when a row is shown. */
export const toolEnvironmentRows: Partial<Record<ToolFamily, { id: string; label: string }>> = {
  gopls: { id: 'go', label: 'Go' }, yaml: { id: 'yaml-schema', label: 'Schema' } };
/** goEnvironmentStatus.ts `chooseGoEnvironment`, in the one form every environment choice has:
 * the Go in use first, the Go of the environment marked as the one in effect without a choice. */
export function goEnvironment(answer: unknown): ToolEnvironment {
  const list = goVersionItems(answer);
  const base = { id: 'go', label: 'Go', value: list.current ?? 'Not found' };
  if (list.refusal) return { ...base, choices: [], refusal: list.refusal };
  const chosen = object(answer)?.chosen === true;
  const choices: EnvironmentChoice[] = list.items.map(item => 'clear' in item.value
    ? { id: JSON.stringify(item.value), name: 'Automatic', detail: 'The Go of this environment', recommended: true }
    : { id: JSON.stringify(item.value), name: item.label, detail: 'program' in item.value ? item.value.program : 'Download', current: item.label === list.current });
  // Without a choice the Go in use is the environment's own.
  const current = choices.find(choice => choice.current);
  if (current && !chosen) current.recommended = true;
  return { ...base, choices: [...choices.filter(choice => choice.current), ...choices.filter(choice => !choice.current)],
    note: 'A downloaded release is installed with the Go in use. gopls starts again with the Go you choose.' };
}
/** The answer to a choice of `goEnvironment`. */
export function goChoice(id: string): GoVersionChoice | undefined {
  try { const value = object(JSON.parse(id)); return value?.clear === true ? { clear: true } : typeof value?.program === 'string' ? { program: value.program } : typeof value?.version === 'string' ? { version: value.version } : undefined; }
  catch { return undefined; }
}
/** schema-status-bar-item.ts `showSchemaSelection`, in that same form: the schemas this file is
 * checked against first. The empty id is "no schema". */
export function yamlEnvironment(answer: unknown): ToolEnvironment {
  const used = new Set((Array.isArray(answer) ? answer : []).flatMap(item => object(item)?.usedForCurrentFile === true && typeof object(item)!.uri === 'string' ? [object(item)!.uri as string] : []));
  const rows = yamlSchemaItems(answer).map(item => ({ id: item.value, name: item.label, detail: item.detail.replace(/^Used for this file\. /, ''), current: used.has(item.value) }));
  const current = rows.filter(row => row.current);
  return { id: 'yaml-schema', label: 'Schema', value: current.length ? current.map(row => row.name).join(', ').slice(0, 120) : 'None',
    choices: [...current, { id: '', name: 'No schema', detail: 'This file is checked against no schema', current: !current.length }, ...rows.filter(row => !row.current)] };
}
/** syntax_tree_provider.ts: rust-analyzer answers with the tree as JSON, every element a node or
 * a token with where it starts and ends (`[offset, line, column]`, counted from zero). */
export function syntaxTreeText(answer: unknown): string | undefined {
  let root: unknown;
  try { root = typeof answer === 'string' ? JSON.parse(answer) : answer; } catch { return undefined; }
  const lines: string[] = [];
  const at = (value: unknown) => Array.isArray(value) && value.length >= 3 && value.every(part => Number.isSafeInteger(part)) ? `${(value[1] as number) + 1}:${(value[2] as number) + 1}` : '?';
  const visit = (value: unknown, depth: number) => {
    const element = object(value);
    if (!element || typeof element.kind !== 'string' || depth > 400 || lines.length >= 200_000) return;
    lines.push(`${'  '.repeat(depth)}${element.kind}  ${at(element.start)}-${at(element.end)}`);
    for (const child of Array.isArray(element.children) ? element.children : []) visit(child, depth + 1);
  };
  visit(root, 0);
  return lines.length ? lines.join('\n') : undefined;
}
/** `relatedTestsModel.ts` `noResultsMessage`. */
export function kotlinNoRelatedTests(isTest: boolean, sourceName?: string): string {
  const what = isTest ? 'No test subjects found' : 'No tests found';
  return sourceName === undefined ? what : `${what} for ${sourceName}`.slice(0, 300);
}
/** `standardLanguageClient.ts` `java.workspace.compile`: `CompileWorkspaceStatus` in words. */
export function javaBuildResult(status: unknown): string {
  return status === 1 ? 'Compilation finished.' : status === 2 ? 'Compilation finished with errors.' : status === 3 ? 'Compilation was cancelled.' : 'Compilation failed.';
}
/** `schema-status-bar-item.ts`: every schema the YAML server knows as a row, the file's own first and marked. */
export function yamlSchemaItems(answer: unknown): { label: string; detail: string; value: string }[] {
  return (Array.isArray(answer) ? answer : []).flatMap(item => {
    const schema = object(item);
    if (!schema || typeof schema.uri !== 'string' || !schema.uri) return [];
    const name = typeof schema.name === 'string' && schema.name ? schema.name : schema.uri;
    const detail = typeof schema.description === 'string' && schema.description ? schema.description : schema.uri;
    return [{ label: name.slice(0, 200), detail: `${schema.usedForCurrentFile === true ? 'Used for this file. ' : ''}${detail}`.slice(0, 300), value: schema.uri }];
  }).slice(0, 2000);
}
/** `commands.ts` `viewCrateGraph`: rust-analyzer draws the graph with Graphviz and answers with an SVG. */
async function crateGraph(c: ToolCommandContext, full: boolean): Promise<void> {
  const svg = await c.request<string>('rust-analyzer/viewCrateGraph', { full });
  if (typeof svg === 'string' && svg.includes('<svg')) await c.showText({ title: full ? 'Crate graph (full)' : 'Crate graph', text: svg, image: true });
  else c.message('rust-analyzer could not draw the crate graph. It needs Graphviz (`dot`) installed.');
}

/** What the editor does for a command a tool hands back to it. `commands.ts`: `runSingle`,
 * `showReferences`, `gotoLocation`, `triggerParameterHints`, `rename`. */
export const clientCommandHandlers: Partial<Record<ToolFamily, Record<string, ClientCommand>>> = {
  'rust-analyzer': {
    'rust-analyzer.runSingle': async (c, args) => { await start(c, runnable(args[0])?.program); },
    'rust-analyzer.showReferences': async (c, args) => { await c.showLocations('References', locations(args[2]), 'No references found.'); },
    // The range is collapsed to where it starts, as there.
    'rust-analyzer.gotoLocation': async (c, args) => {
      const place = locations(args[0])[0]; if (!place) return;
      const start = 'targetUri' in place ? place.targetSelectionRange.start : place.range.start;
      await c.open('targetUri' in place ? place.targetUri : place.uri, { start, end: start });
    },
    'rust-analyzer.triggerParameterHints': async c => { await c.editorAction('editor.action.triggerParameterHints'); },
    'rust-analyzer.rename': async c => { await c.editorAction('editor.action.rename'); },
  },
  // gopls' "run test" and "run benchmark" lenses. vscode-go runs the test itself (goTest.ts); here
  // it runs in the terminal, with the `go test` line the main process makes from the lens and the
  // `go.test*` settings (`go-gopls-rules.ts` `goTestCommand`). The test runs the file as it is saved.
  gopls: {
    'gopls.run_tests': async (c, args) => {
      const test = object(await c.request<unknown>('setdown/go.testCommand', { arguments: args }, true));
      const env = Object.fromEntries(Object.entries(object(test?.env) ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry[0])));
      await start(c, test && typeof test.program === 'string' && typeof test.cwd === 'string' ? { cwd: test.cwd, program: test.program, args: strings(test.args), env } : undefined);
    },
  },
};
