import { setting } from './extension-rules';
import { preferredJava, type InstalledJava } from './tool-runtime';
import type { ToolAction, ToolAnswer, ToolNotice, ToolRulesFactory, ToolSignal } from './tool-signals';

// Eclipse jdt.ls says most of what a person needs to know outside the protocol: that it has
// started or failed, that a build file changed, that the project's Gradle cannot run on the JDK.
// Its VS Code extension (vscode-java 1.59.0) turns those messages into a status bar item and
// notifications with buttons. The rules in this file are carried over from that extension. Each
// one names the file and function it came from, so a newer `vendor/vscode-java` can be compared:
//   vendor/vscode-java/src/protocol.ts                     the method names, the numbers of each enum, the shapes
//   vendor/vscode-java/src/standardLanguageClient.ts       `registerLanguageClientActions`: status, events, notifications with
//                                                          buttons, client commands; `showGradleCompatibilityIssueNotification`,
//                                                          `setProjectConfigurationUpdate`, `setNullAnalysisStatus`, `showImportFinishNotification`
//   vendor/vscode-java/src/serverStatus.ts                 Ready, Warning, Error, and that an error stands until the projects are OK
//   vendor/vscode-java/src/serverStatusBarProvider.ts      the words of the status bar item
//   vendor/vscode-java/src/standardLanguageClientUtils.ts  `projectConfigurationUpdate`, `upgradeGradle`
//   vendor/vscode-java/src/settings.ts                     `setGradleWrapperChecksum`
//   vendor/vscode-java/src/sourceAction.ts                 the `java.action.organizeImports.chooseImports` handler
//   vendor/vscode-java/src/plugin.ts                       `getBundlesToReload`
//   vendor/vscode-java/src/requirements.ts                 `getJdkUrl`
//   vendor/vscode-java/src/extension.ts                    `extendedClientCapabilities`, "Activating..."
// What jdt.ls sends, and which capability makes it send it, was read from the jdt.ls 1.63.0 that
// Setdown installs (org.eclipse.jdt.ls.core). Its source is not under `vendor/`; the class is named
// where a rule rests on it.

type Json = Record<string, unknown>;
const record = (value: unknown): Json | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : undefined;
/** No text of the tool is shown longer than this. */
const textLimit = 4096;
/** Text the tool sent, cut to what may be shown. Anything that is not text, or is blank, is nothing. */
const text = (value: unknown, limit = textLimit): string | undefined => typeof value === 'string' && value.trim() ? value.slice(0, limit) : undefined;
/** A list the tool sent, cut to `limit` entries. Anything that is not a list is an empty one. */
const list = (value: unknown, limit: number): unknown[] => Array.isArray(value) ? value.slice(0, limit) : [];
const buttonLimit = 8;
const argumentLimit = 16;
const addressLimit = 100;

/** protocol.ts: what jdt.ls sends its editor outside the protocol, and the notification that tells it
 * to read a build file again. `language/progressReport` is not in vscode-java 1.59.0, which shows
 * `$/progress`: jdt.ls (`ProgressReporter.sendStatus`) sends it only to an editor that declared
 * `progressReportProvider`, and then in place of `$/progress`. */
export const javaMethods = {
  status: 'language/status',
  progressReport: 'language/progressReport',
  actionable: 'language/actionableNotification',
  event: 'language/eventNotification',
  clientCommand: 'workspace/executeClientCommand',
  notify: 'workspace/notify',
  projectUpdate: 'java/projectConfigurationUpdate',
} as const;

/** extension.ts `extendedClientCapabilities`, only the two these rules answer:
 *  `executeClientCommandSupport`         jdt.ls may send `workspace/executeClientCommand` (`javaClientCommand`).
 *  `gradleChecksumWrapperPromptSupport`  a Gradle wrapper it does not know is asked about in `workspace/notify`
 *                                        (`javaServerNotification`) instead of a `window/showMessage` without buttons.
 * They go into the initialization options under `extendedClientCapabilities`, beside what is already there. */
export const javaExtendedCapabilities = { executeClientCommandSupport: true, gradleChecksumWrapperPromptSupport: true } as const;

/** A button of a notice. A handler of the extension often does two things in a row: write a setting
 * and then tell jdt.ls, or run a command and then import the projects again. `next` is what follows
 * once the first effect is done; a command that answered with nothing is not followed. */
export type JavaAction = ToolAction & { next?: JavaAction };

/** serverStatusBarProvider.ts: the status bar item reads "Java: Ready", "Java: Warning" or "Java: Error". */
export const javaStatusLine = 'Java';
/** extension.ts: `serverStatusBarProvider.setBusy("Activating...")`, shown until jdt.ls says more. */
export const javaActivating = 'Activating...';
/** standardLanguageClient.ts `showImportFinishNotification`. */
export const javaImportErrors = 'Errors occurred during import of Java projects.';

/** standardLanguageClient.ts `registerLanguageClientActions`, the `StatusNotification` handler, with
 * serverStatus.ts `updateServerStatus` and `errorResolved`. One is made for each session, because an
 * error stands until jdt.ls reports the projects as OK:
 *  `Starting`       the extension shows nothing of it. jdt.ls reports the start of the server only
 *                   here ("45% Starting Java Language Server"), so the message is the line of work.
 *  `Message`        the extension shows nothing; the text goes to the log.
 *  `Started`        the projects are initialized: "Ready", unless an error stands.
 *  `ServiceReady`   jdt.ls answers every request: `serverReady()` of the extension resolves here, and
 *                   its activation progress ends. With an error standing it says the import had errors.
 *  `Error`          failed: "Error". The extension keeps the message in its trace; here it is the notice.
 *  `ProjectStatus`  `WARNING`: "Warning", and an error stands. `OK`: the error is resolved, "Ready". */
export function javaStatusRule(): (params: unknown) => ToolSignal | undefined {
  // serverStatus.ts `hasError`.
  let hasError = false;
  // The notice already holds what jdt.ls said about the error.
  let told = false;
  const key = javaMethods.status;
  return params => {
    const report = record(params);
    const message = text(report?.message);
    const signal: ToolSignal = {};
    switch (report?.type) {
      case 'Starting': return message ? { progress: { [key]: message } } : undefined;
      case 'Message': return message ? { log: [message] } : undefined;
      case 'Started':
        signal.progress = { [key]: undefined };
        if (!hasError) signal.context = { [javaStatusLine]: 'Ready' };
        return signal;
      case 'ServiceReady':
        signal.progress = { [key]: undefined };
        if (hasError && !told) signal.notices = { [key]: { severity: 'warning', message: javaImportErrors } };
        return signal;
      case 'Error':
        hasError = true; told = !!message;
        signal.progress = { [key]: undefined };
        signal.context = { [javaStatusLine]: 'Error' };
        if (message) signal.notices = { [key]: { severity: 'error', message } };
        return signal;
      case 'ProjectStatus':
        if (report?.message === 'WARNING') { hasError = true; return { context: { [javaStatusLine]: 'Warning' } }; }
        if (report?.message === 'OK') { hasError = false; told = false; return { context: { [javaStatusLine]: 'Ready' }, notices: { [key]: undefined } }; }
        return undefined;
      default: return undefined;
    }
  };
}

/** jdt.ls `ProgressReporter.sendStatus`: `{ id, task, subTask, status, totalWork, workDone, complete }`,
 * one line for each `id`. `status` is the line jdt.ls made for showing ("45% Building"); a task that
 * is complete is removed. */
export function javaProgressReport(params: unknown): ToolSignal | undefined {
  const report = record(params);
  const id = text(report?.id, 128) ?? text(report?.task, 128);
  if (!report || !id) return undefined;
  const key = `${javaMethods.progressReport}:${id}`;
  if (report.complete === true) return { progress: { [key]: undefined } };
  const line = text(report.status) ?? [text(report.task), text(report.subTask)].filter(Boolean).join(' - ');
  return line ? { progress: { [key]: line.slice(0, textLimit) } } : undefined;
}

/** protocol.ts `FeatureStatus`: jdt.ls sends the number, the setting takes the name (`FeatureStatus[status]`). */
export const javaFeatureStatus = ['disabled', 'interactive', 'automatic'] as const;
const featureStatus = (value: unknown): typeof javaFeatureStatus[number] | undefined => typeof value === 'number' ? javaFeatureStatus[value] : undefined;

/** standardLanguageClient.ts: what each command that jdt.ls puts under a notification does in the
 * extension. There every button runs a VS Code command; here it is what the handler of that
 * command does. A command without a rule gets no button.
 *  `java.projectConfiguration.status` [{ uri }, FeatureStatus]  `setProjectConfigurationUpdate`: the answer to
 *      "A build file was modified". It writes `java.configuration.updateBuildConfiguration` and, unless the
 *      answer is "disabled", has jdt.ls read the build file again (`projectConfigurationUpdate`). "interactive"
 *      is the mode in which jdt.ls asks, so that answer writes nothing here.
 *  `java.compile.nullAnalysis.setMode` [FeatureStatus]           `setNullAnalysisStatus` writes `java.compile.nullAnalysis.mode`.
 *  `java.protobuf.generateSources` [project names]               a command of jdt.ls itself, which vscode-languageclient
 *      registers because the server announced it.
 *  `java.runtimeValidation.open`                                 opens the settings editor at `java.configuration.runtimes`:
 *      no counterpart, so no button. */
export function javaButton(title: string, command: string, args: unknown[]): JavaAction | undefined {
  if (command === 'java.projectConfiguration.status') {
    const uri = text(record(args[0])?.uri);
    const status = featureStatus(args[1]);
    if (!uri || !status) return undefined;
    const update: JavaAction = { title, notify: { method: javaMethods.projectUpdate, params: { uri } } };
    if (status === 'interactive') return update;
    const write: JavaAction = { title, setting: { name: 'java.configuration.updateBuildConfiguration', value: status } };
    if (status === 'automatic') write.next = update;
    return write;
  }
  if (command === 'java.compile.nullAnalysis.setMode') {
    const status = featureStatus(args[0]);
    return status ? { title, setting: { name: 'java.compile.nullAnalysis.mode', value: status } } : undefined;
  }
  if (command === 'java.protobuf.generateSources') return { title, command: { command, arguments: args } };
  return undefined;
}

/** protocol.ts `MessageType`. `log` (4) is not shown: `logNotification` writes it to the extension's log. */
const severities: Record<number, ToolNotice['severity'] | undefined> = { 1: 'error', 2: 'warning', 3: 'info' };

/** standardLanguageClient.ts `registerLanguageClientActions`, the `ActionableNotification` handler:
 * `{ severity, message, commands?: { title, command, arguments? }[] }` is a notification with one
 * button for each command. jdt.ls 1.63.0 sends four: a build file was modified
 * (`StandardProjectsManager.fileChanged`, only while `java.configuration.updateBuildConfiguration` is
 * "interactive"), null annotations were found (`Preferences`), proto files without generated sources
 * (`ProtobufSupport`), and an invalid runtime (`JVMConfigurator`, only with
 * `actionableRuntimeNotificationSupport`, which these rules do not declare). */
export function javaActionable(params: unknown): ToolSignal | undefined {
  const notification = record(params);
  const message = text(notification?.message);
  if (!notification || !message) return undefined;
  if (notification.severity === 4) return { log: [message] };
  const severity = typeof notification.severity === 'number' ? severities[notification.severity] : undefined;
  if (!severity) return undefined;
  const actions: JavaAction[] = [];
  const log: string[] = [];
  let about: string | undefined;
  for (const item of list(notification.commands, buttonLimit)) {
    const button = record(item);
    const title = text(button?.title, 256);
    const command = text(button?.command, 256);
    if (!title || !command) continue;
    const args = list(button?.arguments, argumentLimit);
    about ??= text(record(args[0])?.uri);
    const action = javaButton(title, command, args);
    if (action) actions.push(action); else log.push(`No rule for the button "${title}" (${command}) of: ${message}`.slice(0, textLimit));
  }
  const notice: ToolNotice = { severity, message };
  if (actions.length) notice.actions = actions;
  // The same question about another build file is another notice.
  const key = [javaMethods.actionable, message.slice(0, 256), about].filter(Boolean).join(':');
  const signal: ToolSignal = { notices: { [key]: notice } };
  if (log.length) signal.log = log;
  return signal;
}

/** protocol.ts `EventType`. jdt.ls 1.63.0 also has `PreviewFeaturesNotAllowed` (600), which the extension does not read. */
export const javaEvents = { classpathUpdated: 100, projectsImported: 200, projectsDeleted: 210, incompatibleGradleJdkIssue: 300, upgradeGradleWrapper: 400, sourceInvalidated: 500 } as const;

/** The setting that names the JDK Gradle runs on: `GRADLE_IMPORT_JVM` in standardLanguageClient.ts. */
export const gradleJavaHomeSetting = 'java.import.gradle.java.home';
/** standardLanguageClient.ts `showGradleCompatibilityIssueNotification`: the page behind "Learn More". */
export const gradleCompatibilityPage = 'https://docs.gradle.org/current/userguide/compatibility.html';
/** requirements.ts `getJdkUrl`, without the campaign number that marks a visit as coming from the VS Code extension. */
export const javaDownloadPage = (platform: NodeJS.Platform = process.platform): string =>
  platform === 'darwin' ? 'https://adoptopenjdk.net/' : 'https://developers.redhat.com/products/openjdk/download/';

/** standardLanguageClient.ts, `EventType.incompatibleGradleJdkIssue`: of the JDKs on this computer
 * (`listJdks(true)`), those the project's Gradle can run on (`major <= highestJavaVersion`), sorted with
 * `sortJdksByVersion` and then `sortJdksBySource`. The first is the one offered. */
export function gradleJava(installed: InstalledJava[], highestJavaVersion: unknown): InstalledJava | undefined {
  const highest = typeof highestJavaVersion === 'number' ? highestJavaVersion : typeof highestJavaVersion === 'string' ? Number(highestJavaVersion) : NaN;
  return preferredJava(installed.filter(java => java.major <= highest))[0];
}

/** standardLanguageClientUtils.ts `upgradeGradle`: turn the Gradle wrapper on if the person turned it off,
 * have jdt.ls rewrite the wrapper (`java.project.upgradeGradle` with the project and the version; it
 * answers with the path of gradle-wrapper.properties), and when it answered, import the projects again.
 * The extension imports through `java.project.import.command`, which is the plain `java.project.import`
 * only while `java.import.projectSelection` is "automatic", its default. Otherwise it shows a list of
 * build files to choose from, which has no counterpart, so nothing follows the upgrade. */
function upgradeGradle(title: string, projectUri: string, version: string, settings: Json): JavaAction {
  const selection = setting(settings, 'java.import.projectSelection');
  const upgrade: JavaAction = { title, command: { command: 'java.project.upgradeGradle', arguments: [projectUri, version] } };
  if (selection === undefined || selection === 'automatic') upgrade.next = { title, command: { command: 'java.project.import' } };
  if (setting(settings, 'java.import.gradle.wrapper.enabled') !== false) return upgrade;
  return { title, setting: { name: 'java.import.gradle.wrapper.enabled', value: true }, next: upgrade };
}

const addresses = (value: unknown): string => list(value, addressLimit).filter((item): item is string => typeof item === 'string').join(', ').slice(0, textLimit);

/** standardLanguageClient.ts `registerLanguageClientActions`, the `EventNotification` handler:
 * `{ eventType, data? }`.
 *  100, 200, 210  the classpath of a project changed (`data`: its address), projects were imported or
 *                 deleted (`data`: their addresses). The extension only passes them on to other
 *                 extensions; here they are lines of the log.
 *  300            the project's Gradle cannot run on the JDK (`data`: `GradleCompatibilityInfo`). An error
 *                 with "Upgrade Gradle to <version>", then "Use Java <N> as Gradle JVM" for the JDK of
 *                 `gradleJava`, or "Get the Java Development Kit" when no installed JDK fits. The extension
 *                 writes the setting and imports again; jdt.ls is started again here, which imports with it.
 *  400            the Gradle wrapper should be upgraded (`data`: `UpgradeGradleWrapperInfo`): a warning.
 *                 "Don't show again" is remembered by the extension itself, not in a setting.
 *  500            a library got another source attachment (`data.affectedRootPaths`). The extension reloads
 *                 the class files it has open; here it is a line of the log. */
export function javaEvent(params: unknown, installed: InstalledJava[], settings: Json = {}, platform: NodeJS.Platform = process.platform): ToolSignal | undefined {
  const event = record(params);
  const data = record(event?.data);
  const message = text(data?.message);
  const projectUri = text(data?.projectUri);
  const version = text(data?.recommendedGradleVersion, 64);
  switch (event?.eventType) {
    case javaEvents.classpathUpdated: { const uri = text(event?.data); return uri ? { log: [`Classpath updated: ${uri}`] } : undefined; }
    case javaEvents.projectsImported: { const uris = addresses(event?.data); return uris ? { log: [`Java projects imported: ${uris}`] } : undefined; }
    case javaEvents.projectsDeleted: { const uris = addresses(event?.data); return uris ? { log: [`Java projects deleted: ${uris}`] } : undefined; }
    case javaEvents.incompatibleGradleJdkIssue: {
      if (!data || !message) return undefined;
      const java = gradleJava(installed, data.highestJavaVersion);
      const actions: JavaAction[] = [];
      if (projectUri && version) actions.push(upgradeGradle(`Upgrade Gradle to ${version}`, projectUri, version, settings));
      const jdk: JavaAction = java ? { title: `Use Java ${java.major} as Gradle JVM`, setting: { name: gradleJavaHomeSetting, value: java.home, then: 'restart' } }
        : { title: 'Get the Java Development Kit', link: javaDownloadPage(platform) };
      actions.push(jdk);
      actions.push({ title: 'Learn More', link: gradleCompatibilityPage });
      return { notices: { [`${javaMethods.event}:${javaEvents.incompatibleGradleJdkIssue}`]: { severity: 'error', message, actions } } };
    }
    case javaEvents.upgradeGradleWrapper: {
      if (!message) return undefined;
      const actions: JavaAction[] = [];
      if (projectUri && version) actions.push(upgradeGradle(`Upgrade to ${version}`, projectUri, version, settings));
      actions.push({ title: "Don't show again", dismiss: true });
      return { notices: { [`${javaMethods.event}:${javaEvents.upgradeGradleWrapper}`]: { severity: 'warning', message, actions } } };
    }
    case javaEvents.sourceInvalidated: {
      const roots = Object.keys(record(data?.affectedRootPaths) ?? {}).slice(0, addressLimit).join(', ').slice(0, textLimit);
      return roots ? { log: [`Source attachment changed: ${roots}`] } : undefined;
    }
    default: return undefined;
  }
}

/** The command of the one `workspace/notify` jdt.ls sends: `GRADLE_CHECKSUM` in standardLanguageClient.ts. */
export const gradleChecksumPrompt = 'gradle/checksum/prompt';
/** settings.ts `setGradleWrapperChecksum`: where the answer is written, and the page behind "could be malicious". */
export const gradleChecksumsSetting = 'java.imports.gradle.wrapper.checksums';
export const gradleWrapperPage = 'https://github.com/redhat-developer/vscode-java/wiki/Gradle-Support#suspicious.wrapper';

/** standardLanguageClient.ts, the `ServerNotification` handler (`workspace/notify`, `{ command, arguments }`)
 * runs the named command. jdt.ls sends one (`GradleProjectImporter`, `checkWrapperChecksum`):
 * `gradle/checksum/prompt` with the path of a gradle-wrapper.jar and its sha256, when the checksum is
 * neither a known Gradle release nor in `java.imports.gradle.wrapper.checksums`.
 * settings.ts `setGradleWrapperChecksum` asks whether to trust it and adds `{ sha256, allowed }` to that
 * setting, unless the checksum is already in it. jdt.ls reads the setting as it changes
 * (`GradlePreferenceChangeListener`). */
export function javaServerNotification(params: unknown, settings: Json = {}): ToolSignal | undefined {
  const sent = record(params);
  if (sent?.command !== gradleChecksumPrompt) return undefined;
  const [wrapper, sha256] = list(sent?.arguments, 2).map(item => text(item, 1024));
  if (!wrapper || !sha256) return undefined;
  const written = setting(settings, gradleChecksumsSetting);
  const known: unknown[] = Array.isArray(written) ? written : [];
  const answered = (allowed: boolean): unknown[] => known.some(entry => record(entry)?.sha256 === sha256) ? known : [...known, { sha256, allowed }];
  return { notices: { [`${gradleChecksumPrompt}:${sha256}`]: {
    severity: 'error',
    message: `Security Warning! The gradle wrapper '${wrapper}' [sha256 '${sha256}'] could be malicious. Should it be trusted?`,
    actions: [
      { title: 'Do not trust', setting: { name: gradleChecksumsSetting, value: answered(false) } },
      { title: 'Trust', setting: { name: gradleChecksumsSetting, value: answered(true) } },
      { title: 'Learn More', link: gradleWrapperPage },
    ],
  } } };
}

/** The client commands jdt.ls 1.63.0 asks for in `workspace/executeClientCommand` without being told
 * their names: commands.ts `REFRESH_BUNDLES_COMMAND` and `CHOOSE_IMPORTS`. */
export const javaClientCommands = { reloadBundles: '_java.reloadBundles.command', chooseImports: 'java.action.organizeImports.chooseImports' } as const;
const candidateLimit = 50;

/** sourceAction.ts, the `java.action.organizeImports.chooseImports` handler: arguments
 * `[uri, selections: { candidates: { fullyQualifiedName, id }[], range }[], restoreExistingImports?]`.
 * For each selection the person picks one candidate, and the answer is the candidates picked so far:
 * closing a list ends it. One question can be asked here, so the first selection is asked and the
 * answer ends there, as when the person closes the second list. jdt.ls leaves a type nobody chose
 * unimported (`OrganizeImportsHandler`), so organizing again asks about the next one. */
function chooseImports(args: unknown[]): ToolAnswer {
  const candidates = list(record(list(args[1], 1)[0])?.candidates, candidateLimit).flatMap(item => {
    const candidate = record(item);
    const name = text(candidate?.fullyQualifiedName, 512);
    return candidate && name ? [{ candidate, name }] : [];
  });
  const first = candidates[0];
  if (!first) return { result: [] };
  return {
    question: { message: `Choose type '${first.name.slice(first.name.lastIndexOf('.') + 1)}' to import`, answers: candidates.map(({ name }) => name) },
    result: (answer: number | undefined): unknown => { const chosen = answer === undefined ? undefined : candidates[answer]; return chosen ? [chosen.candidate] : []; },
  };
}

/** standardLanguageClient.ts, the `ExecuteClientCommandRequest` handler: `{ command, arguments }` runs a
 * VS Code command and its result is the answer. jdt.ls sends it only to an editor that declared
 * `executeClientCommandSupport`:
 *  `_java.reloadBundles.command`  once after `initialized` (`JDTLanguageServer.synchronizeBundles`). plugin.ts
 *      `getBundlesToReload` answers with the bundles other extensions contribute, if they changed since the
 *      start, else with an empty list. Nothing contributes bundles here while jdt.ls runs: an empty list.
 *  `java.action.organizeImports.chooseImports`  only with `advancedOrganizeImportsSupport` as well: a question.
 * Anything else has no rule; the extension would answer with an error, here it is `null` and a line of the log. */
export function javaClientCommand(params: unknown): ToolAnswer {
  const asked = record(params);
  const command = text(asked?.command, 256);
  if (command === javaClientCommands.reloadBundles) return { result: [] };
  if (command === javaClientCommands.chooseImports) return chooseImports(list(asked?.arguments, 3));
  return { result: null, signal: { log: [`No rule for the client command ${command ?? 'without a name'}`] } };
}

/** The rules of one jdt.ls session. `installed`: the JDKs on this computer (`installedJava` in
 * tool-runtime.ts), from which a JDK for Gradle is offered. */
export function javaRules(installed: InstalledJava[], platform: NodeJS.Platform = process.platform): ToolRulesFactory {
  return ({ settings }) => ({
    initializationOptions: { extendedClientCapabilities: { ...javaExtendedCapabilities } },
    started: () => ({ progress: { [javaMethods.status]: javaActivating } }),
    notifications: {
      [javaMethods.status]: javaStatusRule(),
      [javaMethods.progressReport]: javaProgressReport,
      [javaMethods.actionable]: javaActionable,
      [javaMethods.event]: params => javaEvent(params, installed, settings, platform),
      [javaMethods.notify]: params => javaServerNotification(params, settings),
    },
    requests: { [javaMethods.clientCommand]: javaClientCommand },
  });
}
