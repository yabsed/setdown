// Controlled real-server observations for the accompanying report.
// Uses temporary fixtures and the repository's installed servers, not product UI.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { createMessageConnection, StreamMessageReader, StreamMessageWriter } = require('vscode-jsonrpc/node');
const output = path.dirname(fileURLToPath(import.meta.url));
const root = await mkdtemp('/var/tmp/setdown-builder-environments-');
const observations = [];

function section(settings, name) {
  if (!name) return settings;
  let value = settings;
  for (const key of name.split('.')) value = value?.[key];
  return value ?? null;
}

async function inspect({ name, executable, args, directory, file, text, languageId, settings = {}, initializationOptions, hover }) {
  const child = spawn(executable, args, { cwd: directory, env: process.env, stdio: 'pipe', shell: false });
  const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
  const uri = pathToFileURL(file).href;
  const diagnostics = [], logs = [];
  let stderr = '', rejectDiagnostic;
  const diagnosticReady = new Promise((resolve, reject) => {
    rejectDiagnostic = reject;
    connection.onNotification('textDocument/publishDiagnostics', event => {
      if (event.uri !== uri || event.version !== 1) return;
      diagnostics.push(event);
      resolve(event);
    });
  });
  // An early child failure must not create an unhandled diagnostic promise.
  void diagnosticReady.catch(() => {});
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-32000); });
  child.on('error', rejectDiagnostic);
  child.on('exit', (code, signal) => { if (!diagnostics.length) rejectDiagnostic(Error(`Server exited before diagnostics: ${signal ?? code}`)); });
  connection.onRequest('workspace/configuration', ({ items }) => items.map(item => section(settings, item.section)));
  connection.onRequest('workspace/workspaceFolders', () => [{ uri: pathToFileURL(directory).href, name: path.basename(directory) }]);
  connection.onRequest('client/registerCapability', () => null);
  connection.onRequest('window/workDoneProgress/create', () => null);
  for (const method of ['window/logMessage', 'window/showMessage']) connection.onNotification(method, params => logs.push(params));
  connection.onNotification('$/progress', () => {});
  connection.listen();
  let deadline;
  try {
    const run = async () => {
      const initialized = await connection.sendRequest('initialize', {
        processId: process.pid, rootUri: pathToFileURL(directory).href,
        workspaceFolders: [{ uri: pathToFileURL(directory).href, name: path.basename(directory) }],
        initializationOptions,
        capabilities: { workspace: { configuration: true, workspaceFolders: true },
          general: { positionEncodings: ['utf-16'] },
          textDocument: { publishDiagnostics: { versionSupport: true }, hover: { contentFormat: ['plaintext'] } } },
      });
      await connection.sendNotification('initialized', {});
      await connection.sendNotification('workspace/didChangeConfiguration', { settings });
      await connection.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId, version: 1, text } });
      await diagnosticReady;
      const hovered = hover ? await connection.sendRequest('textDocument/hover', { textDocument: { uri }, position: hover }) : undefined;
      return { name, executable, args, settings, serverInfo: initialized.serverInfo, diagnosticNotifications: diagnostics,
        lastDiagnostics: diagnostics.at(-1).diagnostics, hover: hovered, logs, stderr };
    };
    return await Promise.race([run(), new Promise((_, reject) => {
      deadline = setTimeout(() => reject(Error(`Observation deadline exceeded: ${name}`)), 20000);
    })]);
  } finally {
    clearTimeout(deadline);
    let stopDeadline;
    try {
      await Promise.race([connection.sendRequest('shutdown', null), new Promise((_, reject) => {
        stopDeadline = setTimeout(() => reject(Error('Shutdown deadline')), 1000);
      })]);
      await connection.sendNotification('exit');
    } catch { /* Always retire this temporary process below. */ }
    clearTimeout(stopDeadline);
    connection.dispose();
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('close', resolve));
      child.kill('SIGKILL');
      await exited;
    }
  }
}

try {
  const pythonRoot = path.join(root, 'python');
  const venv = path.join(pythonRoot, '.venv');
  await mkdir(pythonRoot);
  execFileSync('/usr/bin/python3', ['-m', 'venv', '--without-pip', venv], { cwd: pythonRoot });
  const interpreter = path.join(venv, 'bin', 'python');
  const purelib = execFileSync(interpreter, ['-I', '-c', 'import sysconfig; print(sysconfig.get_path("purelib"))'], { cwd: pythonRoot, encoding: 'utf8' }).trim();
  const module = path.join(purelib, 'setdown_audit_dependency');
  await mkdir(module, { recursive: true });
  await writeFile(path.join(module, '__init__.py'), 'answer: int = 42\n');
  await writeFile(path.join(module, 'py.typed'), '');
  const pythonFile = path.join(pythonRoot, 'main.py');
  const pythonText = 'import setdown_audit_dependency\nvalue = setdown_audit_dependency.answer\nprint(value)\n';
  await writeFile(pythonFile, pythonText);
  for (const [name, pythonPath] of [['python-host-interpreter', '/usr/bin/python3'], ['python-project-interpreter', interpreter]]) {
    observations.push(await inspect({ name, executable: process.execPath,
      args: [require.resolve('pyright/langserver.index.js'), '--stdio'], directory: pythonRoot,
      file: pythonFile, text: pythonText, languageId: 'python', initializationOptions: { disablePullDiagnostics: true },
      settings: { python: { pythonPath, analysis: { typeCheckingMode: 'off', diagnosticMode: 'openFilesOnly', autoSearchPaths: true, useLibraryCodeForTypes: true } } },
      hover: { line: 1, character: 1 } }));
  }

  const cppRoot = path.join(root, 'cpp');
  const includes = path.join(cppRoot, 'include');
  const build = path.join(root, 'external-build');
  await mkdir(includes, { recursive: true });
  await mkdir(build);
  const cppFile = path.join(cppRoot, 'main.cpp');
  const cppText = '#include "audit_helper.hpp"\nint main() { return audit_answer(); }\n';
  await writeFile(cppFile, cppText);
  await writeFile(path.join(includes, 'audit_helper.hpp'), '#pragma once\ninline int audit_answer() { return AUDIT_VALUE; }\n');
  await writeFile(path.join(build, 'compile_commands.json'), JSON.stringify([{ directory: cppRoot, file: cppFile,
    arguments: ['clang++', '-std=c++20', `-I${includes}`, '-DAUDIT_VALUE=42', '-c', cppFile] }], null, 2));
  for (const [name, args] of [['cpp-without-database-selection', ['--log=error', '-j=2']],
    ['cpp-with-database-selection', ['--log=error', '-j=2', `--compile-commands-dir=${build}`]]]) {
    observations.push(await inspect({ name, executable: process.env.SETDOWN_CLANGD_PATH || 'clangd', args,
      directory: cppRoot, file: cppFile, text: cppText, languageId: 'cpp', hover: { line: 1, character: 24 } }));
  }
  const summary = observations.map(item => ({ name: item.name, diagnostics: item.lastDiagnostics.length,
    messages: item.lastDiagnostics.map(diagnostic => ({ code: diagnostic.code, severity: diagnostic.severity, message: diagnostic.message })), hover: item.hover }));
  await writeFile(path.join(output, 'environment-observations.json'), JSON.stringify({ date: '2026-10-30', scope: 'Controlled real-server fixtures; not Setdown or Builder GUI execution',
    nodeVersion: process.version, pyrightVersion: require('pyright/package.json').version,
    pythonVersion: execFileSync('/usr/bin/python3', ['--version'], { encoding: 'utf8' }).trim(),
    clangdVersion: execFileSync(process.env.SETDOWN_CLANGD_PATH || 'clangd', ['--version'], { encoding: 'utf8' }).trim(),
    summary, observations }, null, 2) + '\n');
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
} finally {
  await rm(root, { recursive: true, force: true });
}
