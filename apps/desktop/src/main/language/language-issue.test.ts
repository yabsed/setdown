import { expect, test } from 'vitest';
import { failureLine, outdatedIssue, preparationIssue, runtimeIssue, sessionIssue, withoutZedSettings } from './language-issue';

const jvmUsage = 'Usage: java [options] <mainclass> [args...]\n   (to execute a class)\n   or  java [options] -jar <jarfile> [args...]';

test('a program the person chose that ends before answering is the cause, not a stopped tool', () => {
  // The Java case: the JVM itself was selected as the "java" language server.
  expect(sessionIssue({ started: false, reason: 'java language server exited (1).', stderr: jvmUsage, pinned: '/usr/lib/jvm/java-17/bin/java' }))
    .toEqual({ kind: 'executable', path: '/usr/lib/jvm/java-17/bin/java' });
  expect(sessionIssue({ started: true, reason: 'exited (SIGSEGV).', stderr: '', pinned: '/usr/bin/clangd' })).toEqual({ kind: 'crashed' });
});

test('a runtime the tool names is reported ahead of the program that needed it', () => {
  const jdtls = 'Traceback (most recent call last):\n  File "jdtls.py", line 40, in get_java_executable\n    raise Exception("jdtls requires at least Java 21")\nException: jdtls requires at least Java 21';
  expect(sessionIssue({ started: false, reason: 'jdtls language server exited (1).', stderr: jdtls, pinned: '/opt/jdtls/bin/jdtls', runtimeFound: '17' }))
    .toEqual({ kind: 'runtime', runtime: 'Java', required: '21', found: '17' });
  expect(runtimeIssue('java.lang.UnsupportedClassVersionError: Main has been compiled by a more recent version (class file version 65.0)')).toMatchObject({ runtime: 'Java', required: '21' });
  expect(runtimeIssue("/usr/bin/env: ‘node’: No such file or directory")).toEqual({ kind: 'runtime', runtime: 'Node.js', required: '' });
  expect(runtimeIssue("FileNotFoundError: [Errno 2] No such file or directory: 'java'")).toMatchObject({ runtime: 'Java' });
  expect(runtimeIssue('You must install .NET to run this application.')).toMatchObject({ runtime: '.NET' });
  // A missing project file is not a runtime.
  expect(runtimeIssue("No such file or directory: 'compile_commands.json'")).toBeUndefined();
});

test('the Zed Java extension states a Java problem before any process starts', () => {
  const old = 'Failed to build JDTLS launch arguments: Current JDTLS versions require at least Java version 25 to run. You can either specify a different JDK to use by configuring lsp.jdtls.settings.java_home to point to a different JDK, or set lsp.jdtls.settings.jdk_auto_download to true to let the extension automatically download one for you.';
  expect(preparationIssue(Error(old), false)).toEqual({ kind: 'runtime', runtime: 'Java', required: '25' });
  expect(preparationIssue(Error(old), false, { required: 25, found: '17' })).toEqual({ kind: 'runtime', runtime: 'Java', required: '25', found: '17' });
  // No Java at all: the extension names no release, and Setdown knows which one the tool needs.
  const missing = 'Failed to build JDTLS launch arguments: Failed to locate Java executable for JDTLS: Could not find Java executable in JAVA_HOME or on PATH';
  expect(preparationIssue(Error(missing), false)).toEqual({ kind: 'runtime', runtime: 'Java', required: '' });
  expect(preparationIssue(Error(missing), false, { required: 25 })).toEqual({ kind: 'runtime', runtime: 'Java', required: '25' });
  // What Setdown knew about Java does not turn another failure into a Java problem.
  expect(preparationIssue(Error('error sending request for url (https://download.eclipse.org/jdtls)'), false, { required: 25, found: '17' })).toMatchObject({ kind: 'download-failed' });
});

test('an unexplained start failure keeps the line a person would read first', () => {
  expect(sessionIssue({ started: false, reason: 'exited (1).', stderr: 'loading config\nerror: unknown option --stdio\n    at main (index.js:1)\n\nNode.js v22.1.0\n' }))
    .toEqual({ kind: 'startup', detail: 'error: unknown option --stdio' });
  expect(sessionIssue({ started: false, reason: 'exited (1).', stderr: '' })).toEqual({ kind: 'startup' });
  // Words this does not know: a few lines are given whole, of many only the last.
  expect(failureLine('first\nsecond\n')).toBe('first second');
  expect(failureLine(Array.from({ length: 9 }, (_, index) => `line ${index + 1}`).join('\n'))).toBe('line 9');
});
test('a tool that speaks another language still says why it stopped: R in Korean without its language server package', () => {
  const stderr = 'loadNamespace(x)에서 다음과 같은 에러가 발생했습니다: \n  ‘languageserver’이라고 불리는 패키지가 없습니다\n호출: loadNamespace -> withRestarts -> withOneRestart -> doWithOneRestart\n실행이 정지되었습니다\n';
  const issue = sessionIssue({ started: false, reason: 'exited (1).', stderr });
  expect(issue).toMatchObject({ kind: 'startup' });
  expect((issue as { detail?: string }).detail).toContain('‘languageserver’이라고 불리는 패키지가 없습니다');
});

test('preparation separates a policy, a missing installer and a failed download', () => {
  expect(preparationIssue(Error('anything'), true)).toEqual({ kind: 'downloads-off' });
  expect(preparationIssue(Error('No automatic installer is available for nil. Configure its executable in Language Support.'), false)).toEqual({ kind: 'no-installer' });
  expect(preparationIssue(Error('error sending request: network is unreachable'), false)).toEqual({ kind: 'download-failed', detail: 'error sending request: network is unreachable' });
});
test('a tool whose program is not on this computer is not installed, whatever was tried: nothing explains it better and nothing is gained by starting it again', () => {
  // Zed's Swift extension names sourcekit-lsp, which comes with the Swift toolchain, and downloads nothing.
  expect(sessionIssue({ started: false, reason: 'sourcekit-lsp: spawn sourcekit-lsp ENOENT', stderr: '' })).toEqual({ kind: 'no-installer' });
  // What the session recorded for Swift on a computer without it: the Zed extension points at macOS's xcrun.
  expect(sessionIssue({ started: false, reason: 'sourcekit-lsp: spawn /usr/bin/xcrun ENOENT. Open Edit → Language Support to select an installed executable.', stderr: '' })).toEqual({ kind: 'no-installer' });
  // A file an extension downloaded into Setdown's own folder and that is gone is not a program to install by hand.
  expect(sessionIssue({ started: false, reason: 'elixir-ls: spawn /home/a person/.config/Setdown/language-packages/extensions/work/elixir/elixir-ls-v0.31.1/launch.sh ENOENT', stderr: '' })).toEqual({ kind: 'startup' });
  // A program the person chose is theirs to correct; a missing runtime is named as that.
  expect(sessionIssue({ started: false, reason: 'tool: spawn /opt/tool/bin/tool ENOENT', stderr: '', pinned: '/opt/tool/bin/tool' })).toEqual({ kind: 'executable', path: '/opt/tool/bin/tool' });
  expect(sessionIssue({ started: false, reason: 'tool: spawn node ENOENT', stderr: '' })).toMatchObject({ kind: 'runtime', runtime: 'Node.js' });
  // A program Setdown put somewhere itself is another matter: its path is known, and it is gone.
  expect(sessionIssue({ started: false, reason: 'tool: spawn /home/person/.config/Setdown/language-packages/tool ENOENT', stderr: '' })).toEqual({ kind: 'startup' });
});
test('what an extension says about a tool it cannot set up is shown as the sentence it is', () => {
  expect(preparationIssue(Error('from extension "Fortran" version 0.1.0: failed to unpack the archive of fortls'), false))
    .toEqual({ kind: 'download-failed', detail: 'failed to unpack the archive of fortls' });
});
test('a tool its extension does not download is one the person installs, not a download to try again', () => {
  // The sentences are those of the Zed extensions for Nix 0.1.5, Scala 0.2.5, Dart 0.4.1 and Julia 0.2.8.
  expect(preparationIssue(Error(`from extension "Nix" version 0.1.5: nil must be installed manually. Install it or specify the 'binary' path to it via local settings.`), false))
    .toEqual({ kind: 'no-installer', detail: 'nil must be installed manually.' });
  expect(preparationIssue(Error('from extension "Scala" version 0.2.5: Metals must be installed manually. Recommended way is to install coursier (https://get-coursier.io/), and then run `cs install metals`.'), false))
    .toEqual({ kind: 'no-installer', detail: 'Metals must be installed manually. Recommended way is to install coursier (https://get-coursier.io/), and then run `cs install metals`.' });
  // The tool comes with the language itself: what is missing is named as that.
  expect(preparationIssue(Error('from extension "Dart" version 0.4.1: dart must be installed from dart.dev/get-dart or pointed to by the LSP binary settings'), false))
    .toEqual({ kind: 'runtime', runtime: 'Dart', required: '' });
  expect(preparationIssue(Error(`from extension "Julia" version 0.2.8: Unable to find Julia command 'julia'. Make sure it is available in the worktree PATH or specify its full path in Zed settings.`), false))
    .toEqual({ kind: 'runtime', runtime: 'Julia', required: '' });
  // One sentence that names Zed's settings as the other way keeps what comes before it.
  expect(withoutZedSettings('tool must be installed from example.org/tool or pointed to by the LSP binary settings')).toBe('tool must be installed from example.org/tool');
});
test('a tool started by a script names the runtime its shell did not find', () => {
  const zsh = 'Running /packages/elixir-ls-v0.31.1/launch.sh\nPreferred shell is zsh, relaunching\n/packages/elixir-ls-v0.31.1/launch.sh:149: command not found: elixir\n';
  expect(sessionIssue({ started: false, reason: 'exited (127).', stderr: zsh })).toEqual({ kind: 'runtime', runtime: 'Elixir', required: '' });
  expect(runtimeIssue('launch.sh: line 149: elixir: command not found\n')).toEqual({ kind: 'runtime', runtime: 'Elixir', required: '' });
  // A program that is no runtime this knows stays the tool's own failure.
  expect(runtimeIssue('launch.sh:3: command not found: frobnicate\n')).toBeUndefined();
});

/** What JetBrains' Kotlin server 271.2085.0 (built 2026-11-03) wrote on 2026-11-27 before it
 * ended, as the installed application logged it. */
const expiredKotlin = ['WARNING: kotlin-lsp.sh is deprecated and will be removed in a future release. Use bin/intellij-server instead.', 'IJ_JAVA_OPTIONS=',
  'idea.config.path=/tmp/idea-system281559644452388692/config', 'idea.system.path=/tmp/idea-system281559644452388692/system',
  'Log file: /tmp/idea-system281559644452388692/system/log/intellij-server.log', 'This build of kotlin-server has expired.', 'The IDE will now close.',
  'Please download a new build from https://github.com/kotlin/kotlin-lsp'].join('\n');

test('a tool that says its own build has expired is outdated, in its own sentence', () => {
  expect(sessionIssue({ started: false, reason: 'kotlin-lsp language server disconnected.', stderr: expiredKotlin }))
    .toEqual({ kind: 'outdated', detail: 'This build of kotlin-server has expired.' });
  // Choosing the same program again helps nobody: its age comes before whose program it is.
  expect(sessionIssue({ started: false, reason: 'exited (1).', stderr: expiredKotlin, pinned: '/opt/kotlin/bin/intellij-server' })).toMatchObject({ kind: 'outdated' });
  // The line a person reads is the reason, not the advice after it or the warning before it.
  expect(failureLine(expiredKotlin)).toBe('This build of kotlin-server has expired.');
  expect(outdatedIssue('This version of the server is no longer supported. Please upgrade.')).toMatchObject({ kind: 'outdated' });
});

test('something else that expired is not the tool\'s age', () => {
  expect(outdatedIssue('Your JetBrains license has expired or is no longer valid.')).toBeUndefined();
  expect(outdatedIssue('Your completion session has expired, please try again')).toBeUndefined();
  expect(outdatedIssue('error: the lock file is out of date')).toBeUndefined();
  // A tool that worked and then stopped has crashed, whatever it wrote.
  expect(sessionIssue({ started: true, reason: 'exited (1).', stderr: expiredKotlin })).toEqual({ kind: 'crashed' });
});
