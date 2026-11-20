import { expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolAnswer, ToolSignal } from './tool-signals';
import { conflictMessage, isKotlinReload, kotlinChooserLimit, kotlinCommands, kotlinConflictRows, kotlinDeclaredCapabilities, kotlinIndexDirectory, kotlinLicenceExitCode, kotlinMethods,
  kotlinReloadFailure, kotlinReloadParams, kotlinReloadSettings, kotlinRestartSettings, kotlinRules, kotlinSettingsChange, kotlinSettingsChangeNotice, kotlinSignalKeys, kotlinStartFailure,
  kotlinStartLimit, kotlinStatusQuery, kotlinUndeclaredCapabilities } from './kotlin-signals';

const rules = (settings: Record<string, unknown> = {}) => kotlinRules({ name: 'Kotlin', root: '/work/shop', settings });
const notify = (session: ReturnType<typeof rules>, method: string, params: unknown) => session.notifications![method](params);
const keys = kotlinSignalKeys;
/** What a tool may send in place of what it should: none of it may throw or show anything. */
const malformed = [undefined, null, 0, 7, '', 'text', true, [], [1], () => 1];

test('exactly the two capabilities with an editor half here are declared, beside what was already there', () => {
  const general = { textDocument: { hover: {} }, experimental: { serverStatusNotification: true } };
  const declared = rules().capabilities!(general);
  expect(declared).toStrictEqual({ textDocument: { hover: {} }, experimental: { serverStatusNotification: true, conflictView: true, actionChooser: true } });
  expect(general.experimental).toStrictEqual({ serverStatusNotification: true });
  // Nothing, or something that is not an object, under `experimental`.
  expect(rules().capabilities!({}).experimental).toStrictEqual({ conflictView: true, actionChooser: true });
  expect(rules().capabilities!({ experimental: 'yes' }).experimental).toStrictEqual({ conflictView: true, actionChooser: true });
  for (const name of kotlinUndeclaredCapabilities) expect(declared.experimental).not.toHaveProperty(name);
  // Every declared capability has its message handled, and no message is handled without need.
  const session = rules();
  expect(Object.keys(session.requests!)).toEqual([kotlinMethods.showConflicts]);
  expect(Object.keys(session.notifications!).sort()).toEqual([kotlinMethods.buildOutput, kotlinMethods.chooseAction, kotlinMethods.importLog, kotlinMethods.importState, kotlinMethods.importStatus].sort());
  expect(session.initializationOptions).toBeUndefined();
});

test('a message of the import log is a line of the log and nothing else', () => {
  const session = rules();
  expect(notify(session, kotlinMethods.importLog, { type: 3, message: 'Resolving dependencies' })).toStrictEqual({ log: ['Resolving dependencies'] });
  expect(notify(session, kotlinMethods.importLog, { type: 3, message: 'first\r\n\r\nsecond  \nthird' })).toStrictEqual({ log: ['first', 'second', 'third'] });
  expect(notify(session, kotlinMethods.importLog, { type: 3, message: '' })).toBeUndefined();
  expect(notify(session, kotlinMethods.importLog, { type: 3, message: 42 })).toBeUndefined();
  // One message is cut to 4096 characters and 80 lines.
  expect(notify(session, kotlinMethods.importLog, { message: 'x'.repeat(9000) })!.log![0]).toHaveLength(4096);
  expect(notify(session, kotlinMethods.importLog, { message: 'line\n'.repeat(500) })!.log).toHaveLength(80);
});

test('an import that started is work in progress until it succeeds', () => {
  const session = rules();
  expect(notify(session, kotlinMethods.importLog, { type: 3, message: 'Importing Gradle project', tool: 'Gradle', started: true })).toStrictEqual({
    log: ['Importing Gradle project'], progress: { [keys.progress]: 'Importing the Gradle project' }, context: { [keys.context]: 'Importing' } });
  expect(notify(session, kotlinMethods.importLog, { type: 3, message: 'Import finished', succeeded: true })).toStrictEqual({
    log: ['Import finished'], progress: { [keys.progress]: undefined }, notices: { [keys.buildError]: undefined }, context: { [keys.context]: 'Imported' } });
  // No build tool named.
  expect(notify(rules(), kotlinMethods.importLog, { message: 'Importing', started: true })!.progress).toStrictEqual({ [keys.progress]: 'Importing the project' });
  expect(notify(rules(), kotlinMethods.importLog, { message: 'Importing', started: true, tool: '  ' })!.progress).toStrictEqual({ [keys.progress]: 'Importing the project' });
});

test('a failed import leaves "<tool>: Build Error" until an import succeeds', () => {
  const session = rules();
  notify(session, kotlinMethods.importLog, { message: 'Importing', tool: 'Gradle', started: true });
  expect(notify(session, kotlinMethods.importLog, { type: 1, message: 'Could not resolve com.example:lib:1.0\n  at Build.kt', tool: 'Gradle', failed: true })).toStrictEqual({
    log: ['Could not resolve com.example:lib:1.0', '  at Build.kt'], progress: { [keys.progress]: undefined }, context: { [keys.context]: 'Gradle: Build Error' },
    notices: { [keys.buildError]: { severity: 'warning', message: 'Gradle: Build Error\nCould not resolve com.example:lib:1.0\n  at Build.kt\nThe build output is in the log of this tool.' } } });
  // The end of the cycle and the start of the next one do not clear it; only a success does (`registerImportLogHandler`).
  expect(notify(session, kotlinMethods.importState, { phase: 'FAILED' })).toStrictEqual({ context: { [keys.context]: 'Gradle: Build Error' }, progress: { [keys.progress]: undefined } });
  expect(notify(session, kotlinMethods.importLog, { message: 'Importing again', tool: 'Gradle', started: true })!.context).toStrictEqual({ [keys.context]: 'Gradle: Build Error' });
  expect(notify(session, kotlinMethods.importState, { phase: 'FINISHED' })!.context).toStrictEqual({ [keys.context]: 'Gradle: Build Error' });
  const success = notify(session, kotlinMethods.importLog, { message: 'Done', succeeded: true })!;
  expect(success.context).toStrictEqual({ [keys.context]: 'Imported' });
  expect(success.notices).toStrictEqual({ [keys.buildError]: undefined });

  // lspClient.ts: `setBuildError(p.tool ?? 'Build')`, and `failed` is looked at before `succeeded`.
  const unnamed = notify(rules(), kotlinMethods.importLog, { message: '', failed: true, succeeded: true })!;
  expect(unnamed.context).toStrictEqual({ [keys.context]: 'Build: Build Error' });
  expect(unnamed.notices![keys.buildError]).toStrictEqual({ severity: 'warning', message: 'Build: Build Error\nThe build output is in the log of this tool.' });
  // A long reason is cut, so the notice stays a notice.
  expect(notify(rules(), kotlinMethods.importLog, { message: 'e'.repeat(5000), failed: true })!.notices![keys.buildError]!.message.length).toBeLessThan(1100);
  // Only `true` is a flag.
  expect(notify(rules(), kotlinMethods.importLog, { message: 'x', failed: 'yes', started: 1, succeeded: {} })).toStrictEqual({ log: ['x'] });
});

test('the end of an import cycle is shown by its phase', () => {
  const session = rules();
  expect(notify(session, kotlinMethods.importState, { phase: 'FINISHED' })).toStrictEqual({ context: { [keys.context]: 'Imported' }, progress: { [keys.progress]: undefined } });
  expect(notify(session, kotlinMethods.importState, { phase: 'CANCELLED' })).toStrictEqual({ context: { [keys.context]: 'Cancelled' }, progress: { [keys.progress]: undefined } });
  expect(notify(session, kotlinMethods.importState, { phase: 'FAILED' })).toStrictEqual({ context: { [keys.context]: 'Failed' }, progress: { [keys.progress]: undefined } });
  // The server never sends this one as a notification; it is the answer to the request of the same name.
  expect(notify(session, kotlinMethods.importState, { phase: 'IN_PROGRESS' })).toStrictEqual({ context: { [keys.context]: 'Importing' }, progress: { [keys.progress]: 'Importing the project' } });
  for (const phase of ['finished', 'DONE', '', 'toString', 'constructor', 3, null]) expect(notify(session, kotlinMethods.importState, { phase })).toBeUndefined();
});

const conflict = (extra: Record<string, unknown> = {}) => ({ folderUri: 'file:///work/my%20shop', reason: 'ambiguousBuildSystem', candidates: ['gradle', 'maven'], dismissed: false, ...extra });

test('several build tools in one folder block the import, and the warning comes once the server\'s question was closed', () => {
  const session = rules();
  // While the server's own question is open, only the status says so (statusBar.test.ts, first case).
  expect(notify(session, kotlinMethods.importStatus, { blockedFolders: [conflict()] })).toStrictEqual({ context: { [keys.context]: 'Build tool required' }, notices: { [keys.buildTool]: undefined } });
  const dismissed = notify(session, kotlinMethods.importStatus, { blockedFolders: [conflict({ dismissed: true })] })!;
  expect(dismissed.context).toStrictEqual({ [keys.context]: 'Build tool required' });
  expect(dismissed.notices![keys.buildTool]).toStrictEqual({ severity: 'warning', message: 'Choose a build tool to start project import.\nFound in my shop: gradle, maven', actions: [
    { title: 'Choose Build Tool…', request: { method: 'intellij/reloadWorkspace' } },
    { title: 'Use gradle', setting: { name: 'intellij.buildTool', value: 'gradle' } },
    { title: 'Use maven', setting: { name: 'intellij.buildTool', value: 'maven' } }] });
  // The re-import has no parameters in the action; they are made at the click.
  const actions = dismissed.notices![keys.buildTool]!.actions!;
  expect(actions.map(isKotlinReload)).toEqual([true, false, false]);
  expect(isKotlinReload({ title: 'x', request: { method: 'intellij/other' } })).toBe(false);
  // Blocking beats what the import log said; unblocked, that is shown again.
  notify(session, kotlinMethods.importLog, { message: 'Importing', started: true });
  expect(notify(session, kotlinMethods.importStatus, { blockedFolders: [conflict()] })!.context).toStrictEqual({ [keys.context]: 'Build tool required' });
  expect(notify(session, kotlinMethods.importStatus, { blockedFolders: [] })).toStrictEqual({ context: { [keys.context]: 'Importing' }, notices: { [keys.buildTool]: undefined } });
});

test('only a folder with several build tools blocks, and only a build tool every such folder has is offered', () => {
  // statusBar.test.ts: "ignores other blocked import reasons".
  expect(notify(rules(), kotlinMethods.importStatus, { blockedFolders: [{ folderUri: 'file:///workspace', reason: 'noBuildSystemFound', candidates: [], dismissed: true }] }))
    .toStrictEqual({ context: { [keys.context]: undefined }, notices: { [keys.buildTool]: undefined } });
  const several = notify(rules(), kotlinMethods.importStatus, { blockedFolders: [
    conflict({ folderUri: 'file:///work/a', candidates: ['gradle', 'maven', 'gradle', 'subproject', 'Ant'], dismissed: true }),
    conflict({ folderUri: 'file:///work/b/', candidates: ['maven', 'bazel'] }),
    { folderUri: 'file:///work/c', reason: 'noBuildSystemFound', candidates: ['jps'], dismissed: false }] })!.notices![keys.buildTool]!;
  expect(several.message).toBe('Choose a build tool to start project import.\nFound in a: gradle, maven, gradle, subproject, Ant\nFound in b: maven, bazel');
  expect(several.actions!.map(action => action.title)).toEqual(['Choose Build Tool…', 'Use maven']);
  // A name the setting does not take is shown and not offered; a folder without a name or candidates still blocks.
  const unknown = notify(rules(), kotlinMethods.importStatus, { blockedFolders: [{ reason: 'ambiguousBuildSystem', dismissed: true, candidates: ['Gradle', 7, '', null] }, { reason: 'ambiguousBuildSystem' }] })!;
  expect(unknown.notices![keys.buildTool]).toStrictEqual({ severity: 'warning', message: 'Choose a build tool to start project import.\nFound: Gradle', actions: [{ title: 'Choose Build Tool…', request: { method: 'intellij/reloadWorkspace' } }] });
  // Never more buttons than a notice has.
  const many = notify(rules(), kotlinMethods.importStatus, { blockedFolders: [conflict({ dismissed: true, candidates: ['gradle', 'maven', 'bazel', 'jps', 'gomodules', 'gomodules-recursive-scan', 'json'] })] })!;
  expect(many.notices![keys.buildTool]!.actions).toHaveLength(kotlinChooserLimit);
});

test('a malformed import status changes nothing', () => {
  const session = rules();
  notify(session, kotlinMethods.importStatus, { blockedFolders: [conflict()] });
  for (const value of [...malformed, {}, { blockedFolders: 'none' }, { blockedFolders: {} }]) expect(notify(session, kotlinMethods.importStatus, value)).toBeUndefined();
  // Entries that are not folders are left out, the rest counts.
  expect(notify(session, kotlinMethods.importStatus, { blockedFolders: [null, 'x', 3, { reason: 4 }, [], conflict({ candidates: 'gradle', dismissed: 'yes' })] }))
    .toStrictEqual({ context: { [keys.context]: 'Build tool required' }, notices: { [keys.buildTool]: undefined } });
  expect(notify(session, kotlinMethods.importStatus, { blockedFolders: [null, {}] })!.context).toStrictEqual({ [keys.context]: undefined });
});

test('the status asked for after the start counts only when the server has not said it itself', () => {
  expect(kotlinStatusQuery).toStrictEqual({ method: 'intellij/workspaceImportStatus', params: {} });
  const asked = rules();
  expect(asked.queries).toStrictEqual([kotlinStatusQuery]);
  expect(asked.answered(kotlinMethods.importStatus, { blockedFolders: [conflict({ dismissed: true })] })!.context).toStrictEqual({ [keys.context]: 'Build tool required' });
  expect(asked.answered(kotlinMethods.importState, { phase: 'FINISHED' })).toBeUndefined();
  for (const value of malformed) expect(asked.answered(kotlinMethods.importStatus, value)).toBeUndefined();
  // statusBar.test.ts: "does not overwrite a live snapshot with the response to an older refresh".
  const told = rules();
  notify(told, kotlinMethods.importStatus, { blockedFolders: [] });
  expect(told.answered(kotlinMethods.importStatus, { blockedFolders: [conflict({ dismissed: true })] })).toBeUndefined();
});

const entry = (name: unknown, index = 0, extra: Record<string, unknown> = {}) => ({ name, command: { title: String(name), command: 'applyFix', arguments: [{ sessionId: 4, index }] }, ...extra });

test('a menu of the server is a notice whose buttons send the entry\'s command back', () => {
  const session = rules();
  const first = notify(session, kotlinMethods.chooseAction, { title: 'Import', entries: [entry('java.util.List'), entry('java.awt.List', 1, { kind: 'import' })] });
  expect(first).toStrictEqual({ notices: { [`${keys.chooser}.1`]: { severity: 'info', message: 'Import', actions: [
    { title: 'java.util.List', command: { command: 'applyFix', arguments: [{ sessionId: 4, index: 0 }] } },
    { title: 'java.awt.List', command: { command: 'applyFix', arguments: [{ sessionId: 4, index: 1 }] } }] } } });
  // The next menu takes the place of the one before it, under a key of its own: the same menu can be asked twice.
  const second = notify(session, kotlinMethods.chooseAction, { title: 'Import', entries: [entry('java.util.List')] })!;
  expect(Object.keys(second.notices!)).toEqual([`${keys.chooser}.1`, `${keys.chooser}.2`]);
  expect(second.notices![`${keys.chooser}.1`]).toBeUndefined();
  expect(second.notices![`${keys.chooser}.2`]!.actions).toHaveLength(1);
  // A command without arguments is sent without them; a title that is missing gets plain words.
  expect(notify(rules(), kotlinMethods.chooseAction, { entries: [{ name: ' Extract ', command: { command: 'extract', arguments: 'none' } }] })).toStrictEqual({
    notices: { [`${keys.chooser}.1`]: { severity: 'info', message: 'Choose an action', actions: [{ title: 'Extract', command: { command: 'extract' } }] } } });
});

test('a menu longer than a notice shows the first entries and says so, and malformed entries are left out', () => {
  const long = notify(rules(), kotlinMethods.chooseAction, { title: 'Surround with', entries: Array.from({ length: 9 }, (_, index) => entry(`choice ${index}`, index)) })!.notices![`${keys.chooser}.1`]!;
  expect(long.message).toBe(`Surround with\nShowing the first ${kotlinChooserLimit} of 9 choices.`);
  expect(long.actions!.map(action => action.title)).toEqual(['choice 0', 'choice 1', 'choice 2', 'choice 3', 'choice 4', 'choice 5']);
  const mixed = notify(rules(), kotlinMethods.chooseAction, { title: 'x'.repeat(5000), entries: [null, 'text', {}, { name: 'no command' }, { name: 'bad', command: { command: 7 } }, { name: '', command: { command: 'a' } },
    { name: 3, command: { command: 'a' } }, { name: 'empty', command: { command: '' } }, entry('n'.repeat(500))] })!.notices![`${keys.chooser}.1`]!;
  expect(mixed.message).toHaveLength(1000);
  expect(mixed.actions).toHaveLength(1);
  expect(mixed.actions![0].title).toHaveLength(200);
  const session = rules();
  for (const value of [...malformed, {}, { entries: 'none' }, { title: 'Empty', entries: [] }, { title: 'Useless', entries: [{}, null] }]) expect(notify(session, kotlinMethods.chooseAction, value)).toBeUndefined();
  // Nothing was shown, so the first real menu is still the first.
  expect(Object.keys(notify(session, kotlinMethods.chooseAction, { title: 'Import', entries: [entry('a')] })!.notices!)).toEqual([`${keys.chooser}.1`]);
});

const asks = (answer: ToolAnswer | Promise<ToolAnswer>) => answer as Extract<ToolAnswer, { question: unknown }>;
const location = (uri: string, line: number) => ({ uri, range: { start: { line, character: 2 }, end: { line, character: 9 } } });

test('conflicts of a fix are a question, and only the choice to continue continues', () => {
  const answer = asks(rules().requests![kotlinMethods.showConflicts]({ title: 'Problems Detected', continueLabel: 'Continue', cancelLabel: 'Cancel', revealLabel: 'Open', documentChangedLabel: 'The file changed',
    conflicts: [
      { messages: ['Method foo is used in a library', 'Class Bar becomes abstract'], location: location('file:///work/shop/src/My%20Car.kt', 11) },
      { messages: ['Class Car already extends class Vehicle\nand will not compile'], location: null },
      { messages: [], location: location('jar:file:///libs/a.jar!/b/Lib.class', 0) }] }));
  expect(answer.question).toStrictEqual({ answers: ['Continue', 'Cancel'],
    message: 'Problems Detected\nMy Car.kt:12: Method foo is used in a library. Class Bar becomes abstract.\nClass Car already extends class Vehicle and will not compile.\nLib.class:1: -' });
  expect(answer.result(0)).toStrictEqual({ decision: 'continue' });
  // The second button, a dismissed question and one that ran out of time.
  for (const choice of [1, undefined, -1, 2]) expect(answer.result(choice)).toStrictEqual({ decision: 'cancel' });
  expect(answer.signal).toBeUndefined();
});

test('a malformed question about conflicts is answered with cancel, and a long one is cut', () => {
  for (const value of [...malformed, {}, { title: 'T', conflicts: 'many' }]) expect(rules().requests![kotlinMethods.showConflicts](value)).toStrictEqual({ result: { decision: 'cancel' } });
  // Words the server left out are replaced; rows that are not conflicts are shown as having no message.
  const bare = asks(rules().requests![kotlinMethods.showConflicts]({ conflicts: [null, { messages: 'text' }, { messages: [3, 'Real one'], location: { uri: 4 } }, { messages: ['x'], location: location('not a uri', -4) },
    { messages: ['y'], location: { uri: 'file:///a/B.kt', range: { start: { line: 1.5 } } } }], continueLabel: ' ', cancelLabel: 9 }));
  expect(bare.question).toStrictEqual({ message: 'Conflicts\n-\n-\nReal one.\nx.\ny.', answers: ['Continue', 'Cancel'] });
  const many = asks(rules().requests![kotlinMethods.showConflicts]({ title: 'Problems', continueLabel: 'c'.repeat(400), cancelLabel: 'Stop', conflicts: Array.from({ length: kotlinConflictRows + 7 }, (_, index) => ({ messages: [`Conflict ${index}`] })) }));
  expect(many.question.message.split('\n')).toHaveLength(kotlinConflictRows + 2);
  expect(many.question.message.endsWith('\nand 7 more')).toBe(true);
  expect(many.question.answers).toEqual(['c'.repeat(200), 'Stop']);
  const wide = asks(rules().requests![kotlinMethods.showConflicts]({ title: 'Problems', conflicts: Array.from({ length: 40 }, () => ({ messages: ['m'.repeat(900)] })) }));
  expect(wide.question.message).toHaveLength(4096);
});

// showConflictsModel.test.ts, `conflictMessage`
test('the messages of one conflict become one line of statements', () => {
  expect(conflictMessage(['Method foo is used in a library', 'Class Bar becomes abstract'])).toBe('Method foo is used in a library. Class Bar becomes abstract.');
  expect(conflictMessage(['The class is final.', 'Which member do you mean?', 'Read this:'])).toBe('The class is final. Which member do you mean? Read this:');
  expect(conflictMessage(['Class Car already extends class Vehicle\nand will not compile'])).toBe('Class Car already extends class Vehicle and will not compile.');
  expect(conflictMessage([])).toBe('');
  expect(conflictMessage(['', '  \n  '])).toBe('');
});

test('a line of build output is a line of the log', () => {
  const session = rules();
  expect(notify(session, kotlinMethods.buildOutput, { buildId: 'b1', category: 'stdout', line: '> Task :compileKotlin' })).toStrictEqual({ log: ['> Task :compileKotlin'] });
  for (const value of [...malformed, {}, { buildId: 'b1', line: '' }, { line: 4 }]) expect(notify(session, kotlinMethods.buildOutput, value)).toBeUndefined();
});

test('no notification of the server can throw, whatever it carries', () => {
  const session = rules();
  for (const [method, rule] of Object.entries(session.notifications!)) for (const value of [...malformed, {}, { message: {}, tool: [], phase: {}, entries: [[]], blockedFolders: [[]], line: {} }])
    expect(() => rule(value), method).not.toThrow();
});

test('settings the server could not read are named when it has started', () => {
  expect(rules().started!()).toBeUndefined();
  expect(rules({ 'intellij.buildTool': 'gradle', intellij: { projects: [{ type: 'maven', path: 'file:///work/shop/pom.xml' }] } }).started!()).toBeUndefined();
  const signal = rules({ 'intellij.jdkForSymbolResolution': 21, 'intellij.buildTool': 4, 'intellij.projects': [{ type: 'ant', path: 'file:///work/shop' }] }).started!() as ToolSignal;
  const detail = '`intellij.jdkForSymbolResolution` must be a string; `intellij.buildTool` for file:///work/shop must be a string; `intellij.projects` entry #0 has an unsupported "type": "ant"';
  expect(signal).toStrictEqual({ log: [`Ignoring invalid settings: ${detail}`], notices: { [keys.settings]: { severity: 'warning', message: `Kotlin ignored invalid settings: ${detail}.` } } });
});

test('a settings change needs a restart, a re-import or nothing', () => {
  const project = { type: 'maven', path: 'file:///work/shop/pom.xml' };
  // Nothing that reaches the server changed.
  expect(kotlinSettingsChange({}, {})).toBe('none');
  expect(kotlinSettingsChange(undefined, null)).toBe('none');
  expect(kotlinSettingsChange({ 'intellij.buildTool': 'gradle' }, { intellij: { buildTool: 'gradle' } })).toBe('none');
  expect(kotlinSettingsChange({}, { 'jetbrains.kotlin.hints.parameters': false, 'intellij.trace.server': 'verbose' })).toBe('none');
  expect(kotlinSettingsChange({}, { 'intellij.buildTool': null, 'intellij.projects': [], 'intellij.completion': {} })).toBe('none');
  // The three settings the initialization options are made from.
  expect(kotlinSettingsChange({}, { 'intellij.buildTool': 'gradle' })).toBe('reload');
  expect(kotlinSettingsChange({ 'intellij.buildTool': 'gradle' }, { 'intellij.buildTool': '' })).toBe('reload');
  expect(kotlinSettingsChange({ 'intellij.buildTool': 'gradle' }, {})).toBe('reload');
  expect(kotlinSettingsChange({}, { intellij: { jdkForSymbolResolution: '/usr/lib/jvm/java-25' } })).toBe('reload');
  expect(kotlinSettingsChange({ 'intellij.projects': [project] }, { 'intellij.projects': [{ ...project, 'java-home': '/jdk' }] })).toBe('reload');
  // lspClient.ts: removing an entry that was never sent leaves the server with what it has.
  expect(kotlinSettingsChange({ 'intellij.projects': [project, { type: 'ant', path: 'x' }] }, { 'intellij.projects': [project] })).toBe('none');
  // lspClient.ts: while a value cannot be read, the extension reports it and applies nothing.
  expect(kotlinSettingsChange({}, { 'intellij.buildTool': 'gradle', 'intellij.projects': [{ type: 'ant', path: 'x' }] })).toBe('none');
  expect(kotlinSettingsChange({}, { 'intellij.additionalJvmArgs': ['-Xmx4g'], 'intellij.jdkForSymbolResolution': 21 })).toBe('none');
  // What only a new process applies, alone or together with the others.
  for (const name of kotlinRestartSettings) {
    const value = name === 'intellij.completion' ? { caseSensitivity: 'none' } : name === 'intellij.dev.serverPort' ? 9999 : name === 'intellij.additionalJvmArgs' ? ['-Xmx4g'] : 'value';
    expect(kotlinSettingsChange({}, { [name]: value }), name).toBe('restart');
    expect(kotlinSettingsChange({ [name]: value }, { 'intellij.buildTool': 'maven' }), name).toBe('restart');
    expect(kotlinSettingsChange({ [name]: value }, { [name]: value }), name).toBe('none');
  }
  expect(kotlinSettingsChange({ 'intellij.buildTool': 'gradle' }, { 'intellij.buildTool': 'maven', 'intellij.serverPath': '/opt/kotlin-lsp' })).toBe('restart');
  // The same value, written as one dotted key, as nested objects or half and half.
  expect(kotlinSettingsChange({ 'intellij.completion.caseSensitivity': 'none' }, { intellij: { completion: { caseSensitivity: 'none' } } })).toBe('none');
  expect(kotlinSettingsChange({ 'intellij.completion': { caseSensitivity: 'none' } }, { 'intellij.completion.caseSensitivity': 'firstLetter' })).toBe('restart');
  expect(kotlinSettingsChange({ http: { proxy: 'http://proxy:8080' } }, { 'http.proxy': 'http://proxy:8080' })).toBe('none');
  expect(kotlinSettingsChange({ 'intellij.dev.serverPort': 9999 }, { intellij: { dev: { serverPort: 9998 } } })).toBe('restart');
  // The dotted key is the one that is read, so a nested value under it changes nothing.
  expect(kotlinSettingsChange({ 'intellij.serverPath': '/a' }, { 'intellij.serverPath': '/a', intellij: { serverPath: '/b' } })).toBe('none');
  // A setting whose name only begins the same is another setting.
  expect(kotlinSettingsChange({}, { 'intellij.serverPathology': 'x', 'http.proxyStrictSSL': false })).toBe('none');
  // The two settings the extension also sends as options are not made into options here yet, so there is nothing to send again.
  expect(kotlinSettingsChange({}, { 'intellij.disableRocksDBWriteAheadLog': true, 'intellij.forkFromWorkspace': '/work/other' })).toBe('none');
});

test('a settings change is offered with the extension\'s words and the one button that applies it', () => {
  expect(kotlinSettingsChangeNotice('Kotlin', 'reload')).toStrictEqual({ severity: 'warning', message: 'Kotlin: settings changed. Reload Workspace to apply the changes.',
    actions: [{ title: 'Reload Workspace', request: { method: 'intellij/reloadWorkspace' } }] });
  expect(kotlinSettingsChangeNotice('Kotlin', 'restart')).toStrictEqual({ severity: 'warning', message: 'Kotlin: settings changed. Restart Language Server to apply the changes.',
    actions: [{ title: 'Restart Language Server', restart: true }] });
  expect(isKotlinReload(kotlinSettingsChangeNotice('Kotlin', 'reload').actions![0])).toBe(true);
});

test('the re-import sends the initialization options made from the settings as they are now', () => {
  expect(kotlinReloadParams({}, ['file:///work/shop'])).toStrictEqual({ params: { initializationOptions: { buildTools: {}, projects: [] } }, problems: [] });
  expect(kotlinReloadParams({ 'intellij.buildTool': 'gradle', 'intellij.jdkForSymbolResolution': '/jdk/21' }, ['file:///work/shop'], { defaultSdk: '/jdk/25', lazyIntentions: true })).toStrictEqual({
    params: { initializationOptions: { defaultSdk: '/jdk/21', lazyIntentions: true, buildTools: { 'file:///work/shop': 'gradle' }, projects: [] } }, problems: [] });
  // What is sent beside the settings stays when the settings say nothing about it.
  expect(kotlinReloadParams({ 'intellij.buildTool': 'gradle' }, ['file:///a'], { defaultSdk: '/jdk/25' }).params.initializationOptions).toStrictEqual({ defaultSdk: '/jdk/25', buildTools: { 'file:///a': 'gradle' }, projects: [] });
  expect(kotlinReloadParams({ 'intellij.buildTool': 4 }, ['file:///a'])).toStrictEqual({ params: { initializationOptions: { buildTools: {}, projects: [] } }, problems: ['`intellij.buildTool` for file:///a must be a string'] });
  for (const value of malformed) expect(kotlinReloadParams(value, []).params).toStrictEqual({ initializationOptions: { buildTools: {}, projects: [] } });
});

test('a failed re-import is reported unless the server cancelled it', () => {
  expect(kotlinReloadFailure(Object.assign(new Error('Import is already running'), { code: -32603 }))).toBe('Failed to reload the workspace: Import is already running');
  expect(kotlinReloadFailure({ code: -32803, message: 'Request failed' })).toBe('Failed to reload the workspace: Request failed');
  expect(kotlinReloadFailure(new Error('Connection is closed'))).toBe('Failed to reload the workspace: Connection is closed');
  expect(kotlinReloadFailure('gone')).toBe('Failed to reload the workspace: gone');
  expect(kotlinReloadFailure(undefined)).toBe('Failed to reload the workspace: undefined');
  // `RequestCancelled` and `ServerCancelled`.
  expect(kotlinReloadFailure(Object.assign(new Error('cancelled'), { code: -32800 }))).toBeUndefined();
  expect(kotlinReloadFailure({ code: -32802, message: 'No license' })).toBeUndefined();
  expect(kotlinReloadFailure({ code: '-32802', message: 'text code' })).toBe('Failed to reload the workspace: text code');
});

test('a failed start is named by its cause, in the extension\'s order', () => {
  expect(kotlinStartLimit).toBe(60_000);
  expect(kotlinLicenceExitCode).toBe(7);
  const licence = kotlinStartFailure('Kotlin', { exitCode: 7, signal: null, timedOut: true, rejection: 'Rejected' })!;
  expect(licence).toStrictEqual({ kind: 'licence', retry: false,
    message: 'Kotlin could not start the language server over a licensing problem: this build may have expired, or the license does not cover it. Update Kotlin or check the license, then try again.' });
  expect(kotlinStartFailure('Kotlin', { exitCode: 1, timedOut: true, rejection: 'Workspace is locked by another process\nEULA text\nmore' })).toStrictEqual({ kind: 'rejected', retry: false, message: 'Workspace is locked by another process' });
  expect(kotlinStartFailure('Kotlin', { rejection: '  \nsecond line' })).toStrictEqual({ kind: 'rejected', retry: false, message: 'the initialize request was rejected' });
  expect(kotlinStartFailure('Kotlin', { timedOut: true, exitCode: null, signal: 'SIGTERM' })).toStrictEqual({ kind: 'timeout', retry: true, message: 'Timed out waiting 60 seconds for the language server to initialize' });
  expect(kotlinStartFailure('Kotlin', { exitCode: 1, signal: null })).toStrictEqual({ kind: 'exited', retry: true, message: 'Language server process exited before initialization (code=1, signal=null)' });
  expect(kotlinStartFailure('Kotlin', { exitCode: null, signal: 'SIGKILL' })).toStrictEqual({ kind: 'exited', retry: true, message: 'Language server process exited before initialization (code=null, signal=SIGKILL)' });
  expect(kotlinStartFailure('Kotlin', { exitCode: 0 })!.kind).toBe('exited');
  expect(kotlinStartFailure('Kotlin', {})).toBeUndefined();
  expect(kotlinStartFailure('Kotlin', { exitCode: null, signal: null, timedOut: false })).toBeUndefined();
});

test('the index folder is the one the server states, and nothing that should not be deleted', () => {
  const index = path.resolve('/home/me/.cache/kotlin-lsp/index/abc');
  expect(kotlinIndexDirectory({ textDocumentSync: 2, experimental: { indexDir: index } })).toBe(index);
  expect(kotlinIndexDirectory({ experimental: { indexDir: `${index}${path.sep}..${path.sep}abc${path.sep}` } })).toBe(index);
  for (const indexDir of [undefined, null, '', 'relative/index', './index', '/', '//', '/..', 7, {}, ['/a/b'], `/${'a'.repeat(5000)}`]) expect(kotlinIndexDirectory({ experimental: { indexDir } }), String(indexDir).slice(0, 20)).toBeUndefined();
  for (const value of [...malformed, {}, { experimental: null }, { experimental: 'x' }, { experimental: [] }]) expect(kotlinIndexDirectory(value)).toBeUndefined();
});

// What was copied from the VS Code Kotlin extension and the server is compared with the copy
// in `vendor`, so a newer submodule that changes it fails here and not in someone's project.
const upstream = fileURLToPath(new URL('../../../../../vendor/kotlin-lsp', import.meta.url));
const source = (file: string) => readFileSync(path.join(upstream, file), 'utf8');
const core = 'vscode-extension-core/src';
const vendored = existsSync(path.join(upstream, core, 'lspClient.ts'));

test.skipIf(!vendored)('the methods, shapes and wording of the import are the ones vendor/kotlin-lsp states', () => {
  const client = source(`${core}/lspClient.ts`), model = source(`${core}/statusBarModel.ts`), bar = source(`${core}/statusBar.ts`), state = source(`${core}/workspaceImport.ts`);
  expect(client).toContain(`new NotificationType<ImportLogParams>('${kotlinMethods.importLog}')`);
  expect(client.split(`'${kotlinMethods.importStatus}'`)).toHaveLength(3);
  expect(state.split(`'${kotlinMethods.importState}'`)).toHaveLength(3);
  // The flags of an import log message, and what the extension does with them.
  for (const field of ['message: string;', 'tool?: string;', 'failed?: boolean;', 'succeeded?: boolean;', 'started?: boolean;']) expect(client).toContain(field);
  expect(client).toContain("setBuildError(p.tool ?? 'Build');");
  expect(client).toContain('} else if (p.succeeded) {\n      clearBuildError();');
  expect(bar).toContain('buildStatusBarItem.text = `$(warning) ${tool}: Build Error`;');
  const failed = notify(rules(), kotlinMethods.importLog, { message: 'm', tool: 'Gradle', failed: true })!;
  expect(failed.context![keys.context]).toBe('$(warning) ${tool}: Build Error'.replace('$(warning) ', '').replace('${tool}', 'Gradle'));
  // The phases, and that the notification is the end of a cycle.
  expect(state).toContain("export type WorkspaceImportPhase = 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED' | 'FAILED';");
  expect(state).toContain('Sent once per import cycle, when the cycle ends');
  for (const phase of ['IN_PROGRESS', 'FINISHED', 'CANCELLED', 'FAILED']) expect(notify(rules(), kotlinMethods.importState, { phase })).toBeDefined();
  // Blocked: the reason, the fields, the words and the one button.
  expect(model).toContain("(folder) => folder.reason === 'ambiguousBuildSystem',");
  for (const field of ['folderUri: string;', 'reason: string;', 'candidates: string[];', 'dismissed: boolean;', 'blockedFolders: BlockedWorkspaceFolder[];']) expect(model).toContain(field);
  expect(model).toContain('promptDismissed: conflicts.some((folder) => folder.dismissed),');
  expect(model).toContain("statusHeading = '$(circle-slash) Build tool required';");
  const blocked = notify(rules(), kotlinMethods.importStatus, { blockedFolders: [conflict({ dismissed: true })] })!;
  expect(blocked.context![keys.context]).toBe('Build tool required');
  const notice = blocked.notices![keys.buildTool]!;
  expect(client).toContain(`.showWarningMessage('${notice.message.split('\n')[0]}', CHOOSE_BUILD_TOOL_ACTION)`);
  expect(client).toContain(`const CHOOSE_BUILD_TOOL_ACTION = '${notice.actions![0].title}';`);
  expect(client).toContain('if (choice === CHOOSE_BUILD_TOOL_ACTION) {\n          void reloadWorkspace({ showConfirmation: false });');
  // The values the extension's own test blocks with are ones the setting takes.
  expect(source(`${core}/statusBar.test.ts`)).toContain("candidates: ['gradle', 'maven'],");
  expect(source('kotlin-vscode/README.md')).toContain('`intellij.buildTool` to prefer a specific project importer (e.g., `maven` or `gradle`)');
  // The status is asked for with an empty object, and its answer yields to a live notification.
  expect(client).toContain('client.sendRequest(workspaceImportStatusRequest, {})');
  expect(model).toContain('if (publishedRevision === 0) apply(snapshot);');
  // Invalid settings.
  expect(client).toContain('logInfo(`Ignoring invalid settings: ${detail}`);');
  expect(client).toContain('`${extensionDisplayName()} ignored invalid settings: ${detail}.`');
  expect(client).toContain("const detail = problems.map((p) => p.message).join('; ');");
});

test.skipIf(!vendored)('the capabilities, the menu and the conflicts are the ones vendor/kotlin-lsp states', () => {
  const feature = source(`${core}/intellijExtensionsClientFeature.ts`), extensions = source(`${core}/intellijExtensions.ts`), conflicts = source(`${core}/showConflictsModel.ts`);
  const commands = source('features-impl/common/src/com/jetbrains/ls/api/features/impl/common/modcommands/ModCommandData.kt');
  // Every capability the extension declares is either declared here or named as left out.
  const declared = /capabilities\.experimental = \{\s*\.\.\.experimental,([^}]+)\}/.exec(feature)?.[1].match(/\w+(?=: true)/g);
  expect([...kotlinDeclaredCapabilities, ...kotlinUndeclaredCapabilities].sort()).toEqual([...declared!].sort());
  for (const name of [...kotlinDeclaredCapabilities, ...kotlinUndeclaredCapabilities]) expect(commands).toContain(`\`${name}\``);
  // The menu is a notification, and the entry picked goes back as a command.
  expect(extensions).toContain(`const chooseActionMenuNotification = new NotificationType<ShowChooseActionMenuParams>(\n  '${kotlinMethods.chooseAction}',\n);`);
  expect(extensions).toContain('type ChooseActionMenuEntry = { name: string; command: Command };');
  expect(extensions).toContain("await client.sendRequest('workspace/executeCommand', {\n      command: picked.command.command,\n      arguments: picked.command.arguments,\n    });");
  expect(commands).toContain(`NotificationType("${kotlinMethods.chooseAction}", ShowChooseActionMenuParams.serializer())`);
  expect(commands).toContain('data class ChooseActionMenuEntry(val name: String, val command: Command, val kind: String? = null)');
  expect(commands).toContain('data class ShowChooseActionMenuParams(val title: String, val entries: List<ChooseActionMenuEntry>)');
  // The conflicts are a request, answered with one of two words.
  expect(extensions).toContain(`const showConflictsRequest = new RequestType<ShowConflictsParams, ShowConflictsResult, void>(\n  '${kotlinMethods.showConflicts}',\n);`);
  expect(extensions).toContain("type ShowConflictsDecision = 'continue' | 'cancel';");
  expect(extensions).toContain('type ShowConflictsResult = { decision: ShowConflictsDecision };');
  expect(extensions).toContain('type Conflict = { messages: string[]; location?: Location | null };');
  for (const field of ['title: string;', 'conflicts: Conflict[];', 'continueLabel: string;', 'cancelLabel: string;']) expect(extensions).toContain(field);
  expect(extensions).toContain('return `${fileName}:${location.range.start.line + 1}`;');
  expect(extensions).toContain("message = '-';");
  expect(commands).toContain(`"${kotlinMethods.showConflicts}",`);
  expect(commands).toContain('@SerialName("continue") CONTINUE,');
  expect(commands).toContain('@SerialName("cancel") CANCEL,');
  expect(conflicts).toContain('const TERMINAL_PUNCTUATION_PATTERN = /[.!?;:]$/;');
  // Build output.
  const build = source(`${core}/buildTaskModel.ts`);
  expect(build).toContain(`export const BUILD_OUTPUT_NOTIFICATION = '${kotlinMethods.buildOutput}';`);
  expect(build).toContain(`export const BUILD_COMMAND = '${kotlinCommands.build}';`);
  for (const field of ['buildId: string;', "category: 'stdout' | 'stderr' | 'system';", 'line: string;']) expect(build).toContain(field);
});

test.skipIf(!vendored)('the reload, restart and start rules are the ones vendor/kotlin-lsp states', () => {
  const client = source(`${core}/lspClient.ts`), extension = source(`${core}/extension.ts`), startup = source(`${core}/launchedServerStartup.ts`), settingsRules = source(`${core}/initializationSettings.ts`);
  // Which settings are sent again, and which need a new process.
  const constant = (name: string) => new RegExp(`const ${name} = '([^']+)';`).exec(client)?.[1];
  const list = (name: string) => new RegExp(`const ${name} = \\[([^\\]]+)\\];`).exec(client)?.[1].match(/OPT_\w+/g)?.map(constant);
  expect([...kotlinReloadSettings]).toEqual(list('INITIALIZATION_OPTION_SETTINGS'));
  expect([...kotlinRestartSettings]).toEqual([...list('LAUNCH_SETTINGS')!, ...list('SESSION_SETTINGS')!]);
  expect(client).toContain('const RESTART_SETTINGS = [...LAUNCH_SETTINGS, ...SESSION_SETTINGS];');
  expect(settingsRules).toContain("if (!change.affectsLaunch && !change.affectsInitializationOptions) return 'none';");
  expect(settingsRules).toContain("return change.affectsLaunch ? 'restart' : 'reload';");
  expect(client).toContain("if (action === 'reload' && payload === sentInitializationOptions) return;");
  expect(client).toContain('reportSettingsProblems({ problems });\n    if (problems.length > 0) return;');
  // The offer.
  expect(client).toContain("restart: 'Restart Language Server',");
  expect(client).toContain("reload: 'Reload Workspace',");
  expect(client).toContain('`${extensionDisplayName()}: settings changed. ${label} to apply the changes.`');
  // The re-import: the method, its one parameter, and what a failure says.
  expect(extension).toContain(`const ReloadWorkspaceRequest = new RequestType<ReloadWorkspaceParams, null, void>(\n  '${kotlinMethods.reloadWorkspace}',\n);`);
  expect(extension).toContain('interface ReloadWorkspaceParams {\n  initializationOptions: Record<string, unknown>;\n}');
  expect(extension).toContain('client.sendRequest(ReloadWorkspaceRequest, { initializationOptions })');
  expect(extension).toContain('const initializationOptions = buildInitializationOptions();');
  expect(client).toContain('options: { ...contributedInitializationOptions, ...builtinInitializationOptions },');
  expect(extension).toContain('(e.code === LSPErrorCodes.RequestCancelled || e.code === LSPErrorCodes.ServerCancelled)');
  expect(extension).toContain('await window.showErrorMessage(`Failed to reload the workspace: ${message}`);');
  // A failed start.
  expect(client).toContain(`const LAUNCHED_SERVER_START_TIMEOUT_MS = ${String(kotlinStartLimit).replace(/(\d+)(\d{3})$/, '$1_$2')};`);
  expect(startup).toContain(`const LICENSING_EXIT_CODE = ${kotlinLicenceExitCode};`);
  expect(startup).toContain('return this.exit?.code === LICENSING_EXIT_CODE;');
  const licence = kotlinStartFailure('Kotlin', { exitCode: kotlinLicenceExitCode })!.message;
  for (const words of [' could not start the language server over a licensing problem: the bundled build may have expired, or the license does not cover it. Update the extension or check the license, then try again.'])
    expect(client).toContain(words);
  for (const words of [' could not start the language server over a licensing problem: ', ' build may have expired, or the license does not cover it. Update ', ' or check the license, then try again.']) {
    expect(client).toContain(words);
    expect(licence).toContain(words);
  }
  expect(client).toContain("return error.message.split('\\n')[0]?.trim() || 'the initialize request was rejected';");
  expect(startup).toContain('`Timed out waiting ${this.startupTimeoutMs / 1000} seconds for the language server to initialize`');
  expect(startup).toContain('`Language server process exited before initialization (code=${this.exit.code}, signal=${this.exit.signal})`');
  // The order: licence, then the server's own answer, then the limit, then the exit.
  const order = ['if (launchedServerAttempt?.licensingFailure) {', 'if (rejection !== undefined) throw new Error(rejection);', 'throw launchedServerAttempt?.startupError(cause) ?? cause;'].map(text => client.indexOf(text));
  expect(order.every(index => index > 0) && order[0] < order[1] && order[1] < order[2]).toBe(true);
  expect(startup.indexOf('if (this.timedOut) {')).toBeLessThan(startup.indexOf('if (this.exit && !this.killedWhileRunning) {'));
  // The extension starts a server whose first start failed again for none of these reasons.
  expect(client).toContain('if (await shouldSuppressRestart(launchedServerState, LAUNCHED_SERVER_EXIT_WAIT_MS)) {\n        return { action: CloseAction.DoNotRestart, handled: true };');
});

test.skipIf(!vendored)('the commands and the index folder are the ones vendor/kotlin-lsp states', () => {
  const client = source(`${core}/lspClient.ts`), extension = source(`${core}/extension.ts`);
  expect(extension).toContain(`await commands.executeCommand('${kotlinCommands.exportWorkspace}', rootPath);`);
  expect(source('features-impl/kotlin/src/com/jetbrains/ls/imports/LSExportWorkspaceCommandDescriptorProvider.kt')).toContain(`name = "${kotlinCommands.exportWorkspace}",`);
  expect(source(`${core}/decompiler.ts`)).toContain(`response = await commands.executeCommand('${kotlinCommands.decompile}', uri.toString());`);
  expect(source('features-impl/common/src/com/jetbrains/ls/api/features/impl/common/decompiler/LSDecompileCommandDescriptorProvider.kt')).toContain(`name = "${kotlinCommands.decompile}",`);
  expect(source(`${core}/buildTask.ts`)).toContain("'workspace/executeCommand',\n      { command: BUILD_COMMAND, arguments: [{ ...args, buildId }] },");
  expect(client).toContain('const experimental = client?.initializeResult?.capabilities?.experimental as\n    | { indexDir?: string }');
  expect(client).toContain('await rm(indexDir, { recursive: true, force: true });');
});
