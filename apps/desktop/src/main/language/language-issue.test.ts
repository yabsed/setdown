import { expect, test } from 'vitest';
import { failureLine, preparationIssue, runtimeIssue, sessionIssue } from './language-issue';

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
  expect(failureLine('first\nsecond\n')).toBe('second');
});

test('preparation separates a policy, a missing installer and a failed download', () => {
  expect(preparationIssue(Error('anything'), true)).toEqual({ kind: 'downloads-off' });
  expect(preparationIssue(Error('No automatic installer is available for nil. Configure its executable in Language Support.'), false)).toEqual({ kind: 'no-installer' });
  expect(preparationIssue(Error('error sending request: network is unreachable'), false)).toEqual({ kind: 'download-failed', detail: 'error sending request: network is unreachable' });
});
