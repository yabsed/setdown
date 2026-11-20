import type { LanguageServerMessage } from '../../protocol/language';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import type { AsyncSubscription } from '@parcel/watcher';
import { subscribeToFiles } from '../documents/native-watcher';
import { CancellationToken, CancellationTokenSource, createMessageConnection, ResponseError, StreamMessageReader, StreamMessageWriter,
  type CancellationStrategy, type MessageConnection } from 'vscode-jsonrpc/node';
import type { ToolAction, ToolNotice, ToolSignal } from './tool-signals';
import type { ServerProfile } from './server-definitions';
import { InactiveRegions, inactiveRegionsMethod, reportsInactiveRegions, serverStatusMethod, statusMeaning, toolStatus } from './extension-rules';
import { clientCapabilities, refreshMethods, type LanguageRefresh } from '../../protocol/language-features';
import { ServerCapabilitiesState } from './server-capabilities';
import type { ApplyWorkspaceEditParams, ApplyWorkspaceEditResult, Registration, InitializeResult, PublishDiagnosticsParams, ServerCapabilities } from 'vscode-languageserver-protocol';

export type SessionHooks = {
  filesChanged?(paths: string[]): void;
  configuration?(scopeUri?: string): Record<string, unknown>;
  refresh?(feature: LanguageRefresh): void;
  capabilitiesChanged?(): void;
  activity?(): void;
  applyEdit?(params: ApplyWorkspaceEditParams): Promise<ApplyWorkspaceEditResult>;
  /** The text of a schema the JSON server asks its editor for (`vscode/content`). A refusal
   * is thrown with a numeric `code`, which the server reads. */
  schemaContent?(uri: string): Promise<string>;
  /** What a button of a tool's own notice does (`tool-signals.ts`). */
  act?(action: ToolAction): Promise<void> | void;
};
/** `cancellation`: how the tool is told that an answer is no longer wanted, when its extension
 * does not use the protocol's own message for that (`python-cancellation.ts`). `dispose` runs
 * once the process has ended. */
export type ServerLaunch = { executable: string; args: string[]; env?: NodeJS.ProcessEnv; cancellation?: CancellationStrategy; dispose?(): void };
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
  private failure: { started: boolean; reason: string } | undefined;
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
  private readonly messageRequests = new Map<string, { value: LanguageServerMessage; finish(index?: number): void }>();
  private readonly regions: InactiveRegions | undefined;
  private status: { key: string; id?: string } | undefined;
  /** A tool's standing notices by the key its rules gave them. One the person dismissed keeps its text and no id. */
  private readonly notices = new Map<string, { id?: string; text: string }>();
  get messages(): LanguageServerMessage[] { return [...this.messageRequests.values()].map(entry => entry.value); }
  answerMessage(id: string, index?: number): void {
    const entry = this.messageRequests.get(id);
    if (!entry || (index !== undefined && (!Number.isSafeInteger(index) || index < 0 || index >= entry.value.actions.length))) throw Error('This server action is no longer available.');
    entry.finish(index);
  }
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
    this.exited = new Promise(resolve => this.child.once('close', () => { try { launch.dispose?.(); } catch { /* Nothing left to clean up. */ } resolve(); }));
    this.connection = createMessageConnection(new StreamMessageReader(this.child.stdout), new StreamMessageWriter(this.child.stdin), undefined,
      launch.cancellation ? { cancellationStrategy: launch.cancellation } : undefined);
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + String(chunk)).slice(-8192); this.log(String(chunk)); });
    const fail = this.fail = (reason: string) => {
      if (this.stopped) return;
      this.stopped = true;
      for (const entry of this.messageRequests.values()) entry.finish();
      this.failure = { started: this.phase === 'running', reason };
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
    this.regions = reportsInactiveRegions(profile.capabilities) ? new InactiveRegions() : undefined;
    // What the tool's own extension listens to and answers (`tool-signals.ts`). Registered first:
    // a name this class handles itself below stays with this class.
    const sent = (values: unknown[]) => values.length <= 1 ? values[0] : values;
    for (const [method, rule] of Object.entries(profile.rules?.notifications ?? {})) this.connection.onNotification(method, (...values: unknown[]) => {
      try { this.signal(rule(sent(values))); } catch (error) { this.log(`${method}: ${String(error)}`); }
    });
    for (const [method, rule] of Object.entries(profile.rules?.requests ?? {})) this.connection.onRequest(method, async (...values: unknown[]) => {
      if (CancellationToken.is(values.at(-1))) values.pop();
      try {
        const answer = await rule(sent(values));
        this.signal(answer.signal);
        return 'question' in answer ? answer.result(await this.ask(answer.question)) : answer.result;
      } catch (error) { this.log(`${method}: ${String(error)}`); throw new ResponseError(-32603, String(error instanceof Error ? error.message : error).slice(0, 1000)); }
    });
    this.connection.onNotification('textDocument/publishDiagnostics', (params: PublishDiagnosticsParams) => {
      this.analyzed = true;
      for (const ready of [...this.analysisWaiters]) ready();
      diagnostics(this.regions?.published(params) ?? params);
    });
    // clangd: the lines the preprocessor leaves out, shown faded beside its own diagnostics (`extension-rules.ts`).
    this.connection.onNotification(inactiveRegionsMethod, (params: unknown) => { const merged = this.regions?.inactive(params); if (merged) diagnostics(merged); });
    // rust-analyzer: how far its answers can be trusted right now. A standing status, not an
    // event: each one replaces the last, and one the person dismissed returns only when it changes.
    this.connection.onNotification(serverStatusMethod, (params: unknown) => {
      const status = toolStatus(params); if (!status) return;
      const meaning = statusMeaning(status, profile.name), key = `${status.health}\0${status.message ?? ''}`;
      if (meaning.line) this.context.set('Server status', meaning.line.replace(/\s+/g, ' ').slice(0, 1000)); else this.context.delete('Server status');
      if (meaning.working) this.progress.set(serverStatusMethod, meaning.working); else this.progress.delete(serverStatusMethod);
      if (key !== this.status?.key) {
        if (this.status?.id) this.messageRequests.delete(this.status.id);
        const id = meaning.notice && randomUUID();
        if (id) this.messageRequests.set(id, { value: { id, message: meaning.notice!.message, actions: [], severity: meaning.notice!.severity }, finish: () => { this.messageRequests.delete(id); hooks.activity?.(); } });
        this.status = { key, id: id || undefined };
        if (status.message) this.log(`Server status (${status.health}): ${status.message}`);
      }
      hooks.activity?.();
    });
    this.connection.onNotification('$/typescriptVersion', (params: { version?: unknown; source?: unknown }) => {
      if (typeof params.version !== 'string' || typeof params.source !== 'string') return;
      this.context.set('TypeScript', `${params.version.slice(0, 80)} (${params.source.slice(0, 80)}, reported by server)`);
      hooks.activity?.();
    });
    const python = configurationSection(profile.configuration, 'python.pythonPath');
    if (typeof python === 'string') this.context.set('Python interpreter', `${python} (configured)`);
    this.connection.onRequest('workspace/configuration', (params: { items: { section?: string; scopeUri?: string }[] }) =>
      params.items.map(item => configurationSection(hooks.configuration?.(item.scopeUri) ?? profile.configuration, item.section)));
    this.connection.onRequest('workspace/workspaceFolders', () => [{ uri: pathToFileURL(root).href, name: root }]);
    this.connection.onRequest('vscode/content', async (uri: unknown) => {
      try {
        if (typeof uri !== 'string' || !hooks.schemaContent) throw Error('This editor loads no schema of that kind.');
        return await hooks.schemaContent(uri);
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        throw new ResponseError(typeof code === 'number' ? code : 5, String(error instanceof Error ? error.message : error));
      }
    });
    this.connection.onRequest('workspace/applyEdit', async (params: ApplyWorkspaceEditParams): Promise<ApplyWorkspaceEditResult> => hooks.applyEdit?.(params)
      ?? { applied: false, failureReason: 'No active user command accepts edits.' });
    this.connection.onRequest('client/registerCapability', (params: { registrations: Registration[] }) => {
      for (const method of this.capabilities.register(params.registrations))
        this.log(`${profile.name} registered ${method}, which Setdown does not use. The registration was acknowledged without effect.`);
      hooks.capabilitiesChanged?.(); return null;
    });
    this.connection.onRequest('client/unregisterCapability', (params: { unregisterations: { id: string }[] }) => {
      this.capabilities.unregister(params.unregisterations.map(item => item.id)); hooks.capabilitiesChanged?.(); return null;
    });
    for (const [method, feature] of Object.entries(refreshMethods)) this.connection.onRequest(method, () => { hooks.refresh?.(feature); return null; });
    this.connection.onNotification('window/logMessage', (params: { message: string }) => this.log(params.message));
    // A tool's own notice stays in the panel until the person dismisses it. VS Code shows it as a
    // notification, and a tool's terms can forbid hiding it (vendor/vscode-intelephense/LICENSE.txt, 3d).
    this.connection.onNotification('window/showMessage', (params: { type?: number; message?: unknown }) => {
      const message = String(params?.message ?? '').slice(0, 4096);
      this.log(message);
      const severity = ({ 1: 'error', 2: 'warning', 3: 'info' } as const)[params?.type as 1 | 2 | 3];
      const notices = [...this.messageRequests.values()].filter(entry => entry.value.severity);
      if (!severity || !message.trim() || notices.some(entry => entry.value.message === message)) return;
      // The newest four are kept, so a tool that repeats itself cannot crowd out a question.
      if (notices.length >= 4) this.messageRequests.delete(notices[0].value.id);
      const id = randomUUID();
      this.messageRequests.set(id, { value: { id, message, actions: [], severity }, finish: () => { this.messageRequests.delete(id); hooks.activity?.(); } });
      hooks.activity?.();
    });
    // Requests are recorded in the panel. No server-driven modal interrupts typing.
    this.connection.onRequest('window/showMessageRequest', (params: { message: string; actions?: { title: string }[] }) => {
      this.log(params.message);
      if (!Array.isArray(params.actions) || !params.actions.length || params.actions.length > 8 || this.messageRequests.size >= 8 || params.actions.some(action => typeof action?.title !== 'string' || action.title.length > 200)) return null;
      const actions = params.actions, id = randomUUID();
      return new Promise(resolve => {
        const timer = setTimeout(() => finish(), 120_000); timer.unref();
        const finish = (index?: number) => { clearTimeout(timer); this.messageRequests.delete(id); resolve(index === undefined ? null : actions[index]); hooks.activity?.(); };
        this.messageRequests.set(id, { value: { id, message: String(params.message).slice(0, 4096), actions: actions.map(action => action.title) }, finish });
        hooks.activity?.();
      });
    });
    this.connection.onRequest('window/workDoneProgress/create', () => null);
    // A tool's extension may read some progress itself: gopls writes a log through one (`go-gopls-rules.ts`).
    const ownProgress = profile.rules?.notifications?.['$/progress'];
    this.connection.onNotification('$/progress', (params: { token: string | number; value: { kind?: string; title?: string; message?: string; percentage?: number } }) => {
      if (ownProgress) try { const signal = ownProgress(params); if (signal) { this.signal(signal); hooks.activity?.(); return; } } catch (error) { this.log(`$/progress: ${String(error)}`); }
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
      try { this.signal(profile.rules?.started?.()); } catch (error) { this.log(String(error)); }
      for (const said of profile.rules?.announces?.slice(0, 8) ?? []) await this.notify(said.method, said.params).catch(error => this.log(`${said.method}: ${String(error)}`));
      for (const query of profile.rules?.queries?.slice(0, 8) ?? [])
        void this.request<unknown>(query.method, query.params).then(answer => this.signal(profile.rules?.answered?.(query.method, answer)))
          .catch(error => this.log(`${query.method}: ${String(error instanceof Error ? error.message : error)}`));
      return result.capabilities;
    }).catch(error => { fail(String(error)); throw new Error(this.failureMessage ?? String(error)); });
    // The owner may close a window before the first caller awaits initialization.
    void this.ready.catch(() => {});
  }

  /** What ended the session. The process can report its reason on stderr after
   * its output closes, so this waits briefly for the process to finish. */
  async failureFacts(): Promise<{ started: boolean; reason: string; stderr: string } | undefined> {
    if (!this.failure) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.exited, new Promise<void>(resolve => { timer = setTimeout(resolve, 300); timer.unref(); })]);
    clearTimeout(timer);
    return { ...this.failure, stderr: this.stderr };
  }
  /** Shows what one message of the tool changes (`tool-signals.ts`). */
  signal(signal: ToolSignal | undefined): void {
    if (!signal || this.stopped) return;
    for (const [name, value] of Object.entries(signal.context ?? {})) {
      if (value?.trim()) this.context.set(name.slice(0, 80), value.replace(/\s+/g, ' ').trim().slice(0, 1000)); else this.context.delete(name.slice(0, 80));
    }
    for (const [key, value] of Object.entries(signal.progress ?? {})) {
      const id = `tool:${key}`;
      if (!value?.trim()) this.progress.delete(id);
      else if (this.progress.size < 32 || this.progress.has(id)) this.progress.set(id, value.replace(/\s+/g, ' ').trim().slice(0, 1000));
    }
    for (const line of signal.log?.slice(-80) ?? []) { this.logs.push(String(line).slice(-2048)); if (this.logs.length > 80) this.logs.shift(); }
    for (const [key, notice] of Object.entries(signal.notices ?? {})) this.notice(key, notice);
    this.hooks.activity?.();
  }
  private notice(key: string, notice: ToolNotice | undefined): void {
    const shown = this.notices.get(key);
    const message = notice?.message.trim().slice(0, 4096), actions = (notice?.actions ?? []).slice(0, 6);
    if (!notice || !message) { if (shown?.id) this.messageRequests.delete(shown.id); this.notices.delete(key); return; }
    const text = JSON.stringify([notice.severity, message, actions.map(action => action.title)]);
    // Unchanged: it is already shown, or the person dismissed exactly this.
    if (shown?.text === text) return;
    if (shown?.id) this.messageRequests.delete(shown.id);
    // Standing notices are few by nature; a tool that makes many keeps the oldest.
    if (this.messageRequests.size >= 12) return;
    const id = randomUUID();
    this.notices.set(key, { id, text });
    this.messageRequests.set(id, { value: { id, message, actions: actions.map(action => action.title.slice(0, 200)), severity: notice.severity }, finish: index => {
      this.messageRequests.delete(id); this.notices.set(key, { text }); this.hooks.activity?.();
      const action = index === undefined ? undefined : actions[index];
      if (action && !('dismiss' in action) && !this.stopped)
        void Promise.resolve().then(() => this.hooks.act?.(action)).catch(error => this.log(`${action.title}: ${String(error instanceof Error ? error.message : error)}`));
    } });
  }
  /** A question of the tool's own, answered in the panel like `window/showMessageRequest`. */
  private ask(question: { message: string; answers: string[] }): Promise<number | undefined> {
    const answers = question.answers.filter(answer => typeof answer === 'string').map(answer => answer.slice(0, 200));
    this.log(question.message);
    if (!answers.length || answers.length > 8 || this.messageRequests.size >= 12 || this.stopped) return Promise.resolve(undefined);
    const id = randomUUID();
    return new Promise(resolve => {
      const timer = setTimeout(() => finish(), 120_000); timer.unref();
      const finish = (index?: number) => { clearTimeout(timer); this.messageRequests.delete(id); resolve(index); this.hooks.activity?.(); };
      this.messageRequests.set(id, { value: { id, message: String(question.message).slice(0, 4096), actions: answers }, finish });
      this.hooks.activity?.();
    });
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
        // No parameter is no `params` member: the library would send `[null]` for `undefined`,
        // which a tool that expects nothing (rust-analyzer's `()`, Intelephense's `cancelIndexing`) refuses.
        return params === undefined ? this.connection.sendRequest<T>(method, token.token) : this.connection.sendRequest<T>(method, params, token.token);
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
    await (params === undefined ? this.connection.sendNotification(method) : this.connection.sendNotification(method, params));
    if (method === 'textDocument/didClose') this.regions?.closed((params as { textDocument: { uri: string } }).textDocument.uri);
  }
  watch(root: string): void {
    this.watcher = subscribeToFiles(root, (error, events) => {
      if (error || this.stopped || this.stopping) return;
      this.hooks.filesChanged?.(events.map(event => event.path));
      const changes = events.filter(event => this.profile.watches(event.path) || this.capabilities.watches(event.path, event.type === 'create' ? 1 : event.type === 'delete' ? 3 : 2))
        .map(event => ({ uri: pathToFileURL(event.path).href, type: event.type === 'create' ? 1 : event.type === 'delete' ? 3 : 2 }));
      if (changes.length) void this.ready.then(() => this.notify('workspace/didChangeWatchedFiles', { changes })).catch(() => {});
    }, { ignore: ['**/.git/**', '**/node_modules/**', '**/__pycache__/**'] }, () => !this.stopped && !this.stopping);
    void this.watcher.catch(error => console.warn(`${this.profile.name} file watcher unavailable:`, error));
  }
  stop(): Promise<void> { return this.stopping ??= this.stopProcess(); }
  private async stopProcess(): Promise<void> {
    for (const entry of this.messageRequests.values()) entry.finish();
    // Stopping a server must not wait for a previous root's native tree crawl.
    void this.watcher?.then(watcher => watcher.unsubscribe()).catch(() => {});
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
