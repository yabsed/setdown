import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { envImportRoots, parseEnvFile, pythonEnvChangeDelay, pythonEnvFile, pythonEnvFileDefault, pythonEnvFileSetting, pythonEnvRestartDelay, readEnvFile } from './python-env-file';

const vendor = path.resolve(__dirname, '../../../../../vendor');
const source = (file: string) => readFileSync(path.join(vendor, file), 'utf8');
const client = (file: string) => source(`vscode-python/src/client/${file}`);
const pyright = (file: string) => source(`pyright/packages/pyright-internal/src/${file}`);
const own = readFileSync(path.join(__dirname, 'python-env-file.ts'), 'utf8');
const root = path.resolve('/home/user/project');
const folder = mkdtempSync(path.join(os.tmpdir(), 'setdown-env-file-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

test('the file is the one python.envFile names, and .env of the project when nothing is written', () => {
  expect(pythonEnvFileSetting).toBe('python.envFile');
  expect(JSON.parse(source('vscode-python/package.json')).contributes.configuration.properties[pythonEnvFileSetting].default).toBe(pythonEnvFileDefault);
  expect(pythonEnvFile(root)).toBe(path.join(root, '.env'));
  expect(pythonEnvFile(root, {})).toBe(path.join(root, '.env'));
  expect(pythonEnvFile(root, { python: { envFile: '${workspaceFolder}/config/dev.env' } })).toBe(path.join(root, 'config/dev.env'));
  expect(pythonEnvFile(root, { 'python.envFile': '/etc/project.env' })).toBe(path.resolve('/etc/project.env'));
  // The names the extension knows without an open document.
  expect(pythonEnvFile(root, { 'python.envFile': '${workspaceRoot}/a.env' })).toBe(path.join(root, 'a.env'));
  expect(pythonEnvFile(root, { 'python.envFile': '${cwd}/a.env' })).toBe(path.join(root, 'a.env'));
  expect(pythonEnvFile(root, { 'python.envFile': '${workspaceFolder:project}/a.env' })).toBe(path.join(root, 'a.env'));
  expect(pythonEnvFile(root, { 'python.envFile': '/env/${workspaceFolderBasename}.env' })).toBe(path.resolve('/env/project.env'));
  expect(pythonEnvFile(root, { 'python.envFile': '/env/${workspaceRootFolderName}.env' })).toBe(path.resolve('/env/project.env'));
  expect(pythonEnvFile(root, { 'python.envFile': '${env:CONFIG}/${env.STAGE}.env' }, { CONFIG: '/etc/app', STAGE: 'dev' })).toBe(path.resolve('/etc/app/dev.env'));
  // A variable that is not set is nothing; another unknown name stays as written.
  expect(pythonEnvFile(root, { 'python.envFile': '/etc/app${env:MISSING}/x.env' }, {})).toBe(path.resolve('/etc/app/x.env'));
  expect(pythonEnvFile(root, { 'python.envFile': '/etc/app${env:constructor}/x.env' }, {})).toBe(path.resolve('/etc/app/x.env'));
  expect(pythonEnvFile(root, { 'python.envFile': '${workspaceFolder}/${fileBasename}.env' })).toBe(path.join(root, '${fileBasename}.env'));
  expect(pythonEnvFile(root, { 'python.envFile': '${workspaceFolder}/${constructor}.env' })).toBe(path.join(root, '${constructor}.env'));
  // A path that is not absolute is read from the project.
  expect(pythonEnvFile(root, { 'python.envFile': 'config/dev.env' })).toBe(path.join(root, 'config/dev.env'));
  // No file.
  expect(pythonEnvFile(root, { 'python.envFile': '' })).toBeUndefined();
  expect(pythonEnvFile(root, { 'python.envFile': '${env:MISSING}' }, {})).toBeUndefined();
  for (const wrong of [null, 7, true, ['.env'], { file: '.env' }]) expect(pythonEnvFile(root, { 'python.envFile': wrong })).toBeUndefined();
  expect(pythonEnvFile(root, { 'python.envFile': 'a\0b' })).toBeUndefined();

  const variables = client('common/variables/systemVariables.ts');
  expect(variables).toContain('const regexp = /\\$\\{(.*?)\\}/g;');
  expect(variables).toContain("return match && (match.indexOf('env.') > 0 || match.indexOf('env:') > 0) ? '' : match;");
  for (const name of ['cwd', 'workspaceRoot', 'workspaceFolder', 'workspaceRootFolderName', 'workspaceFolderBasename']) expect(variables).toContain(`public get ${name}(): string {`);
  expect(variables).toContain('[`workspaceFolder:${basename}`] =');
  const provider = client('common/variables/environmentVariablesProvider.ts');
  expect(provider).toContain("const envFileSetting = this.workspaceService.getConfiguration('python', resource).get<string>('envFile');");
  expect(provider).toContain("return workspaceFolderUri?.fsPath ? path.join(workspaceFolderUri?.fsPath, '.env') : '';");
  // The one file is watched, and the setting that names it.
  expect(provider).toContain('const envFileWatcher = this.workspaceService.createFileSystemWatcher(envFile);');
  for (const event of ['onDidChange', 'onDidCreate', 'onDidDelete']) expect(provider).toContain(`envFileWatcher.${event}(`);
  expect(provider).toContain(`if (e.affectsConfiguration('${pythonEnvFileSetting}', uri)) {`);
});

// The cases below are those of the extension's own test of `parseEnvFile`, with its text and its answers.
test('custom variables are parsed from the file', () => {
  expect(parseEnvFile(`
X1234PYEXTUNITTESTVAR=1234
PYTHONPATH=../workspace5
            `)).toEqual({ X1234PYEXTUNITTESTVAR: '1234', PYTHONPATH: '../workspace5' });
  expect(parseEnvFile(`
X=1
Y=2
PYTHONPATH=/usr/one/three:/usr/one/four
# Unix PATH variable
PATH=/usr/x:/usr/y
# Windows Path variable
Path=/usr/x:/usr/y
            `)).toEqual({ X: '1', Y: '2', PYTHONPATH: '/usr/one/three:/usr/one/four', PATH: '/usr/x:/usr/y', Path: '/usr/x:/usr/y' });
});

test('a name is letters, digits and underscores, and does not start with a digit', () => {
  expect(parseEnvFile(`
SPAM=1234
ham=5678
Eggs=9012
1bogus2=...
bogus 3=...
bogus.4=...
bogus-5=...
bogus~6=...
VAR1=3456
VAR_2=7890
_VAR_3=1234
            `)).toEqual({ SPAM: '1234', ham: '5678', Eggs: '9012', VAR1: '3456', VAR_2: '7890', _VAR_3: '1234' });
});

test('an empty value is the empty text', () => {
  expect(parseEnvFile(`
SPAM=
            `)).toEqual({ SPAM: '' });
});

test('outer quotation marks are removed, and only then is \\n a line break', () => {
  expect(parseEnvFile(`
SPAM=12\\n34
HAM='56\\n78'
EGGS="90\\n12"
FOO='"34\\n56"'
BAR="'78\\n90'"
BAZ="\"AB\\nCD"
VAR1="EF\\nGH
VAR2=IJ\\nKL"
VAR3='MN'OP'
VAR4="QR"ST"
            `)).toEqual({ SPAM: '12\\n34', HAM: '56\n78', EGGS: '90\n12', FOO: '"34\n56"', BAR: "'78\n90'", BAZ: '"AB\nCD', VAR1: '"EF\\nGH', VAR2: 'IJ\\nKL"',
    VAR3: "MN'OP", VAR4: 'QR"ST' });
});

test('whitespace around a name and a value is ignored', () => {
  expect(parseEnvFile(`
SPAM=1234
HAM =5678
EGGS= 9012
FOO = 3456
  BAR=7890
  BAZ = ABCD
VAR1=EFGH  ...
VAR2=IJKL
VAR3='  MNOP  '
            `)).toEqual({ SPAM: '1234', HAM: '5678', EGGS: '9012', FOO: '3456', BAR: '7890', BAZ: 'ABCD', VAR1: 'EFGH  ...', VAR2: 'IJKL', VAR3: '  MNOP  ' });
});

test('blank lines and comment lines are skipped; a comment after a value belongs to the value', () => {
  expect(parseEnvFile(`

SPAM=1234

HAM=5678


            `)).toEqual({ SPAM: '1234', HAM: '5678' });
  expect(parseEnvFile(`
# step 1
SPAM=1234
  # step 2
HAM=5678
#step 3
EGGS=9012  # ...
#  done
            `)).toEqual({ SPAM: '1234', HAM: '5678', EGGS: '9012  # ...' });
});

test('a reference in braces is the variable written earlier', () => {
  expect(parseEnvFile(['REPO=/home/user/git/foobar ', 'PYTHONPATH=${REPO}/foo:${REPO}/bar ', '                '].join('\n')))
    .toEqual({ REPO: '/home/user/git/foobar', PYTHONPATH: '/home/user/git/foobar/foo:/home/user/git/foobar/bar' });
  // The example of the extension's documentation.
  expect(parseEnvFile(['VAR1=abc ', 'VAR2_A="${VAR1}\\ndef" ', 'VAR2_B="${VAR1}\\n"def ', '                '].join('\n')))
    .toEqual({ VAR1: 'abc', VAR2_A: 'abc\ndef', VAR2_B: '"abc\\n"def' });
  // Braces are required.
  expect(parseEnvFile(['SPAM=1234 ', 'EGGS=$SPAM ', '                '].join('\n'))).toEqual({ SPAM: '1234', EGGS: '$SPAM' });
  // A variable may refer to its own earlier value.
  expect(parseEnvFile(['REPO=/home/user/git/foobar ', 'PYTHONPATH=${REPO}/foo ', 'PYTHONPATH=${PYTHONPATH}:${REPO}/bar ', '                '].join('\n')))
    .toEqual({ REPO: '/home/user/git/foobar', PYTHONPATH: '/home/user/git/foobar/foo:/home/user/git/foobar/bar' });
  // What the file does not set comes from the environment it is given.
  expect(parseEnvFile(['PYTHONPATH=${REPO}/foo:${REPO}/bar ', '                '].join('\n'), { REPO: '/home/user/git/foobar' }))
    .toEqual({ PYTHONPATH: '/home/user/git/foobar/foo:/home/user/git/foobar/bar' });
});

test('a reference the extension does not accept leaves the whole value as written', () => {
  expect(parseEnvFile(['SPAM=EGGS ', 'EGGS=??? ', 'HAM1="-- ${${SPAM}} --"', 'abcEGGSxyz=!!! ', 'HAM2="-- ${abc${SPAM}xyz} --"', 'HAM3="-- ${${SPAM} --"',
    'HAM4="-- ${${SPAM}} ${EGGS} --"', '                    '].join('\n')))
    .toEqual({ SPAM: 'EGGS', EGGS: '???', HAM1: '-- ${${SPAM}} --', abcEGGSxyz: '!!!', HAM2: '-- ${abc${SPAM}xyz} --', HAM3: '-- ${${SPAM} --', HAM4: '-- ${${SPAM}} ${EGGS} --' });
  expect(parseEnvFile(['SPAM=EGGS ', 'EGGS=??? ', 'HAM1=${} ', 'HAM2=${ ', 'HAM3=${SPAM+EGGS} ', 'HAM4=$SPAM ', '                '].join('\n')))
    .toEqual({ SPAM: 'EGGS', EGGS: '???', HAM1: '${}', HAM2: '${', HAM3: '${SPAM+EGGS}', HAM4: '$SPAM' });
});

test('a dollar sign after a backslash is a dollar sign', () => {
  expect(parseEnvFile(['SPAM=1234 ', 'EGGS=\\${SPAM}/foo:\\${SPAM}/bar ', 'HAM=$ ... $$ ', 'FOO=foo\\$bar ', '                '].join('\n')))
    .toEqual({ SPAM: '1234', EGGS: '${SPAM}/foo:${SPAM}/bar', HAM: '$ ... $$', FOO: 'foo$bar' });
});

test('the extension\'s test still expects these answers, and its parser is still written this way', () => {
  const tests = source('vscode-python/src/test/common/variables/envVarsService.unit.test.ts');
  for (const expected of [`'PYTHONPATH', '../workspace5',`, `'SPAM', '12\\\\n34',`, `'HAM', '56\\n78',`, `'BAZ', '"AB\\nCD',`, `'VAR3', "MN'OP",`, `'VAR4', 'QR"ST',`, `'VAR3', '  MNOP  ',`,
    `'EGGS', '9012  # ...',`, `'VAR2_B', '"abc\\\\n"def',`, `'EGGS', '$SPAM',`, `'HAM1', '-- \${\${SPAM}} --',`, `'HAM4', '-- \${\${SPAM}} \${EGGS} --',`, `'HAM3', '\${SPAM+EGGS}',`,
    `'EGGS', '\${SPAM}/foo:\${SPAM}/bar',`, `'FOO', 'foo$bar',`])
    expect(tests).toContain(`expect(vars).to.have.property(${expected} 'value is invalid');`.replace("'../workspace5', 'value", "'../workspace5', 'PYTHONPATH value"));
  const parser = client('common/variables/environment.ts');
  // The same expressions, letter for letter, in the extension and here.
  for (const expression of ['/^\\s*(_*[a-zA-Z]\\w*)\\s*=\\s*(.*?)?\\s*$/', '/\\${([a-zA-Z]\\w*)?([^}\\w].*)?}/g', ".replace(/\\\\n/gm, '\\n')", ".replace(/\\\\\\$/g, '$')", ".split('\\n')"]) {
    expect(parser).toContain(expression);
    expect(own).toContain(expression);
  }
  expect(parser).toContain('value = value.substring(1, value.length - 1);');
  expect(parser).toContain("if (offset > 0 && orig[offset - 1] === '\\\\') {");
  expect(parser).toContain("if ((bogus && bogus !== '') || !substName || substName === '') {");
  expect(parser).toContain('return localVars[substName] || globalVars[substName] || missing;');
  expect(parser).toContain('if (!invalid && replacement !== value) {');
  expect(parser).toContain("if (!filePath || !pathExistsSync(filePath)) {");
});

test('it is the extension\'s reading of the file and not a shell\'s', () => {
  // No `export`, one variable on a line, no value over several lines.
  expect(parseEnvFile('export A=1\nB=2; C=3\nD="one\ntwo"\nE=5')).toEqual({ B: '2; C=3', D: '"one', E: '5' });
  // Line ends of Windows.
  expect(parseEnvFile('A=1\r\nB="x y"\r\n\r\n# c\r\nPYTHONPATH=src\r\n')).toEqual({ A: '1', B: 'x y', PYTHONPATH: 'src' });
  // One quotation mark is a value; two are the empty text.
  expect(parseEnvFile("A='\nB=''\nC=\"\"\nD=\"")).toEqual({ A: "'", B: '', C: '', D: '"' });
  // An empty earlier value falls back on the environment; an unknown name is nothing.
  expect(parseEnvFile('A=\nB=${A}/x\nC=${NONE}/y', { A: 'base' })).toEqual({ A: '', B: 'base/x', C: '/y' });
  // The last line that sets a name wins, at the place of the first.
  expect(Object.entries(parseEnvFile('A=1\nB=2\nA=3'))).toEqual([['A', '3'], ['B', '2']]);
  expect(parseEnvFile('')).toEqual({});
  expect(parseEnvFile('\n\n# nothing\n=x\n')).toEqual({});
});

test('names that mean something to JavaScript are names like any other', () => {
  // A name may start with an underscore where it is set, and not where it is referred to: `SUBST_REGEX` wants a letter first.
  const variables = parseEnvFile('__proto__=1\nconstructor=2\nA=${toString}${hasOwnProperty}x\nB=${__proto__}${constructor}');
  expect(Object.entries(variables)).toEqual([['__proto__', '1'], ['constructor', '2'], ['A', 'x'], ['B', '${__proto__}2']]);
  expect(Object.getPrototypeOf(variables)).toBe(Object.prototype);
  expect(({} as Record<string, unknown>).A).toBeUndefined();
});

test('a file whose lines double a variable does not fill the memory', () => {
  const doubled = (times: number) => parseEnvFile(['A=0123456789abcdef', ...Array.from({ length: times }, () => 'A=${A}${A}')].join('\n')).A;
  // 16 characters double up to 16,384; the next doubling would pass the limit and stays as written.
  expect(doubled(10)).toHaveLength(16 * 2 ** 10);
  expect(doubled(11)).toBe('${A}${A}');
  expect(doubled(5000).length).toBeLessThanOrEqual(32_767);
  const wide = `A=${'x'.repeat(30_000)}\nB=${'${A}'.repeat(100_000)}`;
  expect(parseEnvFile(wide).B).toHaveLength(400_000);
  // A long value that refers to nothing is kept.
  expect(parseEnvFile(`KEY=${'k'.repeat(100_000)}`).KEY).toHaveLength(100_000);
});

test('a file that is missing, empty, unreadable or too large sets nothing', () => {
  const file = path.join(folder, '.env');
  expect(readEnvFile(undefined)).toEqual({});
  expect(readEnvFile('')).toEqual({});
  expect(readEnvFile(file)).toEqual({});
  writeFileSync(file, '');
  expect(readEnvFile(file)).toEqual({});
  writeFileSync(file, 'SRC=${HOME_OF_PROJECT}/src\nPYTHONPATH=${SRC}:lib\n');
  expect(readEnvFile(file, { HOME_OF_PROJECT: '/work' })).toEqual({ SRC: '/work/src', PYTHONPATH: '/work/src:lib' });
  expect(readEnvFile(file)).toEqual({ SRC: '/src', PYTHONPATH: '/src:lib' });
  mkdirSync(path.join(folder, 'folder.env'));
  expect(readEnvFile(path.join(folder, 'folder.env'))).toEqual({});
  expect(readEnvFile(path.join(folder, 'a\0b'))).toEqual({});
  const large = path.join(folder, 'large.env');
  writeFileSync(large, `A=1\n${'#'.repeat(1024 * 1024)}`);
  expect(readEnvFile(large)).toEqual({});
  writeFileSync(large, `A=1\n${'#'.repeat(1024 * 1024 - 4)}`);
  expect(readEnvFile(large)).toEqual({ A: '1' });
});

test('PYTHONPATH of the file becomes folders of the project', () => {
  const join = (...entries: string[]) => entries.join(path.delimiter);
  expect(envImportRoots({}, root)).toEqual({ extraPaths: [], env: {} });
  expect(envImportRoots({ OTHER: 'x' }, root, '/inherited')).toEqual({ extraPaths: [], env: {} });
  // An empty PYTHONPATH in the file sets nothing, as in the extension's `_appendPaths`.
  expect(envImportRoots({ PYTHONPATH: '' }, root, '/inherited')).toEqual({ extraPaths: [], env: {} });
  // Relative entries are read from the project folder, as Python reads them from its working directory.
  const roots = envImportRoots({ PYTHONPATH: join('src', '../workspace5', '/usr/one/three', './src/') }, root);
  expect(roots.extraPaths).toEqual([path.join(root, 'src'), path.resolve(root, '../workspace5'), path.resolve('/usr/one/three')]);
  expect(roots.env).toEqual({ PYTHONPATH: join(...roots.extraPaths) });
  // An empty entry is the working directory itself.
  expect(envImportRoots({ PYTHONPATH: join('src', '') }, root).extraPaths).toEqual([path.join(root, 'src'), root]);
  // The PYTHONPATH the server would have anyway follows the file's.
  expect(envImportRoots({ PYTHONPATH: 'src' }, root, ` ${join('/a', 'b')} `).env).toEqual({ PYTHONPATH: join(path.join(root, 'src'), '/a', 'b') });
  expect(envImportRoots({ PYTHONPATH: 'src' }, root, '   ').env).toEqual({ PYTHONPATH: path.join(root, 'src') });
  expect(envImportRoots({ PYTHONPATH: 'src' }, root, '/a').extraPaths).toEqual([path.join(root, 'src')]);
  // What cannot be a path is left out; no more than 256 folders.
  expect(envImportRoots({ PYTHONPATH: join('a\0b', 'src') }, root).extraPaths).toEqual([path.join(root, 'src')]);
  expect(envImportRoots({ PYTHONPATH: join(...Array.from({ length: 300 }, (_, index) => `p${index}`)) }, root).extraPaths).toHaveLength(256);
  expect(envImportRoots({ PYTHONPATH: 7 } as unknown as Record<string, string>, root)).toEqual({ extraPaths: [], env: {} });
  expect(envImportRoots(Object.create({ PYTHONPATH: 'src' }) as Record<string, string>, root)).toEqual({ extraPaths: [], env: {} });
  // The file as the extension reads it, end to end.
  expect(envImportRoots(parseEnvFile('BASE=libs\nPYTHONPATH=${BASE}/a' + path.delimiter + '${BASE}/b'), root).extraPaths).toEqual([path.join(root, 'libs/a'), path.join(root, 'libs/b')]);
});

test('the extension puts the file\'s PYTHONPATH before the inherited one and gives it to Pylance alone', () => {
  const provider = client('common/variables/environmentVariablesProvider.ts');
  expect(provider).toMatch(/if \(this\.process\.env\.PYTHONPATH\) \{\s+this\.envVarsService\.appendPythonPath\(mergedVars!, this\.process\.env\.PYTHONPATH\);/);
  const parser = client('common/variables/environment.ts');
  expect(parser).toContain(".filter((item) => typeof item === 'string' && item.trim().length > 0)");
  expect(parser).toContain('vars[variableName] = variable + path.delimiter + valueToAppend;');
  expect(client('activation/languageClientMiddlewareBase.ts')).toMatch(/const envPYTHONPATH = env\.PYTHONPATH;\s+if \(envPYTHONPATH\) \{\s+settingDict\._envPYTHONPATH = envPYTHONPATH;/);
  // Pyright's server reads its settings in these two files, and neither knows the name.
  expect(pyright('pyrightServer.ts')).not.toContain('_envPYTHONPATH');
  expect(pyright('languageServerBase.ts')).not.toContain('_envPYTHONPATH');
});

test('Pyright looks in extraPaths before the standard library and in the interpreter\'s sys.path after it', () => {
  expect(pyright('pyrightServer.ts')).toMatch(/const extraPaths = pythonAnalysisSection\.extraPaths;\s+if \(extraPaths && Array\.isArray\(extraPaths\) && extraPaths\.length > 0\) \{\s+serverSettings\.extraPathFileSpecs = extraPaths/);
  expect(pyright('languageService/analyzerServiceExecutor.ts')).toContain('commandLineOptions.configSettings.extraPaths = serverSettings.extraPathFileSpecs ?? [];');
  // The project's own configuration file wins over the setting.
  expect(pyright('analyzer/service.ts')).toMatch(/if \(!configOptions\.defaultExtraPaths\) \{\s+configOptions\.ensureDefaultExtraPaths\(\s+this\.fs,\s+commandLineOptions\.configSettings\.autoSearchPaths \?\? false,\s+commandLineOptions\.configSettings\.extraPaths/);
  expect(pyright('analyzer/importResolver.ts')).toMatch(new RegExp(['Looking in root directory of execution environment', 'for \\(const extraPath of execEnv\\.extraPaths\\) \\{',
    '// Check for a stdlib typeshed file\\.', '// Look for the import in the list of third-party packages\\.', 'const pythonSearchPaths = this\\.getPythonSearchPaths\\(importLogger\\);'].join('[\\s\\S]+?')));
  // The settings are read again when the editor says they changed.
  expect(pyright('languageServerBase.ts')).toMatch(/protected onDidChangeConfiguration\(params: DidChangeConfigurationParams\) \{[\s\S]+?this\.updateSettingsForAllWorkspaces\(\);/);
  // The interpreter is asked without `-I`, with the server's own environment, in the project folder.
  const host = pyright('common/fullAccessHost.ts');
  expect(host).toContain('const execOutput = this._executeCodeInInterpreter(interpreterPath, [], extractSys, cwd);');
  expect(host).toMatch(/child_process\.execFileSync\(interpreterPath, commandLineArgs, \{\s+cwd: cwdToUse,\s+encoding: 'utf8',\s+shell: useShell,\s+\}\);/);
  expect(pyright('analyzer/pythonPathUtils.ts')).toContain('host.getPythonSearchPaths(configOptions.pythonPath, importLogger, configOptions.projectRoot);');
});

test('the waits after a change of the file are the extension\'s', () => {
  const change = /@debounceSync\((\d+)\)\s+protected onEnvVarChange\(\): void \{/.exec(client('activation/common/analysisOptions.ts'));
  expect(Number(change?.[1])).toBe(pythonEnvChangeDelay);
  expect(client('activation/common/analysisOptions.ts')).toMatch(/if \(this\.envPythonPath !== envPythonPath\) \{\s+this\.didChange\.fire\(\);/);
  const restart = /@debounceSync\((\d+)\)\s+protected restartLanguageServerDebounced\(\): void \{/.exec(client('activation/jedi/manager.ts'));
  expect(Number(restart?.[1])).toBe(pythonEnvRestartDelay);
  expect(client('activation/jedi/manager.ts')).toContain('this.analysisOptions.onDidChange(this.restartLanguageServerDebounced, this, this.disposables);');
  // Pylance is not started again: it is told at once that its settings changed, and asks for them.
  expect(client('activation/node/languageServerProxy.ts')).toMatch(/this\.environmentService\.onDidEnvironmentVariablesChange\(\(\) => \{\s+client\.sendNotification\(DidChangeConfigurationNotification\.type, \{\s+settings: null,/);
});
