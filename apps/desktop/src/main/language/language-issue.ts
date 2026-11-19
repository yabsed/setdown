import type { LanguageIssue } from '../../protocol/language';

/** What the session recorded when it ended. `started` separates a tool that never
 * answered `initialize` from one that worked and then stopped. */
export type FailureFacts = { started: boolean; reason: string; stderr: string;
  /** The executable the user selected for this tool, when the launch used it. */
  pinned?: string;
  /** Major version of the runtime the launch would have used, when known. */
  runtimeFound?: string };

const runtimeNames: Record<string, string> = { java: 'Java', node: 'Node.js', nodejs: 'Node.js', python: 'Python', python3: 'Python', dotnet: '.NET', ruby: 'Ruby', php: 'PHP', perl: 'Perl' };
export const runtimeHelp: Record<string, string> = {
  Java: 'https://adoptium.net/', 'Node.js': 'https://nodejs.org/en/download', Python: 'https://www.python.org/downloads/',
  '.NET': 'https://dotnet.microsoft.com/download', Ruby: 'https://www.ruby-lang.org/en/downloads/', PHP: 'https://www.php.net/downloads', Perl: 'https://www.perl.org/get.html' };

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
    ?? /No such file or directory: ['"]([\w.-]+)['"]/.exec(output) ?? /spawn ([\w.-]+) ENOENT/.exec(output);
  const runtime = missing && runtimeNames[missing[1].toLowerCase().replace(/[\d.]+$/, '')];
  return runtime ? { kind: 'runtime', runtime, required: '' } : undefined;
}

/** The line a person would read first: the last one that states a problem, else the last one. */
export function failureLine(output: string): string | undefined {
  const lines = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const stated = [...lines].reverse().find(line => /error|exception|cannot|can't|could not|couldn't|not found|no such|failed|fatal|denied|panic|invalid|missing|unable/i.test(line));
  return (stated ?? lines.at(-1))?.slice(0, 240);
}

export function sessionIssue(facts: FailureFacts): LanguageIssue {
  if (facts.started) return { kind: 'crashed' };
  const runtime = runtimeIssue(`${facts.stderr}\n${facts.reason}`, facts.runtimeFound);
  if (runtime) return runtime;
  if (facts.pinned) return { kind: 'executable', path: facts.pinned };
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
  const detail = failureLine(text);
  const runtime = runtimeIssue(text);
  if (runtime?.runtime === 'Java' && java) return { ...runtime, required: runtime.required || String(java.required), ...(runtime.found ?? java.found ? { found: runtime.found ?? java.found } : {}) };
  return runtime ?? { kind: 'download-failed', ...(detail ? { detail } : {}) };
}
