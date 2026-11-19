import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { builtinLanguageServers } from './catalog/profiles';
import { serverProfile } from './server-definitions';
import { answersRequest, autoInsertion, InactiveRegions, inactiveRegionMessage, inactiveRegionsMethod, isClangd, isHtmlServer, isRustAnalyzer, isSvelteServer, isTypeScriptServer, packageFolder,
  reportsInactiveRegions, restartsTool, serverStatusMethod, setting, statusMeaning, svelteConfigurationSections,
  svelteOptions, sveltePlugin, svelteRestartFiles, svelteScriptChanged, svelteScriptLanguages, toolCapabilities, toolStatus, tsserverMemory, typescriptOptions } from './extension-rules';
import { clientCapabilities } from '../../protocol/language-features';

const vendor = path.resolve(__dirname, '../../../../../vendor');
const source = (file: string) => readFileSync(path.join(vendor, file), 'utf8');
const tool = (id: string) => builtinLanguageServers.find(definition => definition.id === id)!;
const temporary: string[] = [];
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const folder = () => { const directory = mkdtempSync(path.join(os.tmpdir(), 'setdown-rules-')); temporary.push(directory); return directory; };

test('a setting is found however a person wrote its name', () => {
  expect(setting({ html: { autoClosingTags: false } }, 'html.autoClosingTags')).toBe(false);
  expect(setting({ 'html.autoClosingTags': false }, 'html.autoClosingTags')).toBe(false);
  expect(setting({ 'typescript.tsserver': { maxTsServerMemory: 512 } }, 'typescript.tsserver.maxTsServerMemory')).toBe(512);
  expect(setting({ typescript: { tsserver: {} } }, 'typescript.tsserver.maxTsServerMemory')).toBeUndefined();
  expect(setting(undefined, 'html.autoClosingTags')).toBeUndefined();
});

test('each tool is recognised by its id, its catalog name and its program, and by nothing else', () => {
  expect(isHtmlServer(tool('html-lsp'))).toBe(true); expect(isHtmlServer(tool('superhtml'))).toBe(false);
  expect(isSvelteServer(tool('svelte-language-server'))).toBe(true); expect(isTypeScriptServer(tool('typescript-language-server'))).toBe(true);
  expect(isTypeScriptServer(tool('vtsls'))).toBe(false); expect(isClangd(tool('clangd'))).toBe(true);
  expect(isHtmlServer({ id: 'mine', launch: { kind: 'native', command: '/opt/bin/vscode-html-language-server', args: [] } })).toBe(true);
});

test('HTML closes tags and writes attribute quotes unless the person turned either off; Svelte closes tags only', () => {
  expect(autoInsertion(tool('html-lsp'), tool('html-lsp').settings)).toEqual({ method: 'html/autoInsert', close: true, quote: true });
  expect(autoInsertion(tool('html-lsp'), { html: { autoClosingTags: false } })).toEqual({ method: 'html/autoInsert', close: false, quote: true });
  expect(autoInsertion(tool('html-lsp'), { 'html.autoCreateQuotes': false })).toEqual({ method: 'html/autoInsert', close: true, quote: false });
  expect(autoInsertion(tool('svelte-language-server'), {})).toEqual({ method: 'html/tag', close: true, quote: false });
  expect(autoInsertion(tool('svelte-language-server'), { html: { autoClosingTags: false } })).toEqual({ method: 'html/tag', close: false, quote: false });
  expect(autoInsertion(tool('css-lsp'), {})).toBeUndefined();
});

test('the requests and both settings are the ones the HTML and Svelte extensions use', () => {
  const html = source('vscode/extensions/html-language-features/client/src/htmlClient.ts');
  const insertion = source('vscode/extensions/html-language-features/client/src/autoInsertion.ts');
  expect(html).toContain("new RequestType('html/autoInsert')");
  expect(insertion).toContain("configurations.get<boolean>('html.autoCreateQuotes')");
  expect(insertion).toContain("configurations.get<boolean>('html.autoClosingTags')");
  const manifest = JSON.parse(source('vscode/extensions/html-language-features/package.json')).contributes.configuration.properties;
  expect([manifest['html.autoClosingTags'].default, manifest['html.autoCreateQuotes'].default]).toEqual([true, true]);
  const svelte = source('svelte-language-tools/packages/svelte-vscode/src/extension.ts');
  expect(svelte).toMatch(/new RequestType\(\s*'html\/tag'\s*\)/);
  expect(svelte).toContain("'html.autoClosingTags'");
});

test('a request outside the protocol is refused for every tool but its own', () => {
  expect(answersRequest(tool('html-lsp'), 'html/autoInsert')).toBe(true);
  expect(answersRequest(tool('svelte-language-server'), 'html/autoInsert')).toBe(false);
  expect(answersRequest(tool('svelte-language-server'), 'html/tag')).toBe(true);
  expect(answersRequest(tool('clangd'), 'textDocument/switchSourceHeader')).toBe(true);
  expect(answersRequest(tool('rust-analyzer'), 'textDocument/switchSourceHeader')).toBe(false);
  expect(answersRequest(undefined, 'html/tag')).toBe(false);
  expect(answersRequest(undefined, 'textDocument/hover')).toBe(true);
  expect(source('vscode-clangd/src/switch-source-header.ts')).toContain("'textDocument/switchSourceHeader'");
});

test('the Svelte tool starts with the options its extension sends', () => {
  const written = tool('svelte-language-server').initializationOptions;
  const options = svelteOptions({ svelte: { plugin: { css: { enable: false } } }, html: { autoClosingTags: false }, unrelated: { a: 1 } }, written);
  expect(options.dontFilterIncompleteCompletions).toBe(true);
  expect(options.isTrusted).toBe(true);
  expect(options.configuration).toMatchObject({ svelte: { plugin: { css: { enable: false } } }, html: { autoClosingTags: false },
    typescript: (written!.configuration as Record<string, unknown>).typescript });
  expect(options.configuration).not.toHaveProperty('unrelated');
  // What a person wrote in the options themselves is kept.
  expect(svelteOptions({}, { isTrusted: false, configuration: { svelte: { a: 1 } } })).toMatchObject({ isTrusted: false, configuration: { svelte: { a: 1 } } });
  expect(serverProfile(tool('svelte-language-server')).initializationOptions).toMatchObject({ isTrusted: true, dontFilterIncompleteCompletions: true });
});

test('the Svelte options, sections, restart files and script languages are the extension\'s', () => {
  const extension = source('svelte-language-tools/packages/svelte-vscode/src/extension.ts');
  expect(extension).toContain('dontFilterIncompleteCompletions: true');
  expect(extension).toContain('isTrusted: workspace.isTrusted');
  const sections = /configurationSection: \[([^\]]+)\]/.exec(extension)![1].match(/'[^']+'/g)!.map(name => name.slice(1, -1));
  expect([...svelteConfigurationSections].sort()).toEqual(sections.sort());
  const saved = extension.slice(extension.indexOf('workspace.onDidSaveTextDocument'), extension.indexOf('let restartingLs'));
  const patterns = saved.split('\n').map(line => line.trim()).filter(line => line.startsWith('/^')).map(line => line.replace(/,$/, ''));
  expect(svelteRestartFiles.map(String)).toEqual(patterns);
  expect(extension).toContain(`sendNotification('${svelteScriptChanged}'`);
  expect(extension).toContain(`evt.document.languageId === '${svelteScriptLanguages[0]}' || evt.document.languageId === '${svelteScriptLanguages[1]}'`);
});

test('only the Svelte tool starts again, and only for the files it read at startup', () => {
  const svelte = tool('svelte-language-server');
  for (const name of ['svelte.config.js', 'svelte.config.ts', 'vite.config.mts', '.prettierrc', '.prettierrc.yaml', '.prettierrc.cjs', 'prettier.config.js'])
    expect(restartsTool(svelte, `/project/${name}`), name).toBe(true);
  for (const name of ['tsconfig.json', 'jsconfig.json', 'package.json', 'svelte.config.json', 'vite.config.json', 'App.svelte'])
    expect(restartsTool(svelte, `/project/${name}`), name).toBe(false);
  expect(restartsTool(tool('typescript-language-server'), '/project/svelte.config.js')).toBe(false);
});

test('tsserver gets the memory limit of the TypeScript extension and downloads no types unless asked', () => {
  expect(typescriptOptions({}, {})).toEqual({ maxTsServerMemory: 3072, disableAutomaticTypingAcquisition: true });
  expect(typescriptOptions({ typescript: { tsserver: { maxTsServerMemory: 16 } } }, {}).maxTsServerMemory).toBe(128);
  expect(typescriptOptions({ 'typescript.tsserver.maxTsServerMemory': 8192 }, {}).maxTsServerMemory).toBe(8192);
  expect(typescriptOptions({ typescript: { tsserver: { maxTsServerMemory: 1.5 } } }, {}).maxTsServerMemory).toBe(3072);
  expect(typescriptOptions({ typescript: { disableAutomaticTypeAcquisition: false, npm: '/usr/bin/npm', locale: 'ko' } }, {}))
    .toEqual({ maxTsServerMemory: 3072, disableAutomaticTypingAcquisition: false, npmLocation: '/usr/bin/npm', locale: 'ko' });
  expect(typescriptOptions({ typescript: { locale: 'auto' } }, {})).not.toHaveProperty('locale');
  // The options a person wrote for the tool win over the settings.
  expect(typescriptOptions({}, { maxTsServerMemory: 1024, hostInfo: 'setdown' })).toMatchObject({ maxTsServerMemory: 1024, hostInfo: 'setdown' });
  const profile = serverProfile(tool('typescript-language-server')).initializationOptions!;
  expect(profile).toMatchObject({ maxTsServerMemory: 3072, disableAutomaticTypingAcquisition: true, hostInfo: 'setdown' });
  expect((profile.tsserver as { path: string }).path).toMatch(/typescript[\\/]lib[\\/]tsserver\.js$/);
});

test('the memory limit and the setting names are the TypeScript extension\'s', () => {
  const configuration = source('vscode/extensions/typescript-language-features/src/configuration/configuration.ts');
  expect(configuration).toContain(`const defaultMaxMemory = ${tsserverMemory.default};`);
  expect(configuration).toContain(`const minimumMaxMemory = ${tsserverMemory.minimum};`);
  expect(configuration).toContain("fallbackSubSectionNameOverride: 'tsserver.maxTsServerMemory'");
  expect(configuration).toContain("configuration.get<boolean>('typescript.disableAutomaticTypeAcquisition', false)");
  // typescript-language-server's own names for what it is told at startup.
  const server = readFileSync(require.resolve('typescript-language-server/lib/cli.mjs'), 'utf8');
  for (const name of ['maxTsServerMemory', 'disableAutomaticTypingAcquisition', 'npmLocation', 'plugins']) expect(server).toContain(name);
});

test('the Svelte plugin reaches tsserver only when the person turned it on and it is installed', () => {
  const project = folder(), tools = folder();
  const places = [path.join(project, 'src'), tools];
  expect(typescriptOptions({}, {}, { svelte: { svelte: { 'enable-ts-plugin': true } }, places })).not.toHaveProperty('plugins');
  mkdirSync(path.join(tools, 'node_modules', sveltePlugin), { recursive: true });
  writeFileSync(path.join(tools, 'node_modules', sveltePlugin, 'package.json'), '{}');
  expect(typescriptOptions({}, {}, { svelte: {}, places })).not.toHaveProperty('plugins');
  expect(typescriptOptions({}, {}, { svelte: { svelte: { 'enable-ts-plugin': true } }, places }).plugins).toEqual([{ name: sveltePlugin, location: tools }]);
  // The project's own copy is preferred, found from a folder inside it.
  mkdirSync(path.join(project, 'node_modules', sveltePlugin), { recursive: true }); mkdirSync(path.join(project, 'src'));
  writeFileSync(path.join(project, 'node_modules', sveltePlugin, 'package.json'), '{}');
  expect(packageFolder(path.join(project, 'src'), sveltePlugin)).toBe(project);
  expect(typescriptOptions({ 'svelte.enable-ts-plugin': true }, { plugins: [{ name: 'other', location: '/x' }] }, { places }).plugins)
    .toEqual([{ name: 'other', location: '/x' }, { name: sveltePlugin, location: project }]);
  // A plugin the person already listed is not listed twice.
  expect(typescriptOptions({ 'svelte.enable-ts-plugin': true }, { plugins: [{ name: sveltePlugin, location: '/mine' }] }, { places }).plugins).toEqual([{ name: sveltePlugin, location: '/mine' }]);
  const manifest = JSON.parse(source('svelte-language-tools/packages/svelte-vscode/package.json')).contributes;
  expect(manifest.typescriptServerPlugins[0].name).toBe(sveltePlugin);
  expect(manifest.configuration.properties['svelte.enable-ts-plugin'].default).toBe(false);
});

test('clangd and rust-analyzer are told what their own editors tell them, and no other tool is', () => {
  const general = clientCapabilities();
  const clangd = toolCapabilities(tool('clangd'), general)!;
  expect(reportsInactiveRegions(clangd)).toBe(true);
  expect(clangd.textDocument).toMatchObject({ ...general.textDocument, inactiveRegionsCapabilities: { inactiveRegions: true } });
  expect({ ...clangd, textDocument: undefined }).toEqual({ ...general, textDocument: undefined });
  const rust = toolCapabilities(tool('rust-analyzer'), { ...general, experimental: { other: 1 } })!;
  expect(rust.experimental).toEqual({ other: 1, serverStatusNotification: true });
  expect(reportsInactiveRegions(rust)).toBe(false);
  expect({ ...toolCapabilities(tool('rust-analyzer'), general), experimental: undefined }).toEqual({ ...general, experimental: undefined });
  expect(isRustAnalyzer(tool('rust-analyzer'))).toBe(true);
  for (const id of ['pyright', 'gopls', 'typescript-language-server', 'json-lsp']) { expect(toolCapabilities(tool(id), general), id).toBeUndefined(); expect(serverProfile(tool(id)).capabilities, id).toBeUndefined(); }
  // The profile a tool is started with carries them.
  expect(reportsInactiveRegions(serverProfile(tool('clangd')).capabilities)).toBe(true);
  expect(serverProfile(tool('rust-analyzer')).capabilities?.experimental).toEqual({ serverStatusNotification: true });
  expect(reportsInactiveRegions(undefined)).toBe(false);
});

test('inactive regions are shown faded beside clangd\'s own diagnostics, always for the same version of the text', () => {
  const uri = 'file:///project/main.c', range = (line: number, end = line + 2) => ({ start: { line, character: 0 }, end: { line: end, character: 6 } });
  const error = { range: range(1, 1), severity: 1 as const, source: 'clang', message: 'use of undeclared identifier' };
  const faded = (line: number, end?: number) => ({ range: range(line, end), severity: 4, source: 'clangd', message: inactiveRegionMessage, tags: [1] });
  const regions = new InactiveRegions();
  // The regions come first: nothing is said of the file before its diagnostics are.
  expect(regions.inactive({ textDocument: { uri, version: 1 }, regions: [range(10)] })).toBeUndefined();
  expect(regions.published({ uri, version: 1, diagnostics: [error] })).toEqual({ uri, version: 1, diagnostics: [error, faded(10)] });
  // The diagnostics come again: the regions stay (Zed's `retain_old_diagnostic`).
  expect(regions.published({ uri, version: 1, diagnostics: [] })).toEqual({ uri, version: 1, diagnostics: [faded(10)] });
  // The regions come again: only they are replaced.
  expect(regions.published({ uri, version: 1, diagnostics: [error] }).diagnostics).toHaveLength(2);
  expect(regions.inactive({ textDocument: { uri, version: 1 }, regions: [range(20), range(30)] })).toEqual({ uri, version: 1, diagnostics: [error, faded(20), faded(30)] });
  expect(regions.inactive({ textDocument: { uri, version: 1 }, regions: [] })).toEqual({ uri, version: 1, diagnostics: [error] });
  // The text changed. Diagnostics of the new version are not shown with regions of the old one…
  regions.inactive({ textDocument: { uri, version: 1 }, regions: [range(20)] });
  expect(regions.published({ uri, version: 2, diagnostics: [error] })).toEqual({ uri, version: 2, diagnostics: [error] });
  expect(regions.inactive({ textDocument: { uri, version: 2 }, regions: [range(21)] })).toEqual({ uri, version: 2, diagnostics: [error, faded(21)] });
  // …nor regions of the new version with diagnostics of the old one.
  expect(regions.inactive({ textDocument: { uri, version: 3 }, regions: [range(22)] })).toBeUndefined();
  expect(regions.published({ uri, version: 3, diagnostics: [] })).toEqual({ uri, version: 3, diagnostics: [faded(22)] });
  // A clangd that states no version is taken at its word.
  expect(regions.inactive({ textDocument: { uri }, regions: [range(5)] })).toEqual({ uri, version: 3, diagnostics: [faded(5)] });
  expect(regions.published({ uri, diagnostics: [error] })).toEqual({ uri, diagnostics: [error, faded(5)] });
  // Another file has its own, and a closed file has none.
  const other = 'file:///project/other.c';
  expect(regions.published({ uri: other, version: 1, diagnostics: [] })).toEqual({ uri: other, version: 1, diagnostics: [] });
  regions.closed(uri);
  expect(regions.published({ uri, version: 4, diagnostics: [error] })).toEqual({ uri, version: 4, diagnostics: [error] });
  // What is not a region is left out, and a file's regions have a bound.
  expect(regions.inactive({ textDocument: { uri, version: 4 }, regions: [range(1), { start: { line: -1, character: 0 }, end: { line: 2, character: 0 } }, { start: { line: 1 } }, null, 'x'] })!.diagnostics).toEqual([error, faded(1)]);
  expect(regions.inactive({ textDocument: { uri, version: 4 }, regions: Array.from({ length: 5000 }, (_, line) => range(line)) })!.diagnostics).toHaveLength(2001);
  for (const nothing of [undefined, null, {}, { textDocument: { uri } }, { textDocument: {}, regions: [] }, { textDocument: { uri: 7 }, regions: [] }]) expect(regions.inactive(nothing)).toBeUndefined();
});

test('a server status says what it means for the answers', () => {
  expect(toolStatus({ health: 'ok', quiescent: true })).toEqual({ health: 'ok', quiescent: true });
  expect(toolStatus({ health: 'warning', quiescent: false, message: '  Failed to load workspaces.  ' })).toEqual({ health: 'warning', quiescent: false, message: 'Failed to load workspaces.' });
  expect(toolStatus({ health: 'error', message: 7 })).toEqual({ health: 'error', quiescent: true });
  expect(toolStatus({ health: 'ok', message: 'x'.repeat(5000) })!.message).toHaveLength(4096);
  for (const nothing of [undefined, null, 'ok', {}, { health: 'fine' }, { quiescent: true }]) expect(toolStatus(nothing)).toBeUndefined();
  expect(statusMeaning({ health: 'ok', quiescent: true }, 'rust-analyzer')).toEqual({ line: undefined, notice: undefined, working: undefined });
  expect(statusMeaning({ health: 'ok', quiescent: false, message: 'Loading' }, 'rust-analyzer')).toEqual({ line: 'Loading', notice: undefined, working: 'rust-analyzer is still working: results may change' });
  expect(statusMeaning({ health: 'warning', quiescent: true, message: 'proc-macro server failed' }, 'rust-analyzer')).toEqual({
    line: 'rust-analyzer is only partly working: some results may be wrong. proc-macro server failed',
    notice: { severity: 'warning', message: 'rust-analyzer is only partly working: some results may be wrong.\n\nproc-macro server failed' }, working: undefined });
  expect(statusMeaning({ health: 'error', quiescent: true }, 'rust-analyzer')).toEqual({
    line: 'rust-analyzer is not working: most results will be incomplete or wrong.',
    notice: { severity: 'error', message: 'rust-analyzer is not working: most results will be incomplete or wrong.' }, working: undefined });
});

test('the capabilities, the notifications and their meaning are the ones clangd\'s and rust-analyzer\'s editors use', () => {
  // clangd
  const extension = source('vscode-clangd/src/inactive-regions.ts');
  expect(extension).toContain(`'${inactiveRegionsMethod}'`);
  expect(extension).toMatch(/inactiveRegionsCapabilities = \{\s+inactiveRegions: true,\s+\}/);
  expect(source('zed/crates/languages/src/c.rs')).toMatch(/"inactiveRegionsCapabilities": \{\s+"inactiveRegions": true,/);
  const zed = source('zed/crates/project/src/lsp_store/clangd_ext.rs');
  expect(zed).toContain(`const METHOD: &'static str = "${inactiveRegionsMethod}";`);
  expect(zed).toContain('tags: Some(vec![lsp::DiagnosticTag::UNNECESSARY])');
  expect(zed).toContain('source: Some(CLANGD_SERVER_NAME.to_string())');
  expect(zed).toContain('pub const CLANGD_SERVER_NAME: LanguageServerName = LanguageServerName::new_static("clangd");');
  // Kept when the tool's own diagnostics are published again, replaced alone, and not underlined.
  expect(zed).toContain('|_, diag, _| !is_inactive_region(diag)');
  const adapter = source('zed/crates/languages/src/c.rs');
  expect(adapter).toMatch(/fn retain_old_diagnostic\([^)]*\) -> bool \{\s+clangd_ext::is_inactive_region\(previous_diagnostic\)/);
  expect(adapter).toMatch(/fn underline_diagnostic\([^)]*\) -> bool \{\s+!clangd_ext::is_lsp_inactive_region\(diagnostic\)/);
  // rust-analyzer
  expect(source('rust-analyzer/editors/code/src/client.ts')).toContain('serverStatusNotification: true,');
  const types = source('rust-analyzer/editors/code/src/lsp_ext.ts');
  expect(types).toContain(`"${serverStatusMethod}"`);
  expect(types).toMatch(/export type ServerStatusParams = \{\s+health: "ok" \| "warning" \| "error";\s+quiescent: boolean;\s+message\?: string;\s+\};/);
  const specification = source('rust-analyzer/docs/book/src/contributing/lsp-extensions.md').replace(/\s*\n\s*\/\/\/\s*/g, ' ');
  expect(specification).toContain('`warning` means that the server is partially functional. It can answer correctly to most requests, but some results might be wrong');
  expect(specification).toContain('`error` means that the server is not functional.');
  expect(specification).toContain('but most results will be incomplete or wrong.');
  expect(specification).toContain('Is there any pending background work which might change the status?');
  // Without the capability the server shows a problem once as a message instead.
  expect(source('rust-analyzer/crates/rust-analyzer/src/main_loop.rs')).toMatch(/if self\.config\.server_status_notification\(\) \{\s+self\.send_notification::<lsp_ext::ServerStatusNotification>\(status\);\s+\} else if let \(/);
  expect(source('rust-analyzer/editors/code/src/ctx.ts')).toContain('if (!status.quiescent) icon = "$(loading~spin) ";');
  expect(source('zed/crates/lsp/src/lsp.rs')).toContain('"serverStatusNotification": true,');
  expect(source('zed/crates/project/src/lsp_store/rust_analyzer_ext.rs')).toContain(`const METHOD: &'static str = "${serverStatusMethod}";`);
});
