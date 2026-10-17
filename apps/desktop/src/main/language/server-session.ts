import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { subscribe, type AsyncSubscription } from '@parcel/watcher';
import { CancellationTokenSource, createMessageConnection, StreamMessageReader, StreamMessageWriter,
  type MessageConnection } from 'vscode-jsonrpc/node';
import type { ServerProfile } from './server-definitions';
import { clientCapabilities, refreshMethods, type LanguageRefresh } from '../../protocol/language-features';
import { ServerCapabilitiesState } from './server-capabilities';
import type { ApplyWorkspaceEditParams, ApplyWorkspaceEditResult, Registration, InitializeResult, PublishDiagnosticsParams, ServerCapabilities } from 'vscode-languageserver-protocol';

export type SessionHooks = {
  refresh?(feature: LanguageRefresh): void;
  capabilitiesChanged?(): void;
  activity?(): void;
  applyEdit?(params: ApplyWorkspaceEditParams): Promise<ApplyWorkspaceEditResult>;
};
export type ServerLaunch = { executable: string; args: string[]; env?: NodeJS.ProcessEnv };
const genericProfile: ServerProfile = { name: 'Language', configuration: {}, watches: () => false };
export function configurationSection(configuration: Record<string, unknown>, section?: string): unknown {
  if (!section) return configuration;
  if (Object.hasOwn(configuration, section)) return configuration[section];
  let value: unknown = configuration;
  for (const key of section.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return null;
    value = (value as Record<string, unknown>)[key];
  }
  return value ?? null;
}

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
  private analyzed = false;
  private readonly analysisWaiters = new Set<() => void>();
  private readonly partialResults = new Map<string, unknown[]>();
  private readonly fail: (reason: string) => void;
  readonly capabilities: ServerCapabilitiesState;
  readonly logs: string[] = [];
  readonly context = new Map<string, string>();
  private phase = 'initialization';
  readonly progress = new Map<string | number, string>();
  readonly ready: Promise<ServerCapabilities>;

  constructor(launch: ServerLaunch, root: string,
    diagnostics: (params: PublishDiagnosticsParams) => void, failed: (message: string) => void, private readonly profile = genericProfile, private readonly hooks: SessionHooks = {}) {
    this.capabilities = new ServerCapabilitiesState(root);
    this.child = spawn(launch.executable, launch.args, {
      cwd: root, env: launch.env, stdio: 'pipe', windowsHide: true, shell: false,
    });
    this.exited = new Promise(resolve => this.child.once('close', () => resolve()));
    this.connection = createMessageConnection(new StreamMessageReader(this.child.stdout), new StreamMessageWriter(this.child.stdin));
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + String(chunk)).slice(-8192); this.log(String(chunk)); });
    const fail = this.fail = (reason: string) => {
      if (this.stopped) return;
      this.stopped = true;
      this.failureMessage = `${this.phase}: ${reason}${this.stderr ? `\n${this.stderr}` : ''}`;
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
    this.connection.onNotification('textDocument/publishDiagnostics', (params: PublishDiagnosticsParams) => {
      this.analyzed = true;
      for (const ready of [...this.analysisWaiters]) ready();
      diagnostics(params);
    });
    this.connection.onNotification('$/typescriptVersion', (params: { version?: unknown; source?: unknown }) => {
      if (typeof params.version !== 'string' || typeof params.source !== 'string') return;
      this.context.set('TypeScript', `${params.version.slice(0, 80)} (${params.source.slice(0, 80)}, reported by server)`);
      hooks.activity?.();
    });
    const python = configurationSection(profile.configuration, 'python.pythonPath');
    if (typeof python === 'string') this.context.set('Python interpreter', `${python} (configured)`);
    this.connection.onRequest('workspace/configuration', (params: { items: { section?: string }[] }) =>
      params.items.map(item => configurationSection(profile.configuration, item.section)));
    this.connection.onRequest('workspace/workspaceFolders', () => [{ uri: pathToFileURL(root).href, name: root }]);
    this.connection.onRequest('workspace/applyEdit', async (params: ApplyWorkspaceEditParams): Promise<ApplyWorkspaceEditResult> => hooks.applyEdit?.(params)
      ?? { applied: false, failureReason: 'No active user command accepts edits.' });
    this.connection.onRequest('client/registerCapability', (params: { registrations: Registration[] }) => {
      this.capabilities.register(params.registrations); hooks.capabilitiesChanged?.(); return null;
    });
    this.connection.onRequest('client/unregisterCapability', (params: { unregisterations: { id: string }[] }) => {
      this.capabilities.unregister(params.unregisterations.map(item => item.id)); hooks.capabilitiesChanged?.(); return null;
    });
    for (const [method, feature] of Object.entries(refreshMethods)) this.connection.onRequest(method, () => { hooks.refresh?.(feature); return null; });
    for (const method of ['window/logMessage', 'window/showMessage'])
      this.connection.onNotification(method, (params: { message: string }) => this.log(params.message));
    // Requests are recorded in the panel. No server-driven modal interrupts typing.
    this.connection.onRequest('window/showMessageRequest', (params: { message: string }) => { this.log(params.message); return null; });
    this.connection.onRequest('window/workDoneProgress/create', () => null);
    this.connection.onNotification('$/progress', (params: { token: string | number; value: { kind?: string; title?: string; message?: string; percentage?: number } }) => {
      const { value, token } = params;
      const partial = typeof token === 'string' && this.partialResults.get(token);
      if (partial && Array.isArray(value)) { partial.push(...value.slice(0, Math.max(0, 10_000 - partial.length))); return; }
      if (!value || !value.kind) return;
      if (value.kind === 'end') this.progress.delete(token);
      else if (this.progress.size < 32 || this.progress.has(token))
        this.progress.set(token, [value.title, value.message, value.percentage === undefined ? '' : `${value.percentage}%`].filter(Boolean).join(' · ').slice(0, 1000));
      hooks.activity?.();
    });
    this.connection.listen();
    this.ready = this.request<InitializeResult>('initialize', {
      processId: process.pid, clientInfo: { name: 'Setdown', version: '1.0.0' },
      rootUri: pathToFileURL(root).href, workspaceFolders: [{ uri: pathToFileURL(root).href, name: root }],
      initializationOptions: profile.initializationOptions,
      capabilities: profile.capabilities ?? clientCapabilities(),
    }, undefined, 20_000).then(async result => {
      if (result.capabilities.positionEncoding && result.capabilities.positionEncoding !== 'utf-16')
        throw new Error('The language server must use UTF-16 positions.');
      this.capabilities.base = result.capabilities;
      if (result.serverInfo?.name) this.context.set('Server', `${result.serverInfo.name}${result.serverInfo.version ? ` ${result.serverInfo.version}` : ''}`.slice(0, 200));
      await this.notify('initialized', {});
      if (Object.keys(profile.configuration).length)
        await this.notify('workspace/didChangeConfiguration', { settings: profile.configuration });
      this.phase = 'running';
      return result.capabilities;
    }).catch(error => { fail(String(error)); throw new Error(this.failureMessage ?? String(error)); });
    // The owner may close a window before the first caller awaits initialization.
    void this.ready.catch(() => {});
  }

  private log(message: string): void {
    this.logs.push(String(message).slice(-2048));
    if (this.logs.length > 80) this.logs.shift();
    this.hooks.activity?.();
  }
  private waitForAnalysis(token: CancellationTokenSource): Promise<void> {
    if (this.analyzed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ready = () => { this.analysisWaiters.delete(ready); cancel.dispose(); resolve(); };
      const cancel = token.token.onCancellationRequested(() => { this.analysisWaiters.delete(ready); cancel.dispose(); reject(Error('Language request cancelled.')); });
      this.analysisWaiters.add(ready);
      if (token.token.isCancellationRequested) { this.analysisWaiters.delete(ready); cancel.dispose(); reject(Error('Language request cancelled.')); }
    });
  }
  async request<T>(method: string, params: unknown, token = new CancellationTokenSource(), timeoutMs = /references|rename|documentSymbol/.test(method) ? 60_000 : 15_000): Promise<T> {
    if (this.stopped) throw new Error(`${this.profile.name} language server is stopped. Use Restart Language Servers.`);
    if (this.inFlight >= 64) {
      this.fail(`${this.profile.name} language server stopped answering requests.`);
      throw new Error('Too many unanswered language requests.');
    }
    const partialToken = method === 'workspace/symbol' ? randomUUID() : undefined;
    if (partialToken) { this.partialResults.set(partialToken, []); params = { ...(params as object), partialResultToken: partialToken }; }
    this.pending.add(token);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cancel: { dispose(): void } | undefined;
    try {
      const response = (async () => {
        if (method === 'textDocument/rename' && this.profile.renameAfterDiagnostics) await this.waitForAnalysis(token);
        if (token.token.isCancellationRequested) throw Error('Language request cancelled.');
        return this.connection.sendRequest<T>(method, params, token.token);
      })();
      this.inFlight++;
      // Cancelled callers may finish before the server replies. Count the raw
      // responses too, so an unresponsive server cannot retain unlimited RPCs.
      void response.then(() => { this.inFlight--; }, () => { this.inFlight--; });
      const result = await Promise.race([
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
      const partial = partialToken && this.partialResults.get(partialToken);
      return (partial?.length ? [...partial, ...(Array.isArray(result) ? result : [])].slice(0, 10_000) : result) as T;
    } finally { if (partialToken) this.partialResults.delete(partialToken); clearTimeout(timeout); cancel?.dispose(); this.pending.delete(token); token.dispose(); }
  }
  async notify(method: string, params: unknown): Promise<void> {
    if (this.stopped) throw new Error(`${this.profile.name} language server is stopped. Use Restart Language Servers.`);
    await this.connection.sendNotification(method, params);
  }
  watch(root: string): void {
    this.watcher = subscribe(root, (error, events) => {
      if (error || this.stopped || this.stopping) return;
      const changes = events.filter(event => this.profile.watches(event.path) || this.capabilities.watches(event.path, event.type === 'create' ? 1 : event.type === 'delete' ? 3 : 2))
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
