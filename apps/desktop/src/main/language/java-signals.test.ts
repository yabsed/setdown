import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { gradleChecksumPrompt, gradleChecksumsSetting, gradleCompatibilityPage, gradleJava, gradleJavaHomeSetting, gradleWrapperPage, javaActionable,
  javaActivating, javaButton, javaClientCommand, javaClientCommands, javaDownloadPage, javaEvent, javaEvents, javaExtendedCapabilities, javaFeatureStatus,
  javaImportErrors, javaMethods, javaProgressReport, javaRules, javaServerNotification, javaStatusLine, javaStatusRule, type JavaAction } from './java-signals';
import { mergeLanguageSettings } from './language-settings';
import type { InstalledJava } from './tool-runtime';
import type { ToolNotice, ToolSignal } from './tool-signals';

const vendor = path.resolve(__dirname, '../../../../../vendor');
const source = (file: string) => readFileSync(path.join(vendor, 'vscode-java', file), 'utf8');
const client = source('src/standardLanguageClient.ts');
const protocol = source('src/protocol.ts');
const commands = source('src/commands.ts');

const jdk = (major: number, home: string, ...sources: InstalledJava['sources']): InstalledJava => ({ home, major, sources });
const installed = [jdk(25, '/jdks/25'), jdk(21, '/sdkman/21', 'SDKMAN'), jdk(17, '/env/17', 'JAVA_HOME'), jdk(11, '/system/11')];
const notice = (signal: ToolSignal | undefined): ToolNotice => {
  const notices = Object.values(signal?.notices ?? {});
  expect(notices).toHaveLength(1);
  return notices[0]!;
};
const actions = (signal: ToolSignal | undefined): JavaAction[] => notice(signal).actions ?? [];
/** What a tool may send in place of what the protocol says. None of it may throw. */
const malformed: unknown[] = [undefined, null, 0, 7, '', 'text', true, [], [1, 2], {}, { type: 7 }, { type: {} }, { message: 5 }, { eventType: '300' },
  { eventType: 300 }, { eventType: 300, data: 'text' }, { eventType: 400, data: [] }, { severity: 1 }, { severity: 3, message: 'x', commands: 'none' },
  { severity: 3, message: 'x', commands: [null, 5, {}, { title: 5, command: {} }, { title: 'a', command: 'b', arguments: 'c' }] },
  { command: 5 }, { command: gradleChecksumPrompt }, { command: gradleChecksumPrompt, arguments: [5, {}] }, { command: javaClientCommands.chooseImports },
  { command: javaClientCommands.chooseImports, arguments: ['file:///A.java', [{ candidates: [null, 5, { fullyQualifiedName: 7 }] }]] },
  { id: 5, task: {}, status: [] }, { id: 'a' }];

test('the method names are the ones the extension listens to', () => {
  for (const method of [javaMethods.status, javaMethods.actionable, javaMethods.event, javaMethods.clientCommand, javaMethods.notify, javaMethods.projectUpdate])
    expect(protocol).toContain(`'${method}'`);
  expect(protocol).toMatch(/namespace ExecuteClientCommandRequest \{\s*export const type = new RequestType<ExecuteCommandParams, any, void>\('workspace\/executeClientCommand'\)/);
  expect(protocol).toMatch(/namespace ServerNotification \{\s*export const type = new NotificationType<ExecuteCommandParams>\('workspace\/notify'\)/);
  expect(protocol).toMatch(/new NotificationType<TextDocumentIdentifier> \('java\/projectConfigurationUpdate'\)/);
});

test('vscode-java 1.59.0 shows $/progress and has no language/progressReport, which is why the capability is not declared', () => {
  expect(protocol).toContain(`new NotificationType<ProgressReport>('$/progress')`);
  for (const file of ['src/protocol.ts', 'src/standardLanguageClient.ts', 'src/extension.ts']) {
    expect(source(file)).not.toContain(javaMethods.progressReport);
    expect(source(file)).not.toContain('progressReportProvider');
  }
  expect(javaExtendedCapabilities).not.toHaveProperty('progressReportProvider');
});

test('a starting server is at work until it says it has started', () => {
  const rules = javaRules(installed)({ name: 'jdtls', root: '/project', settings: {} });
  expect(rules.started?.()).toEqual({ progress: { [javaMethods.status]: javaActivating } });
  expect(source('src/extension.ts')).toContain(`serverStatusBarProvider.setBusy("${javaActivating}")`);
  const status = rules.notifications![javaMethods.status];
  expect(status({ type: 'Starting', message: '45% Starting Java Language Server' })).toEqual({ progress: { [javaMethods.status]: '45% Starting Java Language Server' } });
  expect(status({ type: 'Started', message: 'Ready' })).toEqual({ progress: { [javaMethods.status]: undefined }, context: { [javaStatusLine]: 'Ready' } });
  expect(status({ type: 'ServiceReady', message: 'ServiceReady' })).toEqual({ progress: { [javaMethods.status]: undefined } });
});

test('the status words and the cases are the extension\'s', () => {
  for (const type of ['ServiceReady', 'Started', 'Error', 'ProjectStatus', 'Starting', 'Message']) expect(client).toContain(`case '${type}':`);
  expect(client).toMatch(/case 'Started':\s*this\.status = ClientStatus\.started;\s*serverStatus\.updateServerStatus\(ServerStatusKind\.ready\);/);
  expect(client).toMatch(/case 'Error':\s*this\.status = ClientStatus\.error;\s*serverStatus\.updateServerStatus\(ServerStatusKind\.error\);/);
  expect(client).toMatch(/if \(report\.message === "WARNING"\) \{\s*serverStatus\.updateServerStatus\(ServerStatusKind\.warning\);/);
  expect(client).toMatch(/else if \(report\.message === "OK"\) \{\s*this\.status = ClientStatus\.started;\s*serverStatus\.errorResolved\(\);\s*serverStatus\.updateServerStatus\(ServerStatusKind\.ready\);/);
  expect(client).toMatch(/case 'ServiceReady':[\s\S]*?apiManager\.resolveServerReadyPromise\(\);[\s\S]*?activationProgressNotification\.hide\(\);/);
  expect(client).toMatch(/case 'Starting':\s*case 'Message':\s*\/\/ message goes to progress report instead\s*break;/);
  const bar = source('src/serverStatusBarProvider.ts');
  for (const word of ['Ready', 'Warning', 'Error']) expect(bar).toContain(`${javaStatusLine}: ${word}\``);
  expect(client).toContain(`showWarningMessage("${javaImportErrors}"`);
});

test('an error stands until the projects are reported as OK', () => {
  // serverStatus.ts: Ready does not replace an error, only `errorResolved` clears it.
  expect(source('src/serverStatus.ts')).toMatch(/if \(newStatus === ServerStatusKind\.error \|\| newStatus === ServerStatusKind\.warning\) \{\s*hasError = true;\s*\} else if \(hasError\) \{\s*return;/);
  const status = javaStatusRule();
  expect(status({ type: 'Error', message: 'Initialization failed' })).toEqual({ progress: { [javaMethods.status]: undefined },
    context: { [javaStatusLine]: 'Error' }, notices: { [javaMethods.status]: { severity: 'error', message: 'Initialization failed' } } });
  expect(status({ type: 'Started', message: 'Ready' })).toEqual({ progress: { [javaMethods.status]: undefined } });
  // The notice already says what failed, so the extension's general sentence is not added.
  expect(status({ type: 'ServiceReady' })).toEqual({ progress: { [javaMethods.status]: undefined } });
  expect(status({ type: 'ProjectStatus', message: 'WARNING' })).toEqual({ context: { [javaStatusLine]: 'Warning' } });
  expect(status({ type: 'ProjectStatus', message: 'OK' })).toEqual({ context: { [javaStatusLine]: 'Ready' }, notices: { [javaMethods.status]: undefined } });
  expect(status({ type: 'Started' })).toEqual({ progress: { [javaMethods.status]: undefined }, context: { [javaStatusLine]: 'Ready' } });
});

test('when the server is ready with an error nobody explained, the import is said to have had errors', () => {
  const warned = javaStatusRule();
  warned({ type: 'ProjectStatus', message: 'WARNING' });
  expect(warned({ type: 'ServiceReady' })).toEqual({ progress: { [javaMethods.status]: undefined }, notices: { [javaMethods.status]: { severity: 'warning', message: javaImportErrors } } });
  const silent = javaStatusRule();
  expect(silent({ type: 'Error' })).toEqual({ progress: { [javaMethods.status]: undefined }, context: { [javaStatusLine]: 'Error' } });
  expect(notice(silent({ type: 'ServiceReady' }))).toEqual({ severity: 'warning', message: javaImportErrors });
  expect(silent({ type: 'ProjectStatus', message: 'OK' })?.notices).toEqual({ [javaMethods.status]: undefined });
  expect(silent({ type: 'ServiceReady' })).toEqual({ progress: { [javaMethods.status]: undefined } });
});

test('each session keeps its own status', () => {
  const factory = javaRules(installed);
  const first = factory({ name: 'jdtls', root: '/a', settings: {} }).notifications![javaMethods.status];
  const second = factory({ name: 'jdtls', root: '/b', settings: {} }).notifications![javaMethods.status];
  first({ type: 'Error', message: 'failed' });
  expect(first({ type: 'Started' })?.context).toBeUndefined();
  expect(second({ type: 'Started' })?.context).toEqual({ [javaStatusLine]: 'Ready' });
});

test('a status that says nothing shows nothing', () => {
  const status = javaStatusRule();
  expect(status({ type: 'Message', message: 'Updating workspace folders: Adding 1 folder(s), removing 0 folders.' })).toEqual({ log: ['Updating workspace folders: Adding 1 folder(s), removing 0 folders.'] });
  for (const params of [{ type: 'Starting' }, { type: 'Starting', message: '  ' }, { type: 'Message', message: 5 }, { type: 'ProjectStatus', message: 'OTHER' }, { type: 'Unknown', message: 'x' }, ...malformed])
    expect(status(params)).toBeUndefined();
  expect(status({ type: 'Starting', message: 'x'.repeat(5000) })?.progress?.[javaMethods.status]).toHaveLength(4096);
  expect(notice(status({ type: 'Error', message: 'y'.repeat(5000) })).message).toHaveLength(4096);
});

test('a progress report is one line for each task, removed when the task is complete', () => {
  const key = `${javaMethods.progressReport}:42`;
  expect(javaProgressReport({ id: '42', task: 'Building', status: '45% Building', totalWork: 100, workDone: 45, complete: false })).toEqual({ progress: { [key]: '45% Building' } });
  expect(javaProgressReport({ id: '42', task: 'Importing Maven project(s)', subTask: 'app' })).toEqual({ progress: { [key]: 'Importing Maven project(s) - app' } });
  expect(javaProgressReport({ id: '42', task: 'Building', status: '100% Building', complete: true })).toEqual({ progress: { [key]: undefined } });
  expect(javaProgressReport({ task: 'Building', complete: false })).toEqual({ progress: { [`${javaMethods.progressReport}:Building`]: 'Building' } });
  expect(javaProgressReport({ id: '42', status: 's'.repeat(5000) })?.progress?.[key]).toHaveLength(4096);
  for (const params of malformed) expect(javaProgressReport(params)).toBeUndefined();
});

const buildFile = 'file:///project/pom.xml';
const buildFileQuestion = { severity: 3, message: 'A build file was modified. Do you want to synchronize the Java classpath/configuration?', commands: [
  { title: 'Yes', command: 'java.projectConfiguration.status', arguments: [{ uri: buildFile }, 1] },
  { title: 'Always', command: 'java.projectConfiguration.status', arguments: [{ uri: buildFile }, 2] },
  { title: 'Never', command: 'java.projectConfiguration.status', arguments: [{ uri: buildFile }, 0] }] };

test('a changed build file is a question whose answers do what the extension does', () => {
  const update = { title: 'Always', notify: { method: 'java/projectConfigurationUpdate', params: { uri: buildFile } } };
  expect(notice(javaActionable(buildFileQuestion))).toEqual({ severity: 'info', message: buildFileQuestion.message, actions: [
    { title: 'Yes', notify: { method: 'java/projectConfigurationUpdate', params: { uri: buildFile } } },
    { title: 'Always', setting: { name: 'java.configuration.updateBuildConfiguration', value: 'automatic' }, next: update },
    { title: 'Never', setting: { name: 'java.configuration.updateBuildConfiguration', value: 'disabled' } }] });
  // setProjectConfigurationUpdate: the name of the status is written, and unless it is "disabled" the build file is read again.
  expect(commands).toContain(`PROJECT_CONFIGURATION_STATUS = 'java.projectConfiguration.status'`);
  expect(client).toMatch(/registerCommand\(Commands\.PROJECT_CONFIGURATION_STATUS, async \(uri, status\) => \{\s*await setProjectConfigurationUpdate\(this\.languageClient, uri, status\);/);
  expect(client).toMatch(/const section = 'configuration\.updateBuildConfiguration';\s*const st = FeatureStatus\[status\];\s*config\.update\(section, st\)/);
  expect(client).toMatch(/if \(status !== FeatureStatus\.disabled\) \{\s*await projectConfigurationUpdate\(languageClient, uri\);/);
  expect(protocol).toMatch(/enum FeatureStatus \{[^}]*?disabled = 0,[^}]*?interactive = 1,[^}]*?automatic = 2,\s*\}/);
  expect(javaFeatureStatus).toEqual(['disabled', 'interactive', 'automatic']);
  // projectConfigurationUpdate: one `{ uri }` argument becomes one `java/projectConfigurationUpdate` with `{ uri }`.
  const utils = source('src/standardLanguageClientUtils.ts');
  expect(utils).toMatch(/else if \("uri" in uris\) \{\s*resources\.push\(Uri\.parse\(uris\.uri\)\);/);
  expect(utils).toMatch(/sendNotification\(ProjectConfigurationUpdateRequest\.type, \{\s*uri: resources\[0\]\.toString\(\),\s*\}\)/);
  expect(source('package.json')).toMatch(/"java\.configuration\.updateBuildConfiguration": \{[^}]*"enum": \[\s*"disabled",\s*"interactive",\s*"automatic"\s*\],\s*"default": "interactive"/);
});

test('the same question about another build file is another notice, and about the same file the same one', () => {
  const other = { ...buildFileQuestion, commands: buildFileQuestion.commands.map(command => ({ ...command, arguments: [{ uri: 'file:///project/build.gradle' }, command.arguments[1]] })) };
  const keys = [buildFileQuestion, other, buildFileQuestion].map(params => Object.keys(javaActionable(params)?.notices ?? {})[0]);
  expect(keys[0]).not.toBe(keys[1]);
  expect(keys[0]).toBe(keys[2]);
  expect(keys[0]).toContain(buildFile);
});

test('a button whose command has no rule, or whose arguments are not what the extension reads, is left out and logged', () => {
  expect(javaButton('Yes', 'java.projectConfiguration.status', [buildFile, 1])).toBeUndefined();
  expect(javaButton('Yes', 'java.projectConfiguration.status', [{ uri: buildFile }, 'automatic'])).toBeUndefined();
  expect(javaButton('Yes', 'java.projectConfiguration.status', [{ uri: buildFile }, 3])).toBeUndefined();
  expect(javaButton('Yes', 'java.projectConfiguration.status', [])).toBeUndefined();
  expect(javaButton('Enable', 'java.compile.nullAnalysis.setMode', ['automatic'])).toBeUndefined();
  expect(javaButton('Open', 'workbench.action.openSettings', [])).toBeUndefined();
  // JVMConfigurator of jdt.ls: "Open Settings" runs a command that opens the settings editor.
  expect(commands).toContain(`RUNTIME_VALIDATION_OPEN = 'java.runtimeValidation.open'`);
  expect(source('src/standardLanguageClient.ts')).toMatch(/registerCommand\(Commands\.RUNTIME_VALIDATION_OPEN, \(\) => \{\s*commands\.executeCommand\("workbench\.action\.openSettings", "java\.configuration\.runtimes"\)/);
  const signal = javaActionable({ severity: 1, message: 'Invalid runtime for JavaSE-21', commands: [{ title: 'Open Settings', command: 'java.runtimeValidation.open' }] });
  expect(notice(signal)).toEqual({ severity: 'error', message: 'Invalid runtime for JavaSE-21' });
  expect(signal?.log).toEqual(['No rule for the button "Open Settings" (java.runtimeValidation.open) of: Invalid runtime for JavaSE-21']);
});

test('the answers about null analysis write the mode by its name', () => {
  const signal = javaActionable({ severity: 3, message: 'Null annotation types have been detected in the project. Do you wish to enable null analysis for this project?', commands: [
    { title: 'Enable', command: 'java.compile.nullAnalysis.setMode', arguments: [2] }, { title: 'Disable', command: 'java.compile.nullAnalysis.setMode', arguments: [0] }] });
  expect(actions(signal)).toEqual([{ title: 'Enable', setting: { name: 'java.compile.nullAnalysis.mode', value: 'automatic' } },
    { title: 'Disable', setting: { name: 'java.compile.nullAnalysis.mode', value: 'disabled' } }]);
  expect(commands).toContain(`NULL_ANALYSIS_SET_MODE = 'java.compile.nullAnalysis.setMode'`);
  expect(client).toMatch(/function setNullAnalysisStatus\(status: FeatureStatus\) \{\s*const config = getJavaConfiguration\(\);\s*const section = 'compile\.nullAnalysis\.mode';\s*const st = FeatureStatus\[status\];\s*config\.update\(section, st\)/);
});

test('generating sources from proto files is a command of the server', () => {
  const signal = javaActionable({ severity: 3, message: 'Would you like to generate Java source files out of your proto files?', commands: [
    { title: 'Generate', command: 'java.protobuf.generateSources', arguments: [['app', 'lib']] }] });
  expect(actions(signal)).toEqual([{ title: 'Generate', command: { command: 'java.protobuf.generateSources', arguments: [['app', 'lib']] } }]);
  // The extension has no handler for it: it is in the list of commands the server announces.
  expect(client).not.toContain('protobuf.generateSources');
  expect(source('test/standard-mode-suite/extension.test.ts')).toContain('"java.protobuf.generateSources"');
});

test('the severity decides how a notification is shown, and a log message is only logged', () => {
  expect(protocol).toMatch(/enum MessageType \{[\s\S]*?error = 1,[\s\S]*?warning = 2,[\s\S]*?info = 3,[\s\S]*?log = 4,\s*\}/);
  expect(client).toMatch(/case MessageType\.Log:\s*show = logNotification;/);
  expect([1, 2, 3].map(severity => notice(javaActionable({ severity, message: 'm' })).severity)).toEqual(['error', 'warning', 'info']);
  expect(javaActionable({ severity: 4, message: 'only for the log', commands: [{ title: 'Yes', command: 'java.projectConfiguration.status', arguments: [{ uri: buildFile }, 1] }] })).toEqual({ log: ['only for the log'] });
  for (const severity of [0, 5, '1', undefined, null]) expect(javaActionable({ severity, message: 'm' })).toBeUndefined();
});

test('a malformed notification with buttons shows what can be read of it and never throws', () => {
  for (const params of malformed.filter(value => !(value && typeof value === 'object' && 'message' in value && typeof value.message === 'string'))) expect(javaActionable(params)).toBeUndefined();
  expect(notice(javaActionable({ severity: 3, message: 'x', commands: 'none' }))).toEqual({ severity: 'info', message: 'x' });
  const odd = javaActionable({ severity: 3, message: 'x', commands: [null, 5, {}, { title: 5, command: {} }, { title: 'a', command: 'b', arguments: 'c' }] });
  expect(notice(odd)).toEqual({ severity: 'info', message: 'x' });
  expect(odd?.log).toEqual(['No rule for the button "a" (b) of: x']);
  const many = Array.from({ length: 30 }, (_, index) => ({ title: `Enable ${index}`, command: 'java.compile.nullAnalysis.setMode', arguments: [2] }));
  expect(actions(javaActionable({ severity: 2, message: 'm', commands: many }))).toHaveLength(8);
  expect(notice(javaActionable({ severity: 2, message: 'm'.repeat(9000) })).message).toHaveLength(4096);
});

test('the event numbers are the extension\'s', () => {
  expect(protocol).toMatch(/enum EventType \{\s*classpathUpdated = 100,\s*projectsImported = 200,\s*projectsDeleted = 210,\s*incompatibleGradleJdkIssue = 300,\s*upgradeGradleWrapper = 400,\s*sourceInvalidated = 500,\s*\}/);
  expect(javaEvents).toEqual({ classpathUpdated: 100, projectsImported: 200, projectsDeleted: 210, incompatibleGradleJdkIssue: 300, upgradeGradleWrapper: 400, sourceInvalidated: 500 });
  expect(protocol).toMatch(/interface GradleCompatibilityInfo \{\s*projectUri: string;\s*message: string;\s*highestJavaVersion: string;\s*recommendedGradleVersion: string;\s*\}/);
  expect(protocol).toMatch(/interface UpgradeGradleWrapperInfo \{\s*projectUri: string;\s*message: string;\s*recommendedGradleVersion: string;\s*\}/);
  expect(protocol).toMatch(/affectedRootPaths: \{ \[key: string\]: boolean \};/);
});

const mismatch = { eventType: 300, data: { projectUri: 'file:///project/', message: 'Can\'t use Java 25 and Gradle 8.5 to import Gradle project project.', highestJavaVersion: '21', recommendedGradleVersion: '9.2.0' } };

test('a Gradle that cannot run on the JDK offers the JDK the extension would choose', () => {
  // Of 21 (SDKMAN), 17 (JAVA_HOME) and 11: after the sort by version, the sort by source puts JAVA_HOME first.
  expect(client).toMatch(/const highestJavaVersion = Number\(info\.highestJavaVersion\);\s*let runtimes = await listJdks\(true\);\s*runtimes = runtimes\.filter\(runtime => \{\s*return runtime\.version\.major <= highestJavaVersion;\s*\}\);\s*sortJdksByVersion\(runtimes\);\s*sortJdksBySource\(runtimes\);/);
  expect(gradleJava(installed, '21')).toEqual(jdk(17, '/env/17', 'JAVA_HOME'));
  expect(gradleJava([jdk(25, '/jdks/25'), jdk(21, '/jdks/21'), jdk(17, '/jdks/17')], 21)?.home).toBe('/jdks/21');
  expect(gradleJava(installed, '8')).toBeUndefined();
  for (const highest of [undefined, null, '', 'new', {}, [], NaN, true]) expect(gradleJava(installed, highest)).toBeUndefined();
  const signal = javaEvent(mismatch, installed, {}, 'linux');
  expect(Object.keys(signal?.notices ?? {})).toEqual([`${javaMethods.event}:300`]);
  const reimport = { title: 'Upgrade Gradle to 9.2.0', command: { command: 'java.project.import' } };
  expect(notice(signal)).toEqual({ severity: 'error', message: mismatch.data.message, actions: [
    { title: 'Upgrade Gradle to 9.2.0', command: { command: 'java.project.upgradeGradle', arguments: ['file:///project/', '9.2.0'] }, next: reimport },
    { title: 'Use Java 17 as Gradle JVM', setting: { name: 'java.import.gradle.java.home', value: '/env/17', then: 'restart' } },
    { title: 'Learn More', link: 'https://docs.gradle.org/current/userguide/compatibility.html' }] });
});

test('the words and the setting of the Gradle notice are the extension\'s', () => {
  expect(client).toContain('const USE_JAVA = "Use Java ";');
  expect(client).toContain('const AS_GRADLE_JVM = " as Gradle JVM";');
  expect(client).toContain('const UPGRADE_GRADLE = "Upgrade Gradle to ";');
  expect(client).toContain('const GET_JDK = "Get the Java Development Kit";');
  expect(client).toContain(`const GRADLE_IMPORT_JVM = "${gradleJavaHomeSetting}";`);
  expect(client).toMatch(/options\.push\(UPGRADE_GRADLE \+ info\.recommendedGradleVersion\);\s*if \(!runtimes\.length\) \{\s*options\.push\(GET_JDK\);\s*\} else \{\s*options\.push\(USE_JAVA \+ runtimes\[0\]\.version\.major \+ AS_GRADLE_JVM\);/);
  expect(client).toContain(`window.showErrorMessage(\`\${message} [Learn More](${gradleCompatibilityPage})\`, ...options)`);
  expect(client).toMatch(/await workspace\.getConfiguration\(\)\.update\(GRADLE_IMPORT_JVM, newJavaHome, ConfigurationTarget\.Global\);[\s\S]{0,120}commands\.executeCommand\(Commands\.IMPORT_PROJECTS_CMD\);/);
  expect(client).toContain('runtimes[0]?.homedir');
});

test('without a JDK that fits, the Gradle notice leads to a JDK download', () => {
  const none = javaEvent(mismatch, [jdk(25, '/jdks/25')], {}, 'linux');
  expect(actions(none)[1]).toEqual({ title: 'Get the Java Development Kit', link: 'https://developers.redhat.com/products/openjdk/download/' });
  expect(actions(javaEvent(mismatch, [], {}, 'darwin'))[1]).toEqual({ title: 'Get the Java Development Kit', link: 'https://adoptopenjdk.net/' });
  expect(actions(javaEvent({ eventType: 300, data: { ...mismatch.data, highestJavaVersion: {} } }, installed, {}, 'win32'))[1]?.title).toBe('Get the Java Development Kit');
  const requirements = source('src/requirements.ts');
  expect(requirements).toContain(`let jdkUrl = '${javaDownloadPage('linux')}?sc_cid=`);
  expect(requirements).toMatch(/if \(process\.platform === 'darwin'\) \{\s*jdkUrl = 'https:\/\/adoptopenjdk\.net\/';/);
  expect(javaDownloadPage('darwin')).toBe('https://adoptopenjdk.net/');
});

test('upgrading Gradle turns the wrapper on if it was off, upgrades, and imports again when projects are found automatically', () => {
  const utils = source('src/standardLanguageClientUtils.ts');
  expect(utils).toMatch(/const useWrapper = workspace\.getConfiguration\(\)\.get<boolean>\("java\.import\.gradle\.wrapper\.enabled"\);\s*if \(!useWrapper\) \{\s*await workspace\.getConfiguration\(\)\.update\("java\.import\.gradle\.wrapper\.enabled", true, ConfigurationTarget\.Workspace\);/);
  expect(utils).toContain('commands.executeCommand<string>(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.UPGRADE_GRADLE_WRAPPER, projectUri, version, token)');
  expect(utils).toMatch(/if \(result\) \{[\s\S]*?commands\.executeCommand\(Commands\.IMPORT_PROJECTS_CMD\);\s*\}/);
  expect(commands).toContain(`UPGRADE_GRADLE_WRAPPER = 'java.project.upgradeGradle'`);
  expect(commands).toContain(`IMPORT_PROJECTS = 'java.project.import'`);
  expect(client).toMatch(/if \(getJavaConfiguration\(\)\.get<string>\("import\.projectSelection"\) === "automatic"\) \{\s*return await commands\.executeCommand<void>\(Commands\.EXECUTE_WORKSPACE_COMMAND, Commands\.IMPORT_PROJECTS\);/);
  expect(source('package.json')).toMatch(/"java\.import\.projectSelection": \{[^}]*"default": "automatic"/);

  const title = 'Upgrade Gradle to 9.2.0';
  const upgrade = { title, command: { command: 'java.project.upgradeGradle', arguments: ['file:///project/', '9.2.0'] } };
  const reimport = { title, command: { command: 'java.project.import' } };
  expect(actions(javaEvent(mismatch, installed, { java: { import: { gradle: { wrapper: { enabled: false } } } } }, 'linux'))[0])
    .toEqual({ title, setting: { name: 'java.import.gradle.wrapper.enabled', value: true }, next: { ...upgrade, next: reimport } });
  expect(actions(javaEvent(mismatch, installed, { 'java.import.gradle.wrapper.enabled': true, 'java.import.projectSelection': 'automatic' }, 'linux'))[0]).toEqual({ ...upgrade, next: reimport });
  expect(actions(javaEvent(mismatch, installed, { 'java.import.projectSelection': 'manual' }, 'linux'))[0]).toEqual(upgrade);
});

test('a Gradle wrapper that should be upgraded is a warning with the extension\'s two answers', () => {
  const signal = javaEvent({ eventType: 400, data: { projectUri: 'file:///project/', message: 'The Gradle wrapper of project is out of date.', recommendedGradleVersion: '9.2.0' } }, installed, {}, 'linux');
  expect(Object.keys(signal?.notices ?? {})).toEqual([`${javaMethods.event}:400`]);
  expect(notice(signal)).toEqual({ severity: 'warning', message: 'The Gradle wrapper of project is out of date.', actions: [
    { title: 'Upgrade to 9.2.0', command: { command: 'java.project.upgradeGradle', arguments: ['file:///project/', '9.2.0'] }, next: { title: 'Upgrade to 9.2.0', command: { command: 'java.project.import' } } },
    { title: "Don't show again", dismiss: true }] });
  expect(client).toMatch(/const option = `Upgrade to \$\{upgradeInfo\.recommendedGradleVersion\}`;\s*window\.showWarningMessage\(upgradeInfo\.message, option, "Don't show again"\)/);
  expect(client).toContain('await upgradeGradle(upgradeInfo.projectUri, upgradeInfo.recommendedGradleVersion);');
  expect(client).toContain('context.globalState.update("java.neverShowUpgradeWrapperNotification", true);');
  // Without a project or a version there is nothing to upgrade, only the warning.
  expect(actions(javaEvent({ eventType: 400, data: { message: 'Out of date.' } }, installed))).toEqual([{ title: "Don't show again", dismiss: true }]);
});

test('events the extension only passes on are lines of the log', () => {
  expect(javaEvent({ eventType: 100, data: 'file:///project/' }, installed)).toEqual({ log: ['Classpath updated: file:///project/'] });
  expect(javaEvent({ eventType: 200, data: ['file:///a/', 5, 'file:///b/'] }, installed)).toEqual({ log: ['Java projects imported: file:///a/, file:///b/'] });
  expect(javaEvent({ eventType: 210, data: ['file:///a/'] }, installed)).toEqual({ log: ['Java projects deleted: file:///a/'] });
  expect(javaEvent({ eventType: 500, data: { affectedRootPaths: { '/m2/a.jar': true, '/m2/b.jar': false } } }, installed)).toEqual({ log: ['Source attachment changed: /m2/a.jar, /m2/b.jar'] });
  expect(javaEvent({ eventType: 200, data: Array.from({ length: 500 }, (_, index) => `file:///${index}/`) }, installed)?.log?.[0]).toContain('file:///99/');
  expect(javaEvent({ eventType: 200, data: Array.from({ length: 500 }, (_, index) => `file:///${index}/`) }, installed)?.log?.[0]).not.toContain('file:///100/');
});

test('an event without what the extension reads from it, or of a kind it does not read, shows nothing', () => {
  for (const params of [...malformed, { eventType: 100 }, { eventType: 200, data: [] }, { eventType: 210, data: 'x' }, { eventType: 500, data: {} }, { eventType: 400, data: { projectUri: 'file:///p/' } },
    { eventType: 300, data: { projectUri: 'file:///p/', recommendedGradleVersion: '9' } }, { eventType: 600, data: { message: 'Preview features' } }])
    expect(javaEvent(params, installed, {}, 'linux')).toBeUndefined();
  // A mismatch whose project is not named still offers a JDK.
  expect(actions(javaEvent({ eventType: 300, data: { message: 'm', highestJavaVersion: '21' } }, installed, {}, 'linux')).map(action => action.title)).toEqual(['Use Java 17 as Gradle JVM', 'Learn More']);
});

const wrapper = '/project/gradle/wrapper/gradle-wrapper.jar';
const sha256 = '41c8aa7a337a44af18d8cda0d632ebba469aef34f3041827624ef5c1a4e4419d';

test('an unknown Gradle wrapper is asked about, and the answer goes into the list of checksums', () => {
  const signal = javaServerNotification({ command: 'gradle/checksum/prompt', arguments: [wrapper, sha256] }, { java: { imports: { gradle: { wrapper: { checksums: [{ sha256: 'aa', allowed: true }] } } } } });
  expect(Object.keys(signal?.notices ?? {})).toEqual([`gradle/checksum/prompt:${sha256}`]);
  expect(notice(signal)).toEqual({ severity: 'error', message: `Security Warning! The gradle wrapper '${wrapper}' [sha256 '${sha256}'] could be malicious. Should it be trusted?`, actions: [
    { title: 'Do not trust', setting: { name: 'java.imports.gradle.wrapper.checksums', value: [{ sha256: 'aa', allowed: true }, { sha256, allowed: false }] } },
    { title: 'Trust', setting: { name: 'java.imports.gradle.wrapper.checksums', value: [{ sha256: 'aa', allowed: true }, { sha256, allowed: true }] } },
    { title: 'Learn More', link: 'https://github.com/redhat-developer/vscode-java/wiki/Gradle-Support#suspicious.wrapper' }] });
  expect(actions(javaServerNotification({ command: gradleChecksumPrompt, arguments: [wrapper, sha256] }))[1]).toEqual({ title: 'Trust', setting: { name: gradleChecksumsSetting, value: [{ sha256, allowed: true }] } });
  // A checksum that is already in the list is not written a second time.
  const known = [{ sha256, allowed: false }];
  expect(actions(javaServerNotification({ command: gradleChecksumPrompt, arguments: [wrapper, sha256] }, { [gradleChecksumsSetting]: known }))[1]).toEqual({ title: 'Trust', setting: { name: gradleChecksumsSetting, value: known } });
  expect(actions(javaServerNotification({ command: gradleChecksumPrompt, arguments: [wrapper, sha256] }, { [gradleChecksumsSetting]: 'none' }))[0]).toEqual({ title: 'Do not trust', setting: { name: gradleChecksumsSetting, value: [{ sha256, allowed: false }] } });
});

test('the checksum question is the extension\'s', () => {
  const settings = source('src/settings.ts');
  expect(client).toContain(`const GRADLE_CHECKSUM = "${gradleChecksumPrompt}";`);
  expect(client).toMatch(/registerCommand\(GRADLE_CHECKSUM, \(wrapper: string, sha256: string\) => \{\s*setGradleWrapperChecksum\(wrapper, sha256\);/);
  expect(client).toMatch(/onNotification\(ServerNotification\.type, \(params\) => \{\s*commands\.executeCommand\(params\.command, \.\.\.params\.arguments\);/);
  expect(settings).toContain(`const allow = 'Trust';`);
  expect(settings).toContain(`const disallow = 'Do not trust';`);
  expect(settings).toContain(`Security Warning! The gradle wrapper '\${wrapper}'`);
  expect(settings).toContain(`[sha256 '\${sha256}'] [could be malicious](${gradleWrapperPage}). Should it be trusted?`);
  expect(settings).toContain(`const key = "${gradleChecksumsSetting}";`);
  expect(settings).toMatch(/const entry = property\.filter\(p => \(p\.sha256 === sha256\)\);\s*if \(entry === null \|\| entry\.length === 0\) \{\s*property\.push\(\{ sha256: sha256, allowed: allowed \}\);/);
});

test('another server notification, or a checksum question without its two texts, shows nothing', () => {
  for (const params of [...malformed, { command: 'other', arguments: [wrapper, sha256] }, { command: gradleChecksumPrompt, arguments: [wrapper] }, { command: gradleChecksumPrompt, arguments: ['', sha256] }])
    expect(javaServerNotification(params, {})).toBeUndefined();
});

test('the server is told that no bundles changed', () => {
  expect(javaClientCommand({ command: '_java.reloadBundles.command', arguments: [] })).toEqual({ result: [] });
  expect(javaClientCommand({ command: javaClientCommands.reloadBundles })).toEqual({ result: [] });
  expect(commands).toContain(`REFRESH_BUNDLES_COMMAND = "${javaClientCommands.reloadBundles}"`);
  expect(source('src/extension.ts')).toMatch(/registerCommand\(Commands\.REFRESH_BUNDLES_COMMAND, \(\) => \{\s*return getBundlesToReload\(\);/);
  expect(source('src/plugin.ts')).toMatch(/export function getBundlesToReload\(\): string\[\] \{[\s\S]*?if \(isContributedPartUpdated\(previousContributions, currentContributions\)\) \{\s*return currentContributions;\s*\}\s*return \[\];\s*\}/);
  expect(client).toMatch(/onRequest\(ExecuteClientCommandRequest\.type, \(params\) => \{\s*return commands\.executeCommand\(params\.command, \.\.\.params\.arguments\);/);
});

test('an ambiguous import is a question about the first type, answered with the candidate chosen', () => {
  const list = { fullyQualifiedName: 'java.util.List', id: 'java.util.List@1' };
  const awt = { fullyQualifiedName: 'java.awt.List', id: 'java.awt.List@2' };
  const answer = javaClientCommand({ command: 'java.action.organizeImports.chooseImports', arguments: ['file:///project/A.java',
    [{ candidates: [list, awt, null, { id: 'nameless' }], range: {} }, { candidates: [{ fullyQualifiedName: 'java.util.Date', id: 'd' }], range: {} }], false] });
  if (!('question' in answer)) throw new Error('A question was expected');
  expect(answer.question).toEqual({ message: `Choose type 'List' to import`, answers: ['java.util.List', 'java.awt.List'] });
  expect(answer.result(1)).toEqual([awt]);
  expect(answer.result(0)).toEqual([list]);
  // Dismissed, out of time, or a number that is no answer: as when the person closes the first list.
  for (const none of [undefined, 2, -1, 0.5, NaN]) expect(answer.result(none)).toEqual([]);
  const chooser = source('src/sourceAction.ts');
  expect(commands).toContain(`CHOOSE_IMPORTS = "${javaClientCommands.chooseImports}"`);
  expect(chooser).toContain('registerCommand(Commands.CHOOSE_IMPORTS, async (uri: string, selections: ImportSelection[], restoreExistingImports?: boolean) => {');
  expect(chooser).toContain(`const typeName = fullyQualifiedName.substring(fullyQualifiedName.lastIndexOf(".") + 1);`);
  expect(chooser).toContain("input.placeholder = `Choose type '${typeName}' to import`;");
  expect(chooser).toMatch(/chosen\.push\(pick \? pick\.origin : null\);\s*\} catch \(err\) \{\s*break;/);
  expect(protocol).toMatch(/interface ImportCandidate \{\s*fullyQualifiedName: string;\s*id: string;\s*\}/);
  expect(protocol).toMatch(/interface ImportSelection \{\s*candidates: ImportCandidate\[\];\s*range: Range;\s*\}/);
});

test('an import question nobody can answer, and a client command without a rule, are answered at once', () => {
  for (const args of [undefined, [], ['file:///A.java'], ['file:///A.java', []], ['file:///A.java', [{ candidates: [] }]], ['file:///A.java', [{ candidates: [null, 5, { fullyQualifiedName: 7 }] }]], ['file:///A.java', 'none']])
    expect(javaClientCommand({ command: javaClientCommands.chooseImports, arguments: args })).toEqual({ result: [] });
  expect(javaClientCommand({ command: 'editor.action.triggerParameterHints', arguments: [] })).toEqual({ result: null, signal: { log: ['No rule for the client command editor.action.triggerParameterHints'] } });
  for (const params of [undefined, null, 5, 'text', [], {}, { command: 5 }, { arguments: [] }]) expect(javaClientCommand(params)).toEqual({ result: null, signal: { log: ['No rule for the client command without a name'] } });
  const many = Array.from({ length: 200 }, (_, index) => ({ fullyQualifiedName: `p${index}.T`, id: `${index}` }));
  const capped = javaClientCommand({ command: javaClientCommands.chooseImports, arguments: ['file:///A.java', [{ candidates: many }]] });
  expect('question' in capped && capped.question.answers).toHaveLength(50);
});

test('only what the rules answer is declared, under the names the extension uses, beside what is already declared', () => {
  const extension = source('src/extension.ts');
  for (const name of Object.keys(javaExtendedCapabilities)) expect(extension).toMatch(new RegExp(`extendedClientCapabilities: \\{[\\s\\S]*?\\b${name}: true,`));
  expect(javaExtendedCapabilities).toEqual({ executeClientCommandSupport: true, gradleChecksumWrapperPromptSupport: true });
  const rules = javaRules(installed)({ name: 'jdtls', root: '/project', settings: {} });
  expect(rules.capabilities).toBeUndefined();
  expect(rules.initializationOptions).toEqual({ extendedClientCapabilities: { executeClientCommandSupport: true, gradleChecksumWrapperPromptSupport: true } });
  // What the Zed Java extension puts there stays, and what a person wrote wins.
  const zed = { bundles: ['/debug.jar'], extendedClientCapabilities: { classFileContentsSupport: true, resolveAdditionalTextEditsSupport: true, executeClientCommandSupport: false } };
  expect(mergeLanguageSettings(rules.initializationOptions, zed)).toEqual({ bundles: ['/debug.jar'], extendedClientCapabilities: {
    executeClientCommandSupport: false, gradleChecksumWrapperPromptSupport: true, classFileContentsSupport: true, resolveAdditionalTextEditsSupport: true } });
});

test('the rules of a session answer every message of the server, whatever it holds', async () => {
  const rules = javaRules(installed, 'linux')({ name: 'jdtls', root: '/project', settings: { 'java.import.gradle.wrapper.enabled': false } });
  expect(Object.keys(rules.notifications ?? {}).sort()).toEqual(['language/actionableNotification', 'language/eventNotification', 'language/progressReport', 'language/status', 'workspace/notify']);
  expect(Object.keys(rules.requests ?? {})).toEqual(['workspace/executeClientCommand']);
  for (const params of malformed) {
    for (const rule of Object.values(rules.notifications ?? {})) expect(() => rule(params)).not.toThrow();
    for (const rule of Object.values(rules.requests ?? {})) {
      const answer = await rule(params);
      expect(() => 'question' in answer ? [undefined, 0, 99].map(choice => answer.result(choice)) : answer.result).not.toThrow();
    }
  }
  // The settings of the session and the JDKs of the computer reach the rules.
  expect(actions(rules.notifications![javaMethods.event](mismatch)).map(action => 'setting' in action ? action.setting.name : action.title))
    .toEqual(['java.import.gradle.wrapper.enabled', 'java.import.gradle.java.home', 'Learn More']);
  expect(await rules.requests![javaMethods.clientCommand]({ command: javaClientCommands.reloadBundles })).toEqual({ result: [] });
  expect(notice(rules.notifications![javaMethods.notify]({ command: gradleChecksumPrompt, arguments: [wrapper, sha256] })).severity).toBe('error');
  expect(notice(rules.notifications![javaMethods.actionable](buildFileQuestion)).actions).toHaveLength(3);
  expect(rules.notifications![javaMethods.progressReport]({ id: '1', status: 'Building' })).toEqual({ progress: { 'language/progressReport:1': 'Building' } });
});
