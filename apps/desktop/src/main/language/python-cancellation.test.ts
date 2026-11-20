import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, expect, test } from 'vitest';
import { CancellationReceiverStrategy, CancellationStrategy, CancellationTokenSource, createMessageConnection, StreamMessageReader, StreamMessageWriter,
  type MessageConnection } from 'vscode-jsonrpc/node';
import { cancellationArgument, cancellationFileName, cancellationParentFolder, pythonCancellation, temporaryFolderOf } from './python-cancellation';

const vendor = path.resolve(__dirname, '../../../../../vendor');
const source = (file: string) => readFileSync(path.join(vendor, file), 'utf8');
const temporary: string[] = [];
const disposals: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const place = () => { const directory = mkdtempSync(path.join(os.tmpdir(), 'setdown-cancel-')); temporary.push(directory); return directory; };
/** The folder the server works out from the argument, as `getCancellationFolderPath` does. */
const folderOf = (temporaryFolder: string, args: string[]) => path.join(temporaryFolder, cancellationParentFolder, /^--cancellationReceive=file:(.+)$/.exec(args[0])![1]);
const noConnection = undefined as unknown as MessageConnection;
const until = async (condition: () => boolean) => { for (let turn = 0; turn < 400 && !condition(); turn++) await new Promise(resolve => setTimeout(resolve, 5)); expect(condition()).toBe(true); };

test('the folder is made where the server looks, under a name of 42 hex digits', () => {
  const temporaryFolder = place(), cancellation = pythonCancellation(temporaryFolder);
  disposals.push(() => cancellation.dispose());
  expect(cancellation.args).toHaveLength(1);
  expect(cancellation.args[0]).toMatch(/^--cancellationReceive=file:[0-9a-f]{42}$/);
  expect(statSync(folderOf(temporaryFolder, cancellation.args)).isDirectory()).toBe(true);
  expect(readdirSync(path.join(temporaryFolder, cancellationParentFolder))).toHaveLength(1);
  // Each server gets a folder of its own.
  const other = pythonCancellation(temporaryFolder);
  disposals.push(() => other.dispose());
  expect(other.args[0]).not.toBe(cancellation.args[0]);
});

test('a cancellation is an empty file named after the request, gone once the request is answered', async () => {
  const temporaryFolder = place(), cancellation = pythonCancellation(temporaryFolder), folder = folderOf(temporaryFolder, cancellation.args);
  disposals.push(() => cancellation.dispose());
  const { sender, receiver } = cancellation.strategy;
  await sender.sendCancellation(noConnection, 7);
  expect(readdirSync(folder)).toEqual(['cancellation-7.tmp']);
  expect(statSync(path.join(folder, 'cancellation-7.tmp')).size).toBe(0);
  // Cancelling twice, and cleaning up what was never cancelled, are both quiet.
  await sender.sendCancellation(noConnection, 7);
  await sender.sendCancellation(noConnection, 'abc');
  sender.cleanup(99);
  expect(readdirSync(folder).sort()).toEqual(['cancellation-7.tmp', 'cancellation-abc.tmp']);
  sender.cleanup(7);
  expect(readdirSync(folder)).toEqual(['cancellation-abc.tmp']);
  // An id that would name a file outside the folder writes nothing.
  await sender.sendCancellation(noConnection, '../../escaped');
  await sender.sendCancellation(noConnection, `x${path.sep}y`);
  sender.cleanup('../../escaped');
  expect(readdirSync(folder)).toEqual(['cancellation-abc.tmp']);
  expect(readdirSync(temporaryFolder)).toEqual([cancellationParentFolder]);
  // The server cancels its own requests to the editor by message.
  expect(receiver).toBe(CancellationReceiverStrategy.Message);
});

test('dispose removes the folder with what is left in it, and nothing is written afterwards', async () => {
  const temporaryFolder = place(), cancellation = pythonCancellation(temporaryFolder), folder = folderOf(temporaryFolder, cancellation.args);
  await cancellation.strategy.sender.sendCancellation(noConnection, 1);
  cancellation.dispose();
  expect(existsSync(folder)).toBe(false);
  expect(existsSync(path.join(temporaryFolder, cancellationParentFolder))).toBe(true);
  await expect(cancellation.strategy.sender.sendCancellation(noConnection, 2)).resolves.toBeUndefined();
  cancellation.strategy.sender.cleanup(2);
  cancellation.dispose();
  expect(existsSync(folder)).toBe(false);
});

test('a folder that cannot be made leaves the server without the argument and cancels by message', () => {
  const temporaryFolder = place(), blocked = path.join(temporaryFolder, 'a-file');
  writeFileSync(blocked, '');
  const cancellation = pythonCancellation(blocked);
  expect(cancellation.args).toEqual([]);
  expect(cancellation.strategy).toBe(CancellationStrategy.Message);
  expect(() => cancellation.dispose()).not.toThrow();
});

/** A connection to a server that answers `slow` only when released, with every byte the editor wrote. */
function connected(strategy?: CancellationStrategy) {
  const toServer = new PassThrough(), toClient = new PassThrough();
  let written = '';
  toServer.on('data', chunk => { written += String(chunk); });
  const client = createMessageConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer), undefined, strategy && { cancellationStrategy: strategy });
  const server = createMessageConnection(new StreamMessageReader(toServer), new StreamMessageWriter(toClient));
  const state = { started: false, cancelled: false, release: (_answer: string) => {} };
  server.onRequest('slow', (_params, token) => new Promise<string>(resolve => {
    state.started = true; state.release = resolve;
    token.onCancellationRequested(() => { state.cancelled = true; });
  }));
  client.listen(); server.listen();
  disposals.push(() => { client.dispose(); server.dispose(); });
  return { client, state, written: () => written };
}

test('on a connection made with the strategy a cancelled request writes its file and sends no $/cancelRequest', async () => {
  const temporaryFolder = place(), cancellation = pythonCancellation(temporaryFolder), folder = folderOf(temporaryFolder, cancellation.args);
  disposals.push(() => cancellation.dispose());
  const { client, state, written } = connected(cancellation.strategy);
  const token = new CancellationTokenSource();
  const answer = client.sendRequest<string>('slow', { file: 'a.py' }, token.token);
  await until(() => state.started);
  const id = (JSON.parse(written().slice(written().indexOf('{'))) as { id: number }).id;
  expect(readdirSync(folder)).toEqual([]);
  token.cancel();
  await until(() => existsSync(path.join(folder, cancellationFileName(id))));
  // Time for a message to arrive, had one been sent.
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(written()).not.toContain('$/cancelRequest');
  expect(state.cancelled).toBe(false);
  // The answer, late or as an error, removes the file.
  state.release('late');
  await expect(answer).resolves.toBe('late');
  expect(readdirSync(folder)).toEqual([]);
});

test('without the strategy the same cancellation is the $/cancelRequest message', async () => {
  const { client, state, written } = connected();
  const token = new CancellationTokenSource();
  const answer = client.sendRequest<string>('slow', { file: 'a.py' }, token.token);
  await until(() => state.started);
  token.cancel();
  await until(() => state.cancelled);
  expect(written()).toContain('"method":"$/cancelRequest"');
  state.release('late');
  await expect(answer).resolves.toBe('late');
});

test('the temporary folder is the one Node answers for the server\'s environment', () => {
  expect(temporaryFolderOf(process.env)).toBe(os.tmpdir());
  expect(temporaryFolderOf({ TMPDIR: '/a/', TMP: '/b', TEMP: '/c' }, 'linux')).toBe('/a');
  expect(temporaryFolderOf({ TMPDIR: '', TMP: '/b', TEMP: '/c' }, 'linux')).toBe('/b');
  expect(temporaryFolderOf({ TEMP: '/c' }, 'darwin')).toBe('/c');
  // Not a name Node reads.
  expect(temporaryFolderOf({ TEMPDIR: '/d' }, 'linux')).toBe('/tmp');
  expect(temporaryFolderOf({}, 'linux')).toBe('/tmp');
  expect(temporaryFolderOf({ TMPDIR: '/' }, 'linux')).toBe('/');
  expect(temporaryFolderOf({ TMPDIR: '/a//' }, 'linux')).toBe('/a/');
  expect(temporaryFolderOf({ TEMP: 'C:\\Users\\me\\AppData\\Local\\Temp\\', TMP: 'D:\\t' }, 'win32')).toBe('C:\\Users\\me\\AppData\\Local\\Temp');
  expect(temporaryFolderOf({ TMP: 'D:\\' }, 'win32')).toBe('D:\\');
  expect(temporaryFolderOf({ temp: 'E:\\t' }, 'win32')).toBe('E:\\t');
  expect(temporaryFolderOf({ SystemRoot: 'C:\\Windows' }, 'win32')).toBe('C:\\Windows\\temp');
  expect(temporaryFolderOf({ windir: 'C:\\WINNT' }, 'win32')).toBe('C:\\WINNT\\temp');
  // The rule is the running Node's own.
  const node = os.tmpdir.toString();
  expect(node).toContain("process.env.TEMP ||");
  expect(node).toContain("(process.env.SystemRoot || process.env.windir) + '\\\\temp'");
  expect(node).toContain("path[path.length - 1] === '\\\\' && path[path.length - 2] !== ':'");
  expect(node).toContain("getTempDir() || '/tmp'");
});

test('the folder, the file, the argument and both directions are the ones the Pyright client and server use', () => {
  const client = source('pyright/packages/vscode-pyright/src/cancellationUtils.ts');
  expect(client).toContain(`return path.join(os.tmpdir(), '${cancellationParentFolder}', folderName);`);
  expect(client).toContain('return path.join(getCancellationFolderPath(folderName), `cancellation-${String(id)}.tmp`);');
  expect(cancellationFileName(12)).toBe('cancellation-12.tmp');
  expect(client).toContain('return [`--cancellationReceive=file:${this._sender.folderName}`];');
  expect(cancellationArgument('abc')).toBe('--cancellationReceive=file:abc');
  expect(client).toContain('const folderName = randomBytesHex(21);');
  expect(client).toContain("tryRun(() => fs.mkdirSync(folder, { recursive: true }));");
  expect(client).toContain("tryRun(() => fs.writeFileSync(file, '', { flag: 'w' }));");
  expect(client).toContain('tryRun(() => fs.unlinkSync(getCancellationFilePath(this.folderName, id)));');
  expect(client).toMatch(/get receiver\(\): CancellationReceiverStrategy \{\s+return CancellationReceiverStrategy\.Message;/);
  // Where the client hands both to the library and to the server.
  const extension = source('pyright/packages/vscode-pyright/src/extension.ts');
  expect(extension).toContain('connectionOptions: { cancellationStrategy: cancellationStrategy },');
  expect(extension).toContain('args: cancellationStrategy.getCommandLineArguments(),');
  expect(extension).toMatch(/export function deactivate\(\) \{\s+if \(cancellationStrategy\) \{\s+cancellationStrategy\.dispose\(\);/);

  const server = source('pyright/packages/pyright-internal/src/common/fileBasedCancellationUtils.ts');
  expect(server).toContain(`return path.join(os.tmpdir(), '${cancellationParentFolder}', folderName);`);
  expect(server).toContain('return UriEx.file(path.join(getCancellationFolderPath(folderName), `cancellation-${String(id)}.tmp`)).toString();');
  expect(server).toContain("if (args[0] === '--cancellationReceive') {");
  expect(server).toContain('const fileRegex = /^file:(.+)$/;');
  expect(server).toContain('return { receiver, sender: CancellationSenderStrategy.Message };');
  expect(source('pyright/packages/pyright-internal/src/nodeServer.ts')).toContain('return { cancellationStrategy: getCancellationStrategyFromArgv(process.argv) };');
  // The server looks for the file at most once every 5 ms.
  expect(source('pyright/packages/pyright-internal/src/common/cancellationUtils.ts')).toContain('const minTimeBetweenChecksInMs = 5;');
  // The argument is also what starts the background analysis thread.
  expect(source('pyright/packages/pyright-internal/src/server.ts')).toMatch(/isDebugMode\(\) \|\| !getCancellationFolderName\(\)\s+\? undefined\s+: new BackgroundAnalysis\(workspaceRoot, services\)/);
});

test('the Python extension and basedpyright cancel the same way', () => {
  const python = source('vscode-python/src/client/activation/common/cancellationUtils.ts');
  expect(python).toContain(`return path.join(os.tmpdir(), '${cancellationParentFolder}', folderName);`);
  expect(python).toContain('`cancellation-${String(id)}.tmp`');
  expect(python).toContain("const folderName = randomBytes(21).toString('hex');");
  expect(python).toContain('return [`--cancellationReceive=file:${this._sender.folderName}`];');
  expect(source('basedpyright/packages/vscode-pyright/src/cancellationUtils.ts')).toBe(source('pyright/packages/vscode-pyright/src/cancellationUtils.ts'));
  expect(source('basedpyright/packages/pyright-internal/src/common/fileBasedCancellationUtils.ts')).toContain(`return path.join(os.tmpdir(), '${cancellationParentFolder}', folderName);`);
});
