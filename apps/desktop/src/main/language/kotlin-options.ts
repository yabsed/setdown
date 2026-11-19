// The rules in this file are carried over from the VS Code Kotlin extension ("Kotlin by JetBrains").
// Each one names the file it came from, so a newer `vendor/kotlin-lsp` can be compared against it:
//   vendor/kotlin-lsp/vscode-extension-core/src/lspClient.ts                which settings are read (`configOption`) and what is sent (`sanitizedInitializationSettings`)
//   vendor/kotlin-lsp/vscode-extension-core/src/initializationSettings.ts   what a value has to look like to be sent
//   vendor/kotlin-lsp/kotlin-vscode/package.json                            the settings a person can write
// The Zed Kotlin extension, which starts the server for Setdown, sends no initialization options.

/** The settings the options are made from, by the names the VS Code extension declares. */
export const kotlinOptionSettings = { sdk: 'intellij.jdkForSymbolResolution', buildTool: 'intellij.buildTool', projects: 'intellij.projects' } as const;
/** initializationSettings.ts `PROJECT_TYPES`: the kinds of project the server imports. `subproject`
 * points at a folder whose own settings name its projects, and is not offered by package.json. */
export const kotlinProjectTypes = ['gradle', 'maven', 'bazel', 'jps', 'gomodules', 'gomodules-recursive-scan', 'json', 'subproject'];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringMap = (value: unknown) => isRecord(value) && Object.values(value).every(entry => typeof entry === 'string');

/** lspClient.ts `configOption`, for a tool whose settings are one object: the name is written
 * as one dotted key or as nested objects, and the dotted key is read first. The older
 * `kotlinLSP.` names the extension still falls back to are not read; it declares none of them. */
function configured(settings: unknown, name: string): unknown {
  if (!isRecord(settings)) return undefined;
  const [group, field] = name.split('.'), nested = settings[group];
  return settings[name] ?? (isRecord(nested) ? nested[field] : undefined);
}

/** initializationSettings.ts `projectRejectionReason`: why one entry of `intellij.projects`
 * cannot be sent, in the extension's words. An entry that passes is sent as it was written. */
function projectRejection(entry: unknown): string | undefined {
  if (!isRecord(entry)) return 'must be an object';
  for (const field of ['type', 'path']) {
    const value = entry[field];
    if (typeof value !== 'string' || !value.trim()) return `requires "${field}" to be specified as a non-empty string`;
  }
  if (!kotlinProjectTypes.includes(entry.type as string)) return `has an unsupported "type": "${entry.type}"`;
  for (const field of ['java-home', 'project-path']) if (entry[field] !== undefined && typeof entry[field] !== 'string') return `"${field}" must be a string`;
  for (const field of ['env', 'system-properties']) if (entry[field] !== undefined && !isStringMap(entry[field])) return `"${field}" must be an object with string values`;
  for (const field of ['downloadAdditionalArtifacts', 'offline', 'skipGenerateSources']) if (entry[field] !== undefined && typeof entry[field] !== 'boolean') return `"${field}" must be a boolean`;
  if (entry.profiles !== undefined && (!Array.isArray(entry.profiles) || entry.profiles.some(profile => typeof profile !== 'string'))) return '"profiles" must be an array of strings';
  return undefined;
}

/** lspClient.ts `sanitizedInitializationSettings`: the initialization options the VS Code
 * extension makes from `intellij.jdkForSymbolResolution`, `intellij.buildTool` and
 * `intellij.projects`. The server reads them as one object and discards all of it when one
 * value has the wrong shape, so such a value is left out and named in `problems`, one line
 * each in the extension's words; the extension warns the person about those.
 *
 * `folders` are the `file:` URIs of the project folders. VS Code reads the build tool once
 * for each folder; a tool has one settings object here, so every folder gets the same one.
 * A build tool of `""` is sent: it turns project import off, where none lets the server choose.
 *
 * With nothing set this is `{ buildTools: {}, projects: [] }`. The extension's `defaultSdk`
 * is `undefined` then, which JSON leaves out, so the key is absent and never `null`. */
export function kotlinInitializationOptions(settings: unknown, folders: string[]): { options: Record<string, unknown>; problems: string[] } {
  const problems: string[] = [];
  const dropped = (setting: string, reason: string) => { problems.push(`\`${setting}\` ${reason}`); };
  const unset = (value: unknown) => value === undefined || value === null;

  // `sanitizeOptionalString`
  const sdk = configured(settings, kotlinOptionSettings.sdk);
  if (!unset(sdk) && typeof sdk !== 'string') dropped(kotlinOptionSettings.sdk, 'must be a string');

  // `sanitizeBuildTools`
  const buildTool = configured(settings, kotlinOptionSettings.buildTool), buildTools: Record<string, string> = {};
  for (const folder of folders) {
    if (typeof buildTool === 'string') buildTools[folder] = buildTool;
    else if (!unset(buildTool)) dropped(kotlinOptionSettings.buildTool, `for ${folder} must be a string`);
  }

  // `sanitizeConfiguredProjects`
  const written = configured(settings, kotlinOptionSettings.projects), projects: unknown[] = [];
  if (Array.isArray(written)) written.forEach((entry, index) => {
    const rejection = projectRejection(entry);
    if (rejection) dropped(kotlinOptionSettings.projects, `entry #${index} ${rejection}`); else projects.push(entry);
  });
  else if (!unset(written)) dropped(kotlinOptionSettings.projects, 'must be an array');

  return { options: { ...(typeof sdk === 'string' ? { defaultSdk: sdk } : {}), buildTools, projects }, problems };
}
