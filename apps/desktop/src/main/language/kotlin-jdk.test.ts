import { expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InstalledJava } from './tool-runtime';
import { gradleJavaRelease, kotlinJdkPlan, kotlinJdkWritten, mavenJavaRelease, projectJavaRelease } from './kotlin-jdk';

test('a Gradle toolchain names the release, in either build language', () => {
  expect(gradleJavaRelease('kotlin {\n    jvmToolchain(25)\n}\n')).toBe(25);
  expect(gradleJavaRelease('kotlin.jvmToolchain( 21 )')).toBe(21);
  expect(gradleJavaRelease('java {\n  toolchain {\n    languageVersion = JavaLanguageVersion.of(17)\n  }\n}')).toBe(17);
  expect(gradleJavaRelease('java { toolchain { languageVersion.set(JavaLanguageVersion.of("11")) } }')).toBe(11);
  expect(gradleJavaRelease("kotlin { jvmToolchain { languageVersion.set(JavaLanguageVersion.of('8')) } }")).toBe(8);
  // The toolchain compiles the project, so it is the one that counts when both are written.
  expect(gradleJavaRelease('java {\n  sourceCompatibility = JavaVersion.VERSION_17\n  toolchain { languageVersion = JavaLanguageVersion.of(21) }\n}')).toBe(21);
  // Several in one file: the highest.
  expect(gradleJavaRelease('subprojects { kotlin { jvmToolchain(17) } }\nproject(":app") { kotlin { jvmToolchain(21) } }')).toBe(21);
});

test('without a toolchain, sourceCompatibility names the release', () => {
  expect(gradleJavaRelease('java {\n    sourceCompatibility = JavaVersion.VERSION_17\n    targetCompatibility = JavaVersion.VERSION_17\n}')).toBe(17);
  expect(gradleJavaRelease('sourceCompatibility = JavaVersion.VERSION_1_8')).toBe(8);
  expect(gradleJavaRelease('java.sourceCompatibility = JavaVersion.toVersion(21)')).toBe(21);
  expect(gradleJavaRelease('java.sourceCompatibility = JavaVersion.toVersion("11")')).toBe(11);
  expect(gradleJavaRelease("sourceCompatibility = '11'")).toBe(11);
  expect(gradleJavaRelease('sourceCompatibility = "1.8"')).toBe(8);
  expect(gradleJavaRelease('sourceCompatibility = 1.8')).toBe(8);
  expect(gradleJavaRelease('sourceCompatibility = 17')).toBe(17);
  // Groovy without the equals sign.
  expect(gradleJavaRelease('sourceCompatibility JavaVersion.VERSION_11')).toBe(11);
  expect(gradleJavaRelease("sourceCompatibility '17'")).toBe(17);
  // The target alone says what the classes run on, not what they are compiled against.
  expect(gradleJavaRelease('targetCompatibility = JavaVersion.VERSION_17')).toBeUndefined();
});

test('a release that is not written in the Gradle file is not known', () => {
  for (const text of ['', 'plugins { kotlin("jvm") version "2.3.21" }', 'kotlin { jvmToolchain(libs.versions.java.get().toInt()) }', 'java { toolchain { languageVersion = JavaLanguageVersion.of(javaVersion) } }',
    'sourceCompatibility = javaVersion', 'sourceCompatibility = JavaVersion.current()', 'val jvmToolchainVersion = 25', 'kotlin { jvmToolchain(250) }', 'sourceCompatibility = 11.0.2'])
    expect(gradleJavaRelease(text), text).toBeUndefined();
  // A comment is not the build.
  expect(gradleJavaRelease('// kotlin { jvmToolchain(25) }\nkotlin { jvmToolchain(17) } // was jvmToolchain(25)\n/* java {\n toolchain { languageVersion = JavaLanguageVersion.of(26) }\n} */')).toBe(17);
  expect(gradleJavaRelease('/* jvmToolchain(25) */\n    // sourceCompatibility = 21')).toBeUndefined();
  // An address is not a comment.
  expect(gradleJavaRelease('repositories { maven { url = uri("https://repo.example/maven") } }; kotlin { jvmToolchain(21) }')).toBe(21);
  // Only the beginning of an enormous file is read.
  expect(gradleJavaRelease(`${' '.repeat(300 * 1024)}kotlin { jvmToolchain(21) }`)).toBeUndefined();
});

const pom = (body: string) => `<project xmlns="http://maven.apache.org/POM/4.0.0">\n  <modelVersion>4.0.0</modelVersion>\n${body}\n</project>`;

test('a POM names the release as a property or in the compiler plugin', () => {
  expect(mavenJavaRelease(pom('<properties>\n  <maven.compiler.release>25</maven.compiler.release>\n</properties>'))).toBe(25);
  expect(mavenJavaRelease(pom('<build><plugins><plugin><artifactId>maven-compiler-plugin</artifactId><configuration><release> 17 </release></configuration></plugin></plugins></build>'))).toBe(17);
  expect(mavenJavaRelease(pom('<properties><maven.compiler.release>1.8</maven.compiler.release></properties>'))).toBe(8);
  // A value that names a property of the same file.
  expect(mavenJavaRelease(pom('<properties><java.version>21</java.version><maven.compiler.release>${java.version}</maven.compiler.release></properties>'))).toBe(21);
  expect(mavenJavaRelease(pom('<properties><jdk-release>17</jdk-release></properties><build><plugins><plugin><configuration><release>${jdk-release}</release></configuration></plugin></plugins></build>'))).toBe(17);
  // Two modules' worth in one file: the highest.
  expect(mavenJavaRelease(pom('<properties><maven.compiler.release>11</maven.compiler.release></properties><build><plugins><plugin><configuration><release>17</release></configuration></plugin></plugins></build>'))).toBe(17);
});

test('a release that is not written in the POM is not known', () => {
  for (const body of ['', '<properties><java.version>21</java.version></properties>', '<properties><maven.compiler.source>17</maven.compiler.source><maven.compiler.target>17</maven.compiler.target></properties>',
    '<properties><maven.compiler.release>${java.version}</maven.compiler.release></properties>', '<properties><a>${b}</a><b>17</b><maven.compiler.release>${a}</maven.compiler.release></properties>',
    '<repositories><repository><releases><enabled>true</enabled></releases></repository></repositories>', '<properties><maven.compiler.release></maven.compiler.release></properties>',
    '<properties><maven.compiler.release>latest</maven.compiler.release></properties>', '<!-- <properties><maven.compiler.release>25</maven.compiler.release></properties> -->',
    '<release version="1.0">17</release>'])
    expect(mavenJavaRelease(pom(body)), body).toBeUndefined();
  expect(mavenJavaRelease('not xml at all')).toBeUndefined();
  expect(mavenJavaRelease(`${' '.repeat(300 * 1024)}<maven.compiler.release>21</maven.compiler.release>`)).toBeUndefined();
});

test('the release of a project is the highest one its build files name', () => {
  const kotlin = { name: '/work/shop/build.gradle.kts', text: 'kotlin { jvmToolchain(25) }' };
  const groovy = { name: 'app/build.gradle', text: "sourceCompatibility = '17'" };
  const maven = { name: 'C:\\work\\shop\\pom.xml', text: pom('<properties><maven.compiler.release>21</maven.compiler.release></properties>') };
  expect(projectJavaRelease([kotlin])).toBe(25);
  expect(projectJavaRelease([groovy, maven])).toBe(21);
  expect(projectJavaRelease([groovy, kotlin, maven])).toBe(25);
  expect(projectJavaRelease([{ name: 'settings.gradle.kts', text: 'rootProject.name = "shop"' }, groovy])).toBe(17);
  // Other files are not build files, whatever they hold.
  expect(projectJavaRelease([{ name: 'README.md', text: 'kotlin { jvmToolchain(25) }' }, { name: 'pom.xml.bak', text: maven.text }, { name: 'gradle.properties', text: 'jvmToolchain(25)' },
    { name: 'build.gradle.kts', text: maven.text }, { name: 'pom.xml', text: kotlin.text }])).toBeUndefined();
  expect(projectJavaRelease([])).toBeUndefined();
});

const vendor = fileURLToPath(new URL('../../../../../vendor', import.meta.url));
const samples = path.join(vendor, 'vscode-java/test/resources/projects');
test.skipIf(!existsSync(path.join(samples, 'gradle/gradle-11/build.gradle')))('the sample projects of vscode-java are read as the Java 11 projects they are', () => {
  const files = ['gradle/gradle-11/build.gradle', 'maven/salut-java11/pom.xml'].map(name => ({ name: path.join(samples, name), text: readFileSync(path.join(samples, name), 'utf8') }));
  expect(gradleJavaRelease(files[0].text)).toBe(11);
  expect(mavenJavaRelease(files[1].text)).toBe(11);
  expect(projectJavaRelease(files)).toBe(11);
});

const java = (major: number, home = `/usr/lib/jvm/java-${major}-openjdk`, sources: InstalledJava['sources'] = []): InstalledJava => ({ home, major, sources });
/** This computer when the Kotlin analysis was measured: `JAVA_HOME` is JDK 17, and 21 and 25 are in /usr/lib/jvm. */
const installed = [java(17, '/home/me/.sdkman/candidates/java/17', ['JAVA_HOME', 'SDKMAN']), java(21), java(25)];

test('a project that asks for a newer Java than JAVA_HOME gets the installed JDK of that release', () => {
  expect(kotlinJdkPlan({ installed, environmentJava: 17, projectJava: 25, settings: {} })).toStrictEqual({
    env: { JAVA_HOME: '/usr/lib/jvm/java-25-openjdk' }, defaultSdk: '/usr/lib/jvm/java-25-openjdk',
    note: 'Java 25 at /usr/lib/jvm/java-25-openjdk (the build files ask for Java 25; `JAVA_HOME` names Java 17)' });
  expect(kotlinJdkPlan({ installed, environmentJava: 17, projectJava: 21, settings: undefined }).env).toStrictEqual({ JAVA_HOME: '/usr/lib/jvm/java-21-openjdk' });
  // Of two JDKs of the release, the preferred one: a version manager's before one that was merely found.
  const two = [java(25, '/opt/found/jdk-25'), java(25, '/home/me/.sdkman/candidates/java/25', ['SDKMAN']), java(17)];
  expect(kotlinJdkPlan({ installed: two, environmentJava: 17, projectJava: 25, settings: {} }).env).toStrictEqual({ JAVA_HOME: '/home/me/.sdkman/candidates/java/25' });
});

test('JAVA_HOME is left alone when it is right, newer or not set', () => {
  // Already the release the project asks for.
  expect(kotlinJdkPlan({ installed, environmentJava: 25, projectJava: 25, settings: {} })).toStrictEqual({});
  // Newer: the build tool runs on it, and it resolves all an older release has. The exact JDK is still named for symbols.
  expect(kotlinJdkPlan({ installed, environmentJava: 25, projectJava: 17, settings: {} })).toStrictEqual({
    defaultSdk: '/home/me/.sdkman/candidates/java/17', note: 'Java 17 at /home/me/.sdkman/candidates/java/17 (the build files ask for Java 17; `JAVA_HOME` names Java 25)' });
  expect(kotlinJdkPlan({ installed, environmentJava: 25, projectJava: 8, settings: {} })).toStrictEqual({});
  // Not set: the server imports on a JDK of its own choosing.
  expect(kotlinJdkPlan({ installed, projectJava: 25, settings: {} })).toStrictEqual({
    defaultSdk: '/usr/lib/jvm/java-25-openjdk', note: 'Java 25 at /usr/lib/jvm/java-25-openjdk (the build files ask for Java 25; `JAVA_HOME` is not set)' });
  expect(kotlinJdkPlan({ installed, projectJava: 11, settings: {} })).toStrictEqual({});
});

test('a release that is not installed is named and nothing is changed', () => {
  expect(kotlinJdkPlan({ installed, environmentJava: 17, projectJava: 26, settings: {} })).toStrictEqual({ note: 'The build files ask for Java 26, which was not found on this computer; `JAVA_HOME` names Java 17' });
  expect(kotlinJdkPlan({ installed: [], environmentJava: 17, projectJava: 25, settings: {} })).toStrictEqual({ note: 'The build files ask for Java 25, which was not found on this computer; `JAVA_HOME` names Java 17' });
  // A newer JDK is not a stand-in for the one asked for: 21 is not offered for 20.
  expect(kotlinJdkPlan({ installed, environmentJava: 17, projectJava: 20, settings: {} }).env).toBeUndefined();
});

test('nothing is added when the release is not known', () => {
  for (const projectJava of [undefined, 0, -1, 17.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(kotlinJdkPlan({ installed, environmentJava: 17, projectJava, settings: {} }), String(projectJava)).toStrictEqual({});
});

test('what the person wrote about the JDK always wins', () => {
  const project = { type: 'gradle', path: 'file:///work/shop' };
  const chosen = [
    { 'intellij.jdkForSymbolResolution': '/usr/lib/jvm/java-21-openjdk' }, { intellij: { jdkForSymbolResolution: '/opt/jdk' } }, { 'intellij.jdkForSymbolResolution': '' },
    // Written wrongly is still written: it is reported, not replaced.
    { 'intellij.jdkForSymbolResolution': 21 }, { 'intellij.projects': [{ type: 'ant', path: 'x', 'java-home': '/opt/jdk' }] }, { 'intellij.projects': [{ 'java-home': 25 }] },
    { 'intellij.projects': [{ ...project, 'java-home': '/opt/jdk-21' }] }, { intellij: { projects: [project, { type: 'maven', path: 'file:///work/shop/pom.xml', env: { JAVA_HOME: '/opt/jdk-21' } }] } }];
  for (const settings of chosen) {
    expect(kotlinJdkWritten(settings), JSON.stringify(settings)).toBe(true);
    expect(kotlinJdkPlan({ installed, environmentJava: 17, projectJava: 25, settings }), JSON.stringify(settings)).toStrictEqual({});
  }
  const silent = [undefined, null, 'text', 7, [], {}, { 'intellij.jdkForSymbolResolution': null }, { 'intellij.buildTool': 'gradle' }, { 'intellij.projects': [project] }, { 'intellij.projects': [{ ...project, env: { GRADLE_OPTS: '-Xmx2g' } }] },
    { 'intellij.projects': [{ ...project, 'java-home': null, env: { JAVA_HOME: null } }, null, 'text'] }, { 'intellij.projects': 'none' },
    // Another tool's Java is not this tool's.
    { 'java.jdt.ls.java.home': '/opt/jdk', java: { home: '/opt/jdk' } }];
  for (const settings of silent) {
    expect(kotlinJdkWritten(settings), JSON.stringify(settings)).toBe(false);
    expect(kotlinJdkPlan({ installed, environmentJava: 17, projectJava: 25, settings }).env, JSON.stringify(settings)).toStrictEqual({ JAVA_HOME: '/usr/lib/jvm/java-25-openjdk' });
  }
});

// What the plan rests on is compared with the copy in `vendor`, so a newer submodule that says
// something else about the JDK fails here and not in someone's project.
const upstream = path.join(vendor, 'kotlin-lsp');
test.skipIf(!existsSync(path.join(upstream, 'RELEASES.md')))('what the plan rests on is what vendor/kotlin-lsp states', () => {
  const source = (file: string) => readFileSync(path.join(upstream, file), 'utf8');
  const releases = source('RELEASES.md').replace(/\s+/g, ' ');
  expect(releases).toContain('Gradle and Maven import honor `JAVA_HOME`.');
  expect(releases).toContain('Gradle import uses the JRE of the language server when `JAVA_HOME` is not set.');
  expect(releases).toContain('Maven import now honors the `java-home` entry of the `intellij.projects` setting.');
  // Where the JDK of an import can come from, in the order the server lists the places.
  const jdk = source('buildtool.api/src/com/jetbrains/ls/buildtool/api/BuildJdk.kt');
  expect(/enum class BuildJdkSource \{([\s\S]+)\}/.exec(jdk)?.[1].match(/^ {4}[A-Z_]+(?=,)/gm)?.map(name => name.trim()))
    .toEqual(['PROJECT_JAVA_HOME', 'PROPERTY', 'PROJECT_ENV', 'AMBIENT_ENV', 'DETECTED', 'SERVER_JVM', 'WRAPPER', 'GRADLE_DAEMON_JVM']);
  for (const words of ['/** The `java-home` configured for the project. */', '/** `JAVA_HOME` in the `env` configured for the project. */', '/** `JAVA_HOME` of the server process. */',
    "/** The server's own JVM: the last fallback, which lives in a versioned server directory. */"]) expect(jdk).toContain(words);
  const parameters = source('buildtool.api/src/com/jetbrains/ls/buildtool/api/WorkspaceImportParameters.kt');
  expect(parameters).toContain('@property defaultSdkPath SDK to use for a project that does not configure its own');
  expect(parameters).toContain('@property javaHome JDK home used to run the import (overrides the ambient/default JDK)');
  expect(parameters).toContain('`javaHome` is honored by both the Maven and Gradle importers');
  // The extension passes its own environment on and names no JDK; the option is the person's setting.
  const client = source('vscode-extension-core/src/lspClient.ts');
  expect(client).not.toContain('JAVA_HOME');
  expect(client).toContain('const env = { ...baseEnv };');
  expect(client).toContain('defaultSdk: defaultSdk.value,');
  const properties = (JSON.parse(source('kotlin-vscode/package.json')).contributes.configuration as { properties: Record<string, { markdownDescription?: string; description?: string }> }[])
    .reduce<Record<string, { markdownDescription?: string; description?: string }>>((all, category) => ({ ...all, ...category.properties }), {});
  const described = properties['intellij.jdkForSymbolResolution'];
  expect(described.markdownDescription ?? described.description).toBe('Path to the JDK used for symbol resolution');
});
