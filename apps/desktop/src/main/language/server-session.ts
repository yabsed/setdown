import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { subscribe, type AsyncSubscription } from '@parcel/watcher';
import { CancellationTokenSource, createMessageConnection, StreamMessageReader, StreamMessageWriter,
  type MessageConnection } from 'vscode-jsonrpc/node';
import type { ServerProfile } from './server-definitions';
import type { InitializeResult, PublishDiagnosticsParams, ServerCapabilities } from 'vscode-languageserver-protocol';

export type ServerLaunch = { executable: string; args: string[]; env?: NodeJS.ProcessEnv };
const genericProfile: ServerProfile = { name: 'Language', configuration: {}, watches: () => false };

/** Official JSON-RPC owns framing and cancellation; this class owns process lifetime. */
export class ServerSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly connection: MessageConnection;
  private stopped = false;
  private stderr = '';
  private failureMessage: string | undefined;
  private readonly exited: Promise<void>;
  private stopping: Promise<void> | undefined;
  private watcher: Promise<AsyncSubscription> | undefined;
  private readonly pending = new Set<CancellationTokenSource>();
  private inFlight = 0;
  private readonly fail: (reason: string) => void;
  readonly ready: Promise<ServerCapabilities>;

  constructor(launch: ServerLaunch, root: string,
    diagnostics: (params: PublishDiagnosticsParams) => void, failed: (message: string) => void, private readonly profile = genericProfile) {
    this.child = spawn(launch.executable, launch.args, {
      cwd: root, env: launch.env, stdio: 'pipe', windowsHide: true, shell: false,
    });
    this.exited = new Promise(resolve => this.child.once('close', () => resolve()));
    this.connection = createMessageConnection(new StreamMessageReader(this.child.stdout), new StreamMessageWriter(this.child.stdin));
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + String(chunk)).slice(-8192); });
    const fail = this.fail = (reason: string) => {
      if (this.stopped) return;
      this.stopped = true;
      this.failureMessage = `${reason}${this.stderr ? `\n${this.stderr}` : ''}`;
      this.connection.dispose();
      for (const token of this.pending) token.cancel();
      this.child.kill();
      const kill = setTimeout(() => this.child.kill('SIGKILL'), 1500);
      kill.unref();
      void this.exited.then(() => clearTimeout(kill));
      void this.watcher?.then(watcher => watcher.unsubscribe()).catch(() => {});
      if (!this.stopping) failed(this.failureMessage);
    };
    this.child.once('error', error => fail(`${profile.name}: ${error.message}${(error as NodeJS.ErrnoException).code === 'ENOENT' && profile.missingExecutableMessage ? `. ${profile.missingExecutableMessage}` : ''}`));
    this.child.once('exit', (code, signal) => fail(`${profile.name} language server exited (${signal ?? code}).`));
    this.connection.onError(([error]) => fail(error.message));
    this.connection.onClose(() => fail(`${profile.name} language server disconnected.`));
    this.connection.onNotification('textDocument/publishDiagnostics', diagnostics);
    this.connection.onRequest('workspace/configuration', (params: { items: { section?: string }[] }) =>
      params.items.map(item => profile.configuration[item.section ?? ''] ?? {}));
    this.connection.onRequest('workspace/workspaceFolders', () => [{ uri: pathToFileURL(root).href, name: root }]);
    this.connection.onRequest('workspace/applyEdit', () => ({ applied: false, failureReason: 'Unsolicited edits are not supported.' }));
    this.connection.listen();
    this.ready = this.request<InitializeResult>('initialize', {
      processId: process.pid, clientInfo: { name: 'Setdown', version: '1.0.0' },
      rootUri: pathToFileURL(root).href, workspaceFolders: [{ uri: pathToFileURL(root).href, name: root }],
      capabilities: {
        general: { positionEncodings: ['utf-16'] },
        workspace: { configuration: true, workspaceFolders: true, applyEdit: false,
          workspaceEdit: { documentChanges: true, resourceOperations: [], failureHandling: 'abort' } },
        textDocument: {
          synchronization: { dynamicRegistration: false, didSave: true },
          completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'],
            insertReplaceSupport: true, resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] } } },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'], parameterInformation: { labelOffsetSupport: true } } },
          definition: { linkSupport: true }, references: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          rename: { prepareSupport: true }, publishDiagnostics: { versionSupport: true, tagSupport: { valueSet: [1, 2] } },
        },
      },
    }, undefined, 20_000).then(async result => {
      if (result.capabilities.positionEncoding && result.capabilities.positionEncoding !== 'utf-16')
        throw new Error('The language server must use UTF-16 positions.');
      await this.notify('initialized', {});
      if (Object.keys(profile.configuration).length)
        await this.notify('workspace/didChangeConfiguration', { settings: profile.configuration });
      return result.capabilities;
    }).catch(error => { fail(String(error)); throw new Error(this.failureMessage ?? String(error)); });
    // The owner may close a window before the first caller awaits initialization.
    void this.ready.catch(() => {});
  }

  async request<T>(method: string, params: unknown, token = new CancellationTokenSource(), timeoutMs = /references|rename|documentSymbol/.test(method) ? 60_000 : 15_000): Promise<T> {
    if (this.stopped) throw new Error(`${this.profile.name} language server is stopped. Use Restart Language Servers.`);
    if (this.inFlight >= 64) {
      this.fail(`${this.profile.name} language server stopped answering requests.`);
      throw new Error('Too many unanswered language requests.');
    }
    this.pending.add(token);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cancel: { dispose(): void } | undefined;
    try {
      const response = this.connection.sendRequest<T>(method, params, token.token);
      this.inFlight++;
      // Cancelled callers may finish before the server replies. Count the raw
      // responses too, so an unresponsive server cannot retain unlimited RPCs.
      void response.then(() => { this.inFlight--; }, () => { this.inFlight--; });
      return await Promise.race([
        response,
        new Promise<never>((_resolve, reject) => {
          const abort = () => reject(new Error('Language request cancelled.'));
          cancel = token.token.onCancellationRequested(abort);
          if (token.token.isCancellationRequested) abort();
          timeout = setTimeout(() => {
            const reason = `Language request timed out: ${method}`;
            reject(new Error(reason));
            // A cold C++ preamble/index may outlive one UI request. Cancellation
            // retires that request; initialization failure still stops the process.
            token.cancel();
            if (method === 'initialize') this.fail(reason);
          }, timeoutMs);
        }),
      ]);
    } finally { clearTimeout(timeout); cancel?.dispose(); this.pending.delete(token); token.dispose(); }
  }
  async notify(method: string, params: unknown): Promise<void> {
    if (this.stopped) throw new Error(`${this.profile.name} language server is stopped. Use Restart Language Servers.`);
    await this.connection.sendNotification(method, params);
  }
  watch(root: string): void {
    this.watcher = subscribe(root, (error, events) => {
      if (error || this.stopped || this.stopping) return;
      const changes = events.filter(event => this.profile.watches(event.path))
        .map(event => ({ uri: pathToFileURL(event.path).href, type: event.type === 'create' ? 1 : event.type === 'delete' ? 3 : 2 }));
      if (changes.length) void this.ready.then(() => this.notify('workspace/didChangeWatchedFiles', { changes })).catch(() => {});
    }, { ignore: ['**/.git/**', '**/node_modules/**', '**/__pycache__/**'] });
    void this.watcher.catch(error => console.warn(`${this.profile.name} file watcher unavailable:`, error));
  }
  stop(): Promise<void> { return this.stopping ??= this.stopProcess(); }
  private async stopProcess(): Promise<void> {
    await this.watcher?.then(watcher => watcher.unsubscribe()).catch(() => {});
    if (this.stopped) return this.exited;
    for (const token of this.pending) token.cancel();
    const kill = setTimeout(() => this.child.kill('SIGKILL'), 1500);
    kill.unref();
    try {
      await this.request('shutdown', null, undefined, 500);
      await this.notify('exit', undefined);
    } catch { this.child.kill(); }
    finally {
      this.stopped = true;
      this.connection.dispose();
      // Kill deadline remains until the child has actually exited.
      if (this.child.exitCode !== null || this.child.signalCode !== null) clearTimeout(kill);
      else this.child.once('exit', () => clearTimeout(kill));
    }
    await this.exited;
  }
}
