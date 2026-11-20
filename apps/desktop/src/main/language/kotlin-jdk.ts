import { kotlinOptionSettings } from './kotlin-options';
import { preferredJava, type InstalledJava } from './tool-runtime';

// Which JDK kotlin-lsp analyses a Gradle or Maven project with, and what Setdown adds so that it
// is the one the build files ask for.
//
// The VS Code Kotlin extension chooses no JDK. It starts the server with the environment it
// has itself (lspClient.ts `buildLaunchEnvironment` copies it and never names `JAVA_HOME`) and
// sends `intellij.jdkForSymbolResolution` as `defaultSdk` only when the person set it
// (`sanitizedInitializationSettings`). What the server does with those, as `vendor/kotlin-lsp` states it:
//   RELEASES.md   "Gradle and Maven import honor `JAVA_HOME`."
//   RELEASES.md   "Gradle import uses the JRE of the language server when `JAVA_HOME` is not set."
//   buildtool.api/src/com/jetbrains/ls/buildtool/api/BuildJdk.kt `BuildJdkSource`
//                 where the JDK of an import can come from: the `java-home` of an entry of
//                 `intellij.projects`, a JVM property of the server, `JAVA_HOME` in that entry's
//                 `env`, `JAVA_HOME` of the server process, a search, the server's own JVM
//   buildtool.api/src/com/jetbrains/ls/buildtool/api/WorkspaceImportParameters.kt
//                 `defaultSdkPath`: "SDK to use for a project that does not configure its own";
//                 `javaHome`: "JDK home used to run the import (overrides the ambient/default JDK)"
//   kotlin-vscode/package.json   `intellij.jdkForSymbolResolution`: "Path to the JDK used for symbol resolution"
// Measured with Setdown (reports/2026_11_19_05_19_zed_project_engine_adoption_plan.md, 13.2): a
// project with `jvmToolchain(25)`, started with `JAVA_HOME` naming JDK 17, has
// `Thread.startVirtualThread` reported as unresolved; started with `JAVA_HOME` naming JDK 25 it
// has no error. So the JDK the import ran on is the one the code is resolved against, whatever
// release the build files ask for.
//
// An editor can set two things without writing the person's settings: `JAVA_HOME` of the server
// process, and `defaultSdk`. A `java-home` needs an entry of `intellij.projects`, which also
// says which projects there are, and that is the person's to write. `kotlinJdkPlan` sets both.
// `JAVA_HOME` is the one whose effect is stated and was measured. Whether `defaultSdk` alone
// changes what a Gradle or Maven project is resolved against is not stated by the sources here
// and was not measured; it is sent because that is what the option is described as doing.

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** A build file is read up to this many characters. */
const readLimit = 256 * 1024;
/** `17`, and `1.8` or `1_8` for Java 8. */
function release(written: string | undefined): number | undefined {
  const major = Number(/^(?:1[._])?(\d{1,2})$/.exec(written?.trim() ?? '')?.[1]);
  return major >= 1 ? major : undefined;
}
const highest = (found: (number | undefined)[]): number | undefined =>
  found.reduce<number | undefined>((best, value) => value !== undefined && (best === undefined || value > best) ? value : best, undefined);

/** The Java release a `build.gradle` or `build.gradle.kts` asks for. A toolchain
 * (`JavaLanguageVersion.of(25)`, `jvmToolchain(25)`) says which JDK compiles the project, so it
 * is read first; without one, `sourceCompatibility`. A release given by a variable or a version
 * catalog is not known from this file, and neither is one a convention plugin sets. */
export function gradleJavaRelease(text: string): number | undefined {
  const code = text.slice(0, readLimit).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');
  const toolchain = highest([...code.matchAll(/\bJavaLanguageVersion\s*\.\s*of\s*\(\s*["']?(\d{1,2})["']?\s*\)|\bjvmToolchain\s*\(\s*(\d{1,2})\s*\)/g)].map(match => release(match[1] ?? match[2])));
  if (toolchain !== undefined) return toolchain;
  const written = /\bsourceCompatibility\b\s*(?:=|\(|\s)\s*(?:JavaVersion\s*\.\s*(?:VERSION_(\d[\d_]*)|toVersion\s*\(\s*["']?(\d[\d.]*)["']?\s*\))|["']?(\d[\d.]*)["']?)/g;
  return highest([...code.matchAll(written)].map(match => release(match[1] ?? match[2] ?? match[3])));
}

/** The Java release a `pom.xml` asks for: the property `maven.compiler.release`, or `<release>`
 * of the compiler plugin. A value that names a property (`${java.version}`) is looked up in the
 * same file once. A release only a parent POM sets is not known from this file. */
export function mavenJavaRelease(text: string): number | undefined {
  const xml = text.slice(0, readLimit).replace(/<!--[\s\S]*?-->/g, ' ');
  const property = (name: string) => new RegExp(`<${name.replace(/[.\\-]/g, '\\$&')}>\\s*([^<]*?)\\s*</`).exec(xml)?.[1];
  return highest([...xml.matchAll(/<(maven\.compiler\.release|release)>\s*([^<]*?)\s*<\/\1>/g)].map(match => {
    const named = /^\$\{([\w.-]+)\}$/.exec(match[2])?.[1];
    return release(named ? property(named) : match[2]);
  }));
}

/** The Java release the build files of a project ask for: the highest one any of them names,
 * since code written for an older release resolves against a newer JDK and not the other way
 * round. `name` is a file name or path; `pom.xml`, `*.gradle` and `*.gradle.kts` are read. */
export function projectJavaRelease(files: { name: string; text: string }[]): number | undefined {
  return highest(files.slice(0, 64).map(file => {
    const name = file.name.replace(/\\/g, '/').split('/').pop() ?? '';
    return name === 'pom.xml' ? mavenJavaRelease(file.text) : /\.gradle(?:\.kts)?$/.test(name) ? gradleJavaRelease(file.text) : undefined;
  }));
}

/** kotlin-options.ts `configured`: a setting written as one dotted key or as nested objects, the dotted key first. */
function configured(settings: unknown, name: string): unknown {
  if (!isRecord(settings)) return undefined;
  const [group, field] = name.split('.'), nested = settings[group];
  return settings[name] ?? (isRecord(nested) ? nested[field] : undefined);
}

/** Whether the person chose a JDK for kotlin-lsp themselves: `intellij.jdkForSymbolResolution`,
 * or a `java-home` or a `JAVA_HOME` in the `env` of an entry of `intellij.projects`
 * (BuildJdk.kt `PROJECT_JAVA_HOME`, `PROJECT_ENV`). A value the server cannot read counts as
 * well: it is reported to them (`kotlinInitializationOptions`), not replaced. */
export function kotlinJdkWritten(settings: unknown): boolean {
  const set = (value: unknown) => value !== undefined && value !== null;
  const projects = configured(settings, kotlinOptionSettings.projects);
  return set(configured(settings, kotlinOptionSettings.sdk))
    || (Array.isArray(projects) ? projects : []).some(project => isRecord(project) && (set(project['java-home']) || (isRecord(project.env) && set(project.env.JAVA_HOME))));
}

export type KotlinJdkPlan = {
  /** Added to the environment the server is started with. */
  env?: { JAVA_HOME: string };
  /** Sent as the initialization option `defaultSdk`, at `initialize` and with every `intellij/reloadWorkspace`. */
  defaultSdk?: string;
  /** For the person: which JDK was chosen and why, or which one is missing. */
  note?: string };

/** What Setdown adds so that a project is analysed with the JDK its build files ask for.
 *
 * Nothing when the person chose a JDK in the settings, when the release the project asks for is
 * not known, or when `JAVA_HOME` already names a JDK of that release. Otherwise the installed
 * JDK of exactly that release (the preferred one, `tool-runtime.ts` `preferredJava`) is sent as
 * `defaultSdk`. It also becomes the server's `JAVA_HOME` when the one of the environment is
 * older: an import that ran on an older JDK leaves the newer API unresolved. A newer `JAVA_HOME`
 * is left alone, because the build tool itself runs on it and may not run on an older JDK, and
 * a newer JDK resolves everything an older release has.
 *
 * `environmentJava` is the release of the JDK that `JAVA_HOME` of the server's environment
 * names, absent when it is not set; the server then imports on a JDK of its own choosing. */
export function kotlinJdkPlan(input: { installed: InstalledJava[]; environmentJava?: number; projectJava?: number; settings: unknown }): KotlinJdkPlan {
  const { projectJava, environmentJava } = input;
  if (projectJava === undefined || !Number.isSafeInteger(projectJava) || projectJava < 1 || projectJava === environmentJava || kotlinJdkWritten(input.settings)) return {};
  const older = environmentJava !== undefined && environmentJava < projectJava;
  const environment = environmentJava === undefined ? '`JAVA_HOME` is not set' : `\`JAVA_HOME\` names Java ${environmentJava}`;
  const match = preferredJava(input.installed.filter(java => java.major === projectJava))[0];
  if (!match) return older ? { note: `The build files ask for Java ${projectJava}, which was not found on this computer; ${environment}` } : {};
  return { ...(older ? { env: { JAVA_HOME: match.home } } : {}), defaultSdk: match.home, note: `Java ${match.major} at ${match.home} (the build files ask for Java ${projectJava}; ${environment})` };
}
