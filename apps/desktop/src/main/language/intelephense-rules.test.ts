import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { intelephenseActivation, intelephenseCancelIndexing, intelephenseCancelIndexingMethod, intelephenseCommandTitles, intelephenseConfiguration, intelephenseFileDefaults,
  intelephenseIndexIsStale, intelephenseKeyActivated, intelephenseKeyNotActivated, intelephenseLicenceKeyMessage, intelephenseLicenceKeyPattern, intelephenseLicenceKeyPrompt,
  intelephenseNodeArguments, intelephenseOptions, intelephenseReindexOptions, intelephenseRules, licenceKeyProblem } from './intelephense-rules';

const vendor = path.resolve(__dirname, '../../../../../vendor/vscode-intelephense');
const source = (file: string) => readFileSync(path.join(vendor, file), 'utf8');
const extension = source('src/extension.ts');
const manifest = JSON.parse(source('package.json')) as { contributes: { commands: { command: string; title: string }[]; configuration: { properties: Record<string, { default?: unknown }> } } };
const key = 'ABCDEabcde01234';

test('the initialization options are the folders, the key and whether the index is thrown away', () => {
  expect(intelephenseOptions({})).toEqual({ clearCache: false });
  expect(intelephenseOptions({ storagePath: '/data/project', globalStoragePath: '/data/global', licenceKey: key, clearCache: true }))
    .toEqual({ storagePath: '/data/project', clearCache: true, globalStoragePath: '/data/global', licenceKey: key });
  // Spaces around a key are not part of it. The tool also takes the path of a file that holds the key.
  expect(intelephenseOptions({ licenceKey: ` ${key}\n` })).toEqual({ clearCache: false, licenceKey: key });
  expect(intelephenseOptions({ licenceKey: '/home/user/intelephense/licence.txt' })).toEqual({ clearCache: false, licenceKey: '/home/user/intelephense/licence.txt' });
  // What is not a folder or a key is not sent.
  expect(intelephenseOptions({ storagePath: '', globalStoragePath: 'a\0b', licenceKey: '   ' })).toEqual({ clearCache: false });
  expect(intelephenseOptions({ storagePath: 'x'.repeat(4097), licenceKey: 'k'.repeat(4097) })).toEqual({ clearCache: false });
  expect(intelephenseOptions({ storagePath: 7, globalStoragePath: null, licenceKey: {}, clearCache: 'yes' } as unknown as Parameters<typeof intelephenseOptions>[0])).toEqual({ clearCache: false });
  // VS Code is not what starts the tool here.
  expect(intelephenseOptions({ storagePath: '/a', globalStoragePath: '/b', licenceKey: key })).not.toHaveProperty('isVscode');

  expect(extension).toMatch(/let initializationOptions = \{\s+storagePath: context\.storagePath,\s+clearCache: clearCache,\s+globalStoragePath: context\.globalStoragePath,\s+licenceKey: context\.globalState\.get<string>\(GLOBAL_STATE_LICENCE_KEY\),\s+isVscode: true\s+\};/);
  expect(extension).toContain("const GLOBAL_STATE_LICENCE_KEY = 'intelephense.licence.key';");
  // Where the tool keeps its files when it is given no folder.
  const changes = source('CHANGELOG.md');
  expect(changes).toContain('- When not provided by the client, default storage will be the following:');
  expect(changes).toContain('- storagePath - `$XDG_CONFIG_HOME/intelephense/workspace/` or `$HOME/.config/intelephense/workspace/`');
  expect(changes).toContain('- licenceKey - `$globalStoragePath/licence.txt` or `$globalStoragePath/license.txt`');
});

test('the rules of a session give the options and listen to nothing', () => {
  const rules = intelephenseRules({ storagePath: '/data/project', licenceKey: key })({ name: 'Intelephense', root: '/project', settings: {} });
  expect(rules).toEqual({ initializationOptions: { storagePath: '/data/project', clearCache: false, licenceKey: key } });
  // The extension of this version has no notification of its own; indexing is reported in the protocol.
  expect(extension).not.toContain('onNotification');
  expect(extension).not.toContain('onRequest');
  expect(source('CHANGELOG.md')).toContain('- Indexing now uses LSP work done `$/progress` notifications instead of custom notifications.');
});

test('indexing again is a start with clearCache, and an index of another version is stale', () => {
  expect(intelephenseReindexOptions({ storagePath: '/data/project', licenceKey: key })).toEqual({ storagePath: '/data/project', clearCache: true, licenceKey: key });
  expect(intelephenseReindexOptions({ clearCache: false })).toEqual({ clearCache: true });
  expect(extension).toMatch(/function indexWorkspace\(\) \{[\s\S]+?languageClient\.stop\(\)\.then\(_ => \{\s+languageClient = createClient\(extensionContext, middleware, true\);\s+languageClient\.start\(\)/);

  expect(intelephenseIndexIsStale(undefined, '1.18.5')).toBe(true);
  expect(intelephenseIndexIsStale('', '1.18.5')).toBe(true);
  expect(intelephenseIndexIsStale('1.18.4', '1.18.5')).toBe(true);
  expect(intelephenseIndexIsStale('1.19.0', '1.18.5')).toBe(true);
  expect(intelephenseIndexIsStale('1.18.5', '1.18.5')).toBe(false);
  expect(extension).toContain("let versionMemento = context.workspaceState.get<string>('version');");
  expect(extension).toMatch(/if \(\(!versionMemento \|\| \(semver\.neq\(versionMemento, VERSION\)\)\) && context\.storagePath\) \{\s+try \{\s+await fs\.remove\(context\.storagePath\);[\s\S]+?clearCache = true;/);
});

test('the commands have the extension\'s titles, and cancelling is a request without parameters', () => {
  expect(manifest.contributes.commands.map(command => [command.command, command.title])).toEqual([
    ['intelephense.index.workspace', intelephenseCommandTitles.indexWorkspace], ['intelephense.cancel.indexing', intelephenseCommandTitles.cancelIndexing],
    ['intelephense.enter.key', intelephenseCommandTitles.enterLicenceKey]]);
  expect(intelephenseCancelIndexingMethod).toBe('cancelIndexing');
  expect(intelephenseCancelIndexing).toEqual({ title: 'Cancel indexing', request: { method: 'cancelIndexing' } });
  expect(extension).toContain(`const CANCEL_INDEXING_REQUEST = new RequestType('${intelephenseCancelIndexingMethod}');`);
  expect(extension).toMatch(/function cancelIndexing\(\) \{\s+languageClient\.sendRequest\(CANCEL_INDEXING_REQUEST\.method\);\s+\}/);
});

test('a licence key is fifteen letters and digits', () => {
  expect(licenceKeyProblem(key)).toBeUndefined();
  expect(licenceKeyProblem(`  ${key}\t`)).toBeUndefined();
  // No text removes the key.
  expect(licenceKeyProblem('')).toBeUndefined();
  expect(licenceKeyProblem('   ')).toBeUndefined();
  for (const wrong of [key.slice(1), `${key}0`, 'ABCDE-abcde0123', 'ABCDE abcde0123', 'ÄBCDEabcde01234', `${key}\n${key}`]) expect(licenceKeyProblem(wrong)).toBe(intelephenseLicenceKeyMessage);

  expect(extension).toContain(`prompt: '${intelephenseLicenceKeyPrompt}',`);
  expect(extension).toMatch(/v = v\.trim\(\);\s+if\(v && !\/\^\[0-9a-zA-Z\]\{15\}\$\/\.test\(v\)\) \{\s+return 'A licence key must be a 15 character alphanumeric string\.'/);
  expect(extension).toContain(`if(v && !${intelephenseLicenceKeyPattern}.test(v)) {`);
  expect(extension).toContain(`return '${intelephenseLicenceKeyMessage}'`);
  expect(extension).toContain(`window.showInformationMessage('${intelephenseKeyActivated}');`);
  expect(extension).toContain(`window.showErrorMessage('${intelephenseKeyNotActivated}');`);
  // After a key was entered or removed, the tool is started again and reads the project again.
  expect(extension).toMatch(/await context\.globalState\.update\(GLOBAL_STATE_LICENCE_KEY, key\);[\s\S]+?\/\/restart\s+if\(languageClient\) \{\s+await languageClient\.stop\(\);\s+languageClient = createClient\(context, middleware, true\);/);
});

test('activation is one request, and its answer is kept beside the key', () => {
  const home = '/home/user';
  const machine = createHash('sha256').update(home, 'utf8').digest('hex');
  expect(intelephenseActivation(` ${key} `, home, '/data/global')).toEqual({
    url: 'https://intelephense.com/activate', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `machineId=${machine}&licenceKey=${key}`, file: path.join('/data/global', `intelephense_licence_key_${key}`) });
  for (const wrong of ['', 'short', `../${key}`, `${key}/..`, `${key}&x=1`]) expect(intelephenseActivation(wrong, home, '/data/global')).toBeUndefined();

  for (const line of ["hostname: 'intelephense.com',", 'port: 443,', "path: '/activate',", "method: 'POST',", "'Content-Type': 'application/x-www-form-urlencoded',",
    "machineId: createHash('sha256').update(os.homedir(), 'utf8').digest('hex'),", 'licenceKey: licenceKey', 'let req = https.request(options, res => {', 'if (res.statusCode === 200) {',
    "let filepath = path.join(context.globalStoragePath, 'intelephense_licence_key_' + licenceKey);", 'fs.writeFile(filepath, responseBody).then(resolve, reject);'])
    expect(extension).toContain(line);
  expect(extension).toMatch(/let postData = querystring\.stringify\(\{\s+machineId: [^\n]+\n\s+licenceKey: licenceKey\s+\}\);/);
});

test('maxMemory becomes the heap size of the tool\'s Node process, from 256 megabytes on', () => {
  expect(intelephenseNodeArguments({ intelephense: { maxMemory: 2048 } })).toEqual(['--max-old-space-size=2048']);
  expect(intelephenseNodeArguments({ 'intelephense.maxMemory': 256 })).toEqual(['--max-old-space-size=256']);
  expect(intelephenseNodeArguments({ 'intelephense.maxMemory': 1024.9 })).toEqual(['--max-old-space-size=1024']);
  expect(intelephenseNodeArguments({ 'intelephense.maxMemory': '512' })).toEqual(['--max-old-space-size=512']);
  for (const none of [undefined, null, 0, 255, 255.9, -1024, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60, '', 'much', '512 --inspect', true, [512], { value: 512 }])
    expect(intelephenseNodeArguments({ 'intelephense.maxMemory': none })).toEqual([]);
  expect(intelephenseNodeArguments(undefined)).toEqual([]);
  expect(intelephenseNodeArguments({})).toEqual([]);

  expect(extension).toContain("let memory = Math.floor(Number(intelephenseConfig.get('maxMemory')));");
  expect(extension).toMatch(/if \(memory && memory >= 256\) \{\s+let maxOldSpaceSize = '--max-old-space-size=' \+ memory\.toString\(\);\s+serverOptions\.run\.options = \{ execArgv: \[maxOldSpaceSize\] \};/);
  expect(manifest.contributes.configuration.properties['intelephense.maxMemory']).toMatchObject({ type: 'number' });
});

test('the defaults of the two lists are the extension\'s', () => {
  expect(manifest.contributes.configuration.properties['intelephense.files.associations'].default).toEqual(intelephenseFileDefaults.associations);
  expect(manifest.contributes.configuration.properties['intelephense.files.exclude'].default).toEqual(intelephenseFileDefaults.exclude);
  expect(manifest.contributes.configuration.properties['intelephense.diagnostics.run'].default).toBe('onType');
});

test('the answer for the tool\'s settings gains the editor\'s PHP file patterns and excluded patterns', () => {
  const editor = { files: { associations: { '*.inc': 'php', '*.module': 'php', '*.tpl': 'smarty', '*.php': 'php' }, exclude: { '**/cache/**': true, '**/build/**': false, '**/.git/**': true } } };
  // Written lists gain what the editor adds, each pattern once.
  expect(intelephenseConfiguration({ ...editor, intelephense: { files: { associations: ['*.php', '*.phtml'], exclude: ['**/vendor/**'], maxSize: 5_000_000 }, stubs: ['Core'] } }, 'intelephense'))
    .toEqual({ files: { associations: ['*.php', '*.phtml', '*.inc', '*.module'], exclude: ['**/vendor/**', '**/cache/**', '**/.git/**'], maxSize: 5_000_000 }, stubs: ['Core'] });
  // A list that is not written starts from the extension's default.
  expect(intelephenseConfiguration({ ...editor, intelephense: { stubs: ['Core'] } }, 'intelephense'))
    .toEqual({ stubs: ['Core'], files: { associations: ['*.php', '*.phtml', '*.inc', '*.module'], exclude: [...intelephenseFileDefaults.exclude, '**/cache/**'] } });
  expect(intelephenseConfiguration({ ...editor }, 'intelephense'))
    .toEqual({ files: { associations: ['*.php', '*.phtml', '*.inc', '*.module'], exclude: [...intelephenseFileDefaults.exclude, '**/cache/**'] } });
  // The editor's settings may be written with dotted names.
  expect(intelephenseConfiguration({ 'files.associations': { '*.inc': 'php' }, intelephense: {} }, 'intelephense')).toEqual({ files: { associations: ['*.php', '*.phtml', '*.inc'] } });
  // An empty written list is a list.
  expect(intelephenseConfiguration({ ...editor, intelephense: { files: { exclude: [] } } }, 'intelephense'))
    .toEqual({ files: { exclude: ['**/cache/**', '**/.git/**'], associations: ['*.php', '*.phtml', '*.inc', '*.module'] } });
  // The settings themselves are not changed.
  const settings = { ...editor, intelephense: { files: { associations: ['*.php'] } } };
  intelephenseConfiguration(settings, 'intelephense');
  expect(settings.intelephense).toEqual({ files: { associations: ['*.php'] } });
});

test('an answer the editor adds nothing to is what the person wrote', () => {
  const written = { files: { maxSize: 1 }, environment: { phpVersion: '8.3.0' } };
  expect(intelephenseConfiguration({ intelephense: written }, 'intelephense')).toBe(written);
  expect(intelephenseConfiguration({ intelephense: {} }, 'intelephense')).toEqual({});
  expect(intelephenseConfiguration({}, 'intelephense')).toBeNull();
  expect(intelephenseConfiguration({ files: { associations: { '*.tpl': 'smarty' }, exclude: { '**/x': false } }, intelephense: written }, 'intelephense')).toBe(written);
  // Other sections are answered as every tool is answered.
  const settings = { files: { associations: { '*.inc': 'php' } }, intelephense: { files: { maxSize: 1 }, environment: { phpVersion: '8.3.0' } }, php: { validate: { run: 'onSave' } } };
  expect(intelephenseConfiguration(settings, 'intelephense.environment')).toEqual({ phpVersion: '8.3.0' });
  expect(intelephenseConfiguration(settings, 'intelephense.files.maxSize')).toBe(1);
  expect(intelephenseConfiguration(settings, 'intelephense.files')).toEqual({ maxSize: 1 });
  expect(intelephenseConfiguration(settings, 'intelephense.missing')).toBeNull();
  expect(intelephenseConfiguration(settings, 'php.validate.run')).toBe('onSave');
  expect(intelephenseConfiguration(settings, 'php')).toEqual({ validate: { run: 'onSave' } });
  expect(intelephenseConfiguration(settings)).toBe(settings);
  expect(intelephenseConfiguration(settings, '')).toBe(settings);
});

test('diagnostics.run written as null follows php.validate.run', () => {
  expect(intelephenseConfiguration({ intelephense: { diagnostics: { run: null, enable: true } }, php: { validate: { run: 'onSave' } } }, 'intelephense')).toEqual({ diagnostics: { run: 'onSave', enable: true } });
  expect(intelephenseConfiguration({ intelephense: { diagnostics: { run: null } }, 'php.validate.run': 'onSave' }, 'intelephense')).toEqual({ diagnostics: { run: 'onSave' } });
  expect(intelephenseConfiguration({ intelephense: { diagnostics: { run: null } } }, 'intelephense')).toEqual({ diagnostics: { run: 'onType' } });
  expect(intelephenseConfiguration({ intelephense: { diagnostics: { run: null } }, php: { validate: { run: 7 } } }, 'intelephense')).toEqual({ diagnostics: { run: 'onType' } });
  // The same holds for the section when it is asked for alone, as in the extension.
  expect(intelephenseConfiguration({ intelephense: { sub: { diagnostics: { run: null } } } }, 'intelephense.sub')).toEqual({ diagnostics: { run: 'onType' } });
  // A written value stays.
  const written = { diagnostics: { run: 'onSave' } };
  expect(intelephenseConfiguration({ intelephense: written, php: { validate: { run: 'onType' } } }, 'intelephense')).toBe(written);
  expect(intelephenseConfiguration({ intelephense: { diagnostics: {} } }, 'intelephense')).toEqual({ diagnostics: {} });
});

test('settings that are not what they should be change nothing and do not throw', () => {
  for (const files of [null, 7, 'x', ['*.inc'], { associations: 'php', exclude: 7 }, { associations: null, exclude: null }])
    expect(intelephenseConfiguration({ files, intelephense: { files: { associations: ['*.php'], exclude: ['a'] } } }, 'intelephense')).toEqual({ files: { associations: ['*.php'], exclude: ['a'] } });
  // A written value that is not a list is left as it is, and nothing is added to it.
  const editor = { files: { associations: { '*.inc': 'php' }, exclude: { '**/cache/**': true } } };
  for (const files of [null, 7, 'x', ['a']]) expect(intelephenseConfiguration({ ...editor, intelephense: { files } }, 'intelephense')).toEqual({ files });
  expect(intelephenseConfiguration({ ...editor, intelephense: { files: { associations: '*.php', exclude: { a: true } } } }, 'intelephense')).toEqual({ files: { associations: '*.php', exclude: { a: true } } });
  for (const section of [null, 7, 'x', ['a']]) expect(intelephenseConfiguration({ ...editor, intelephense: section }, 'intelephense'))
    .toEqual(section === null ? { files: { associations: ['*.php', '*.phtml', '*.inc'], exclude: [...intelephenseFileDefaults.exclude, '**/cache/**'] } } : section);
  // What the person wrote in a list is passed on as written.
  expect(intelephenseConfiguration({ ...editor, intelephense: { files: { associations: ['*.php', 7, '*.php'] } } }, 'intelephense'))
    .toEqual({ files: { associations: ['*.php', 7, '*.inc'], exclude: [...intelephenseFileDefaults.exclude, '**/cache/**'] } });
  // No more than 1024 patterns come from the editor.
  const many = Object.fromEntries(Array.from({ length: 2000 }, (_, index) => [`*.p${index}`, 'php']));
  expect((intelephenseConfiguration({ files: { associations: many }, intelephense: {} }, 'intelephense') as { files: { associations: string[] } }).files.associations).toHaveLength(2 + 1024);
  expect(intelephenseConfiguration({ intelephense: { __proto__: null, files: { associations: ['a'] } }, files: { associations: { constructor: 'php' } } }, 'intelephense'))
    .toEqual({ files: { associations: ['a', 'constructor'] } });
});

test('the three changes are those of the extension\'s middleware', () => {
  const middleware = source('src/middleware.ts');
  expect(middleware).toMatch(/let vscodeAssociations = vscodeConfig\.get\('associations'\) \|\| \{\};\s+let associationsSet = new Set<string>\(intelephenseAssociations\);\s+for \(let \[key, val\] of Object\.entries\(vscodeAssociations\)\) \{\s+if \(val === 'php'\) \{\s+associationsSet\.add\(key\);/);
  expect(middleware).toMatch(/let vscodeExclude = vscodeConfig\.get\('exclude'\) \|\| \{\};\s+let excludeSet = new Set<string>\(intelephenseExclude\);\s+for \(let \[key, val\] of Object\.entries\(vscodeExclude\)\) \{\s+if \(val\) \{\s+excludeSet\.add\(key\);/);
  expect(middleware).toContain('if (v && v.files && v.files.associations) {');
  expect(middleware).toContain('if (v && v.files && v.files.exclude) {');
  expect(middleware).toMatch(/if \(v && v\.diagnostics && v\.diagnostics\.run === null\) \{\s+let vscodeConfig = workspace\.getConfiguration\('php\.validate'\);\s+if \(vscodeConfig\) \{\s+v\.diagnostics\.run = vscodeConfig\.get\('run', 'onType'\);/);
  expect(middleware).toContain("let vscodeConfig = workspace.getConfiguration('files');");
});
