import type { LanguageIssue } from '../../protocol/language';

/** What the session recorded when it ended. `started` separates a tool that never
 * answered `initialize` from one that worked and then stopped. */
export type FailureFacts = { started: boolean; reason: string; stderr: string;
  /** The executable the user selected for this tool, when the launch used it. */
  pinned?: string;
  /** Major version of the runtime the launch would have used, when known. */
  runtimeFound?: string };

const runtimeNames: Record<string, string> = { java: 'Java', node: 'Node.js', nodejs: 'Node.js', python: 'Python', python3: 'Python', dotnet: '.NET', ruby: 'Ruby', php: 'PHP', perl: 'Perl', elixir: 'Elixir', julia: 'Julia', dart: 'Dart' };
export const runtimeHelp: Record<string, string> = {
  Java: 'https://adoptium.net/', 'Node.js': 'https://nodejs.org/en/download', Python: 'https://www.python.org/downloads/',
  '.NET': 'https://dotnet.microsoft.com/download', Ruby: 'https://www.ruby-lang.org/en/downloads/', PHP: 'https://www.php.net/downloads', Perl: 'https://www.perl.org/get.html',
  Elixir: 'https://elixir-lang.org/install.html', Julia: 'https://julialang.org/downloads/', Dart: 'https://dart.dev/get-dart' };

/** Tools state a missing or outdated runtime in their own words. Only wording that
 * names the runtime is recognized; everything else stays an unexplained failure. */
export function runtimeIssue(output: string, found?: string): Extract<LanguageIssue, { kind: 'runtime' }> | undefined {
  // jdtls.py says "requires at least Java 21"; the Zed Java extension says "require at least Java version 25".
  const java = /requires? (?:at least )?(?:Java|JDK|JRE)(?: version)? (\d+)/i.exec(output) ?? /(?:Java|JDK|JRE) (\d+)(?: or (?:newer|later|higher|above)|\+) is required/i.exec(output);
  if (java) return { kind: 'runtime', runtime: 'Java', required: java[1], ...(found ? { found } : {}) };
  // The Zed Java extension, when neither `JAVA_HOME` nor PATH has a Java.
  if (/Could not find Java executable/i.test(output)) return { kind: 'runtime', runtime: 'Java', required: '' };
  // A class file version is the Java major version plus 44.
  const classFile = /UnsupportedClassVersionError[^\n]*class file version (\d+)/.exec(output);
  if (classFile) return { kind: 'runtime', runtime: 'Java', required: String(Number(classFile[1]) - 44), ...(found ? { found } : {}) };
  if (/You must install(?: or update)? \.NET to run this application/i.test(output)) return { kind: 'runtime', runtime: '.NET', required: '' };
  // `env` reports a missing interpreter of a script's first line; Python reports a missing child program.
  const missing = /env: ['‘"]?([\w.-]+)['’"]?: No such file or directory/.exec(output)
    ?? /No such file or directory: ['"]([\w.-]+)['"]/.exec(output) ?? /spawn ([\w.-]+) ENOENT/.exec(output)
    // A tool started by a script (ElixirLS's launch.sh): the shell says which program it lacks, zsh and bash each in their order.
    ?? /command not found: ([\w.-]+)\s*$/m.exec(output) ?? /(?:^|[\s:])([\w.-]+): command not found\s*$/m.exec(output)
    // Zed's extensions for languages whose tool comes with the language: "Unable to find Julia command 'julia'", "dart must be installed from…".
    ?? /Unable to find \w+ command ['"]([\w.-]+)['"]/.exec(output) ?? /(?:^|:\s)([\w.-]+) must be installed\b/m.exec(output);
  const runtime = missing && runtimeNames[missing[1].toLowerCase().replace(/[\d.]+$/, '')];
  return runtime ? { kind: 'runtime', runtime, required: '' } : undefined;
}

/** The line a person would read first: the last one that states a problem.
 *
 * A tool that speaks the person's own language states its problem in words this does not know,
 * and its last line is then often only that it stopped: R in Korean ends with "실행이 정지되었습니다"
 * ("Execution halted") two lines after naming the package it lacks. A few lines are given whole,
 * so that the reason is among them; of a long output, the last line. */
export function failureLine(output: string): string | undefined {
  const lines = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const stated = [...lines].reverse().find(line => /error|exception|cannot|can't|could not|couldn't|not found|no such|failed|fatal|denied|panic|invalid|missing|unable/i.test(line));
  return (stated ?? (lines.length <= 6 ? lines.join(' ') : lines.at(-1)))?.slice(0, 240) || undefined;
}

export function sessionIssue(facts: FailureFacts): LanguageIssue {
  if (facts.started) return { kind: 'crashed' };
  const runtime = runtimeIssue(`${facts.stderr}\n${facts.reason}`, facts.runtimeFound);
  if (runtime) return runtime;
  if (facts.pinned) return { kind: 'executable', path: facts.pinned };
  // The program to start is not on this computer, and it is not one Setdown put there itself.
  // Zed's extension for a language may point at a program it does not download: sourcekit-lsp
  // comes with Swift, and where it is not found the extension names macOS's `/usr/bin/xcrun`.
  // Starting it again finds the same nothing; the person installs it, or says where it is.
  const missing = /\bspawn (.+?) ENOENT\b/.exec(facts.reason)?.[1];
  if (missing && !/[\\/]language-packages[\\/]/.test(missing)) return { kind: 'no-installer' };
  const detail = failureLine(facts.stderr);
  return { kind: 'startup', ...(detail ? { detail } : {}) };
}

/** Preparation ends before any process starts: nothing was downloaded, or an installer failed.
 * `java` is what Setdown knew before it asked: the release the tool needs and the one it found.
 * It completes a Java problem the tool stated without those numbers. */
export function preparationIssue(error: unknown, downloadsDisabled: boolean, java?: { required: number; found?: string }): LanguageIssue {
  if (downloadsDisabled) return { kind: 'downloads-off' };
  const text = String(error instanceof Error ? error.message : error);
  if (/No automatic installer is available/.test(text)) return { kind: 'no-installer' };
  // Zed says which extension spoke before what it said ("from extension "Dart" version 0.4.1: dart
  // must be installed…"). The sentence is what a person reads; the log keeps where it came from.
  const detail = failureLine(text.replace(/^(\s*)from extension "[^"\n]*" version \S+: /gm, '$1'));
  const runtime = runtimeIssue(text);
  if (runtime?.runtime === 'Java' && java) return { ...runtime, required: runtime.required || String(java.required), ...(runtime.found ?? java.found ? { found: runtime.found ?? java.found } : {}) };
  if (runtime) return runtime;
  // The extension knows of no download ("nil must be installed manually"): trying again finds the
  // same nothing. The person installs the program, or says where it is.
  if (detail && /\bmust be installed\b/i.test(detail)) return { kind: 'no-installer', detail: withoutZedSettings(detail) };
  return { kind: 'download-failed', ...(detail ? { detail } : {}) };
}

/** An extension's advice ends with the other way Zed has: a path written in Zed's settings
 * ("Install it or specify the 'binary' path to it via local settings."). Setdown has no such
 * settings; its other way is the button beside the sentence. */
export function withoutZedSettings(advice: string): string {
  const kept = advice.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(sentence => !/\bsettings\b/i.test(sentence));
  return (kept.length ? kept.join(' ') : advice.replace(/\s+or\s+[^.]*\bsettings\b.*$/i, '')).trim();
}
