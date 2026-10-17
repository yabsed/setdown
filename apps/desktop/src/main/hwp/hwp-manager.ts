import { WebContentsView, dialog, ipcMain, net, session } from 'electron';
import type { WebContents } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { DocumentSnapshot } from '../../core/document/document';
import { isHwpDocument } from '../../core/document/document-profile';
import type { HwpArtifact, HwpState } from '../../protocol/hwp';
import { readPreviewBounds, type PreviewBounds } from '../../protocol/preview-preparation';
import type { SaveResult } from '../../protocol/desktop-api';
import type { WindowIpc } from '../ipc/window-ipc';
import type { WindowState } from '../windows/window-state';
import { nativeZoomBounds, type WorkspaceZoom } from '../windows/workspace-zoom';
import { validReadingRecord } from '../../core/reading/reading-position';
import type { ReadingPositionStore } from '../reading/reading-position-store';
import { canonicalPath, sameDiskVersion } from '../documents/file-system';
import { hwpContainer, hwpHash, hwpVersion, MAX_HWP_BYTES, readHwp, writeHwp } from '../documents/hwp-file';

type Entry = { id: string; owner: number; view: WebContentsView; contents: WebContents; document: DocumentSnapshot;
  source: Awaited<ReturnType<typeof readHwp>>; generation: string; revision: number; savedRevision: number;
  ready: boolean; error?: string; bounds: PreviewBounds | null; attached: boolean; saving: boolean;
  pending: Map<string, { resolve(value: HwpArtifact): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }> };
export class HwpManager {
  readonly entries = new Map<string, Entry>();
  private readonly opening = new Map<string, Promise<Entry>>();
  private readonly openingOwners = new Map<string, number>();
  private readonly canceled = new Set<string>();
  private readonly owners = new Set<number>();
  private readonly targets = new Set<string>();
  constructor(private readonly options: { positions: ReadingPositionStore; root: string; preload: string; zoom: WorkspaceZoom;
    stateFor(id: number): WindowState | null }) {}
  private state(entry: Entry): HwpState {
    return { id: entry.id, path: entry.document.path, generation: entry.generation, revision: entry.revision,
      savedRevision: entry.savedRevision, ready: entry.ready,
      ...(entry.document.readingPosition?.kind === 'hwp' ? { position: entry.document.readingPosition } : {}), ...(entry.error ? { error: entry.error } : {}) };
  }
  private publish(entry: Entry) { this.options.stateFor(entry.owner)?.window.webContents.send('hwp:state', this.state(entry)); }
  private owned(owner: number, id: string) {
    const entry = this.entries.get(id);
    if (!entry || entry.owner !== owner || entry.contents.isDestroyed()) throw Error('HWP 문서 소유자가 일치하지 않습니다.');
    return entry;
  }
  private assertDocument(state: WindowState, document: DocumentSnapshot) {
    if (!document || document.kind !== 'hwp' || !isHwpDocument(document.path) || document.isUntitled
      || !(state.currentDocument?.path === document.path || state.rendererTabs.some(tab => tab.path === document.path)))
      throw Error('An open HWP document is required.');
  }
  private async open(state: WindowState, id: string, document: DocumentSnapshot): Promise<Entry> {
    this.assertDocument(state, document);
    if (typeof id !== 'string' || !id.length || id.length > 256) throw Error('Invalid HWP tab.');
    if (this.entries.has(id)) {
      const existing = this.owned(state.webContentsId, id);
      if (existing.document.path !== document.path) throw Error('HWP tab is still owned by another document.');
      return existing;
    }
    if (this.opening.has(id)) {
      if (this.openingOwners.get(id) !== state.webContentsId) throw Error('HWP tab belongs to another window.');
      await this.opening.get(id)!.catch(() => {});
      return this.open(state, id, document);
    }
    this.canceled.delete(id);
    const task = this.create(state, id, document);
    this.opening.set(id, task); this.openingOwners.set(id, state.webContentsId);
    try { return await task; } finally { this.opening.delete(id); this.openingOwners.delete(id); }
  }
  private async create(state: WindowState, id: string, document: DocumentSnapshot): Promise<Entry> {
    const source = await readHwp(canonicalPath(document.path));
    if (state.window.isDestroyed() || this.canceled.has(id)) throw Error('The window closed.');
    if (!sameDiskVersion(source.version, document.diskVersion)) throw Error('HWP 파일이 변경되었습니다. 다시 불러오세요.');
    // An in-memory session has no cookies, network, downloads, or desktop API.
    const isolated = session.fromPartition(`hwp-${randomUUID()}`);
    const clipboardPermission = (permission: string) => ['clipboard-read', 'clipboard-sanitized-write'].includes(permission)
      && this.entries.get(id)?.view.getVisible() === true;
    isolated.setPermissionRequestHandler((_contents, permission, callback) => callback(clipboardPermission(permission)));
    isolated.setPermissionCheckHandler((_contents, permission) => clipboardPermission(permission));
    isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('setdown-hwp://app/') && !details.url.startsWith('data:') && !details.url.startsWith('blob:') }));
    isolated.on('will-download', event => event.preventDefault());
    isolated.protocol.handle('setdown-hwp', async request => {
      const url = new URL(request.url);
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.resolve(this.options.root, relative || 'index.html');
      if (url.hostname !== 'app' || !file.startsWith(this.options.root + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(file).href);
    });
    const view = new WebContentsView({ webPreferences: { session: isolated, preload: this.options.preload,
      sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const contents = view.webContents;
    const entry: Entry = { id, owner: state.webContentsId, view, contents, document: { ...document }, source,
      generation: randomUUID(), revision: 0, savedRevision: 0, ready: false, bounds: null, attached: false, saving: false, pending: new Map() };
    this.entries.set(id, entry);
    view.setVisible(false);
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', event => event.preventDefault());
    contents.on('render-process-gone', (_event, details) => {
      entry.error = `HWP 편집기가 종료되었습니다 (${details.reason}). 저장하지 않은 내용은 복구할 수 없습니다.`;
      entry.ready = false; this.publish(entry);
      for (const request of entry.pending.values()) { clearTimeout(request.timer); request.reject(Error(entry.error)); }
      entry.pending.clear();
    });
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.isComposing || !view.getVisible()) return;
      if ((input.control || input.meta) && !input.alt) {
        const key = input.key.toLowerCase();
        const command = ({ z: input.shift ? 'redo' : 'undo', y: 'redo', f: 'find', a: 'select-all', c: 'copy', x: 'cut', v: 'paste' } as Record<string, string>)[key];
        if (command) { event.preventDefault(); contents.send('hwp-runtime:command', command); return; }
        if (key === 's') { event.preventDefault(); this.options.stateFor(entry.owner)?.window.webContents.send('hwp:action', { id, command: input.shift ? 'save-as' : 'save' }); return; }
      }
      if ((input.control || input.meta) && ['+', '=', '-', '0'].includes(input.key)) {
        event.preventDefault(); this.options.zoom.change(input.key === '0' ? 0 : input.key === '-' ? -1 : 1);
      }
    });
    this.options.zoom.track(contents, () => this.present(entry));
    this.trackOwner(state);
    void contents.loadURL('setdown-hwp://app/index.html').catch(error => { entry.error = String(error); this.publish(entry); });
    return entry;
  }
  private trackOwner(state: WindowState) {
    const id = state.webContentsId; if (this.owners.has(id)) return; this.owners.add(id);
    const close = () => { for (const item of this.entries.values()) if (item.owner === id) this.close(item); };
    state.window.once('closed', () => { close(); this.owners.delete(id); });
    state.window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (!inPlace && mainFrame) close(); });
  }
  private present(entry: Entry) {
    const owner = this.options.stateFor(entry.owner)?.window;
    if (!owner || owner.isDestroyed() || entry.contents.isDestroyed()) return;
    if (!entry.bounds || !entry.ready) {
      entry.view.setVisible(false);
      if (entry.attached) owner.contentView.removeChildView(entry.view);
      entry.attached = false; return;
    }
    const box = nativeZoomBounds(entry.bounds, this.options.zoom.factor);
    const [width, height] = owner.getContentSize();
    box.width = Math.max(0, Math.min(box.width, width - box.x));
    box.height = Math.max(0, Math.min(box.height, height - box.y));
    if (!box.width || !box.height) { entry.view.setVisible(false); return; }
    entry.view.setBounds(box);
    if (!entry.attached) { owner.contentView.addChildView(entry.view); entry.attached = true; }
    entry.view.setVisible(true);
  }
  private close(entry: Entry) {
    if (this.entries.get(entry.id) !== entry) return;
    this.entries.delete(entry.id);
    for (const request of entry.pending.values()) { clearTimeout(request.timer); request.reject(Error('HWP document closed.')); }
    if (!entry.contents.isDestroyed()) {
      const window = this.options.stateFor(entry.owner)?.window;
      if (entry.attached && window && !window.isDestroyed()) window.contentView.removeChildView(entry.view);
      entry.contents.close();
    }
  }
  adopt(source: number, destination: number, id: string) {
    const entry = this.entries.get(id);
    if (!entry || entry.owner !== source || entry.saving || !this.options.stateFor(destination)) return false;
    entry.bounds = null; this.present(entry); entry.owner = destination; this.trackOwner(this.options.stateFor(destination)!); this.publish(entry); return true;
  }
  private export(entry: Entry, format: 'hwp' | 'hwpx'): Promise<HwpArtifact> {
    if (!entry.ready || entry.error) throw Error(entry.error ?? 'HWP 편집기가 아직 준비되지 않았습니다.');
    const request = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { entry.pending.delete(request); reject(Error('HWP 내보내기 시간이 초과되었습니다. 원본은 변경되지 않았습니다.')); }, 60_000);
      entry.pending.set(request, { resolve, reject, timer });
      entry.contents.send('hwp-runtime:export', { request, format });
    });
  }
  private async save(owner: number, id: string, saveAs: boolean): Promise<SaveResult> {
    const entry = this.owned(owner, id), state = this.options.stateFor(owner)!;
    if (entry.saving) throw Error('HWP 저장이 이미 진행 중입니다.');
    entry.saving = true;
    let target = ''; let locked = false;
    const originalPath = entry.document.path;
    try {
      if (entry.source.format === 'hwp3' && !saveAs) throw Error('HWP 3 문서는 HWP 5 또는 HWPX로 다른 이름으로 저장하세요.');
      target = entry.document.path;
      if (saveAs) {
        const result = await dialog.showSaveDialog(state.window, { defaultPath: target,
          filters: [{ name: '한글 문서', extensions: ['hwp', 'hwpx'] }] });
        if (result.canceled || !result.filePath) return { canceled: true };
        target = canonicalPath(result.filePath);
      }
      if (!isHwpDocument(target)) throw Error('확장자를 .hwp 또는 .hwpx로 지정하세요.');
      if (this.targets.has(target)) throw Error('다른 HWP 문서가 같은 파일에 저장 중입니다.');
      this.targets.add(target); locked = true;
      const same = target === entry.document.path;
      if (entry.source.format === 'hwp3' && same) throw Error('HWP 3 원본은 덮어쓸 수 없습니다. 새 파일명을 지정하세요.');
      const expected = same ? { version: entry.source.version, hash: entry.source.hash } : await hwpVersion(target);
      const format = /\.hwpx$/i.test(target) ? 'hwpx' : 'hwp';
      const artifact = await this.export(entry, format);
      if (hwpContainer(artifact.bytes) !== format) throw Error('내보낸 바이너리의 형식이 저장 확장자와 일치하지 않습니다.');
      const report = artifact.contentLoss;
      if (!report || report.schemaVersion !== 1 || report.outputFormat !== format || !Number.isSafeInteger(report.count)
        || report.count < 0 || !Array.isArray(report.losses) || report.losses.length !== report.count)
        throw Error('HWP 내보내기의 손실 보고서를 검증하지 못했습니다.');
      if (report.count) {
        if (same) throw Error(`저장 시 ${report.count}개 항목의 손실이 보고되었습니다. 원본을 보존하려면 다른 이름으로 저장하세요.`);
        const result = await dialog.showMessageBox(state.window, { type: 'warning', title: 'HWP 변환 손실',
          message: `${report.count}개 항목이 보존되지 않습니다. 사본을 저장하시겠습니까?`,
          detail: JSON.stringify(report.losses, null, 2).slice(0, 8000), buttons: ['취소', '사본 저장'], defaultId: 0, cancelId: 0 });
        if (result.response !== 1) return { canceled: true };
      }
      const version = await writeHwp(target, artifact.bytes, expected,
        () => this.entries.get(id) === entry && entry.owner === owner && !entry.contents.isDestroyed());
      entry.source = { bytes: Buffer.from(artifact.bytes), version, hash: hwpHash(artifact.bytes), format };
      entry.savedRevision = artifact.revision;
      entry.revision = Math.max(entry.revision, artifact.revision);
      entry.document = { ...entry.document, path: target, name: path.basename(target), diskVersion: version,
        revision: entry.revision, savedRevision: artifact.revision };
      entry.contents.send('hwp-runtime:saved', { revision: artifact.revision, name: entry.document.name });
      if (state.currentDocument?.path === originalPath)
        state.currentDocument = { ...entry.document };
      this.publish(entry);
      return { canceled: false, document: { ...entry.document } };
    } finally { if (locked) this.targets.delete(target); entry.saving = false; }
  }
  register(channels: WindowIpc) {
    channels.handle('hwp:open', async (state, id: string, document: DocumentSnapshot) => this.state(await this.open(state, id, document)));
    channels.on('hwp:present', (state, id: string, bounds: unknown) => {
      const entry = this.entries.get(id); if (!entry || entry.owner !== state.webContentsId) return;
      entry.bounds = readPreviewBounds(bounds); this.present(entry);
    });
    channels.on('hwp:focus', (state, id: string) => { const entry = this.entries.get(id);
      if (entry?.owner === state.webContentsId && entry.view.getVisible()) entry.contents.focus(); });
    channels.on('hwp:command', (state, id: string, command: unknown) => { const entry = this.entries.get(id);
      if (entry?.owner === state.webContentsId && ['undo', 'redo', 'find', 'cut', 'copy', 'paste', 'select-all'].includes(String(command))) entry.contents.send('hwp-runtime:command', command); });
    channels.on('hwp:zoom', (state, id: string, steps: unknown) => { const entry = this.entries.get(id);
      if (entry?.owner === state.webContentsId && typeof steps === 'number' && Number.isInteger(steps) && Math.abs(steps) <= 4) entry.contents.send('hwp-runtime:zoom', steps); });
    channels.on('hwp:release', (state, id: string) => { if (this.openingOwners.get(id) === state.webContentsId) this.canceled.add(id); const entry = this.entries.get(id); if (entry?.owner === state.webContentsId) this.close(entry); });
    channels.handle('hwp:save', (state, id: string, saveAs: unknown) => this.save(state.webContentsId, id, saveAs === true));
    channels.handle('hwp:reload', async (state, id: string, document: DocumentSnapshot) => {
      const entry = this.owned(state.webContentsId, id); if (entry.saving) throw Error('저장 완료 후 다시 불러오세요.');
      const bounds = entry.bounds; this.close(entry); const next = await this.open(state, id, document); next.bounds = bounds; return this.state(next);
    });
    channels.handle('hwp:retarget', async (state, id: string, document: DocumentSnapshot) => {
      this.assertDocument(state, document); const entry = this.owned(state.webContentsId, id);
      if (entry.document.path === document.path) return;
      const source = await readHwp(document.path);
      if (source.hash !== entry.source.hash) throw Error('이동한 HWP 파일의 내용이 변경되었습니다.');
      entry.document = { ...entry.document, path: document.path, name: document.name }; entry.source = source;
    });
    const runtime = (sender: WebContents) => [...this.entries.values()].find(entry => entry.contents === sender);
    ipcMain.handle('hwp-runtime:load', event => { const entry = runtime(event.sender);
      if (!entry) throw Error('Unknown HWP runtime.'); return { bytes: entry.source.bytes, name: entry.document.name, position: entry.document.readingPosition }; });
    ipcMain.on('hwp-runtime:state', (event, value: { revision?: number; ready?: boolean; error?: string; position?: unknown }) => {
      const entry = runtime(event.sender); if (!entry || !value) return;
      if (Number.isSafeInteger(value.revision) && value.revision! >= entry.revision) entry.revision = value.revision!;
      entry.ready = value.ready === true; entry.error = typeof value.error === 'string' ? value.error.slice(0, 4000) : undefined;
      if (value.position) {
        const record = { version: 1, path: entry.document.path, diskVersion: entry.source.version, position: value.position, observedAt: Date.now() };
        if (validReadingRecord(record) && record.position.kind === 'hwp') { entry.document.readingPosition = record.position; if (entry.view.getVisible()) this.options.positions.save(record); }
      }
      this.publish(entry); this.present(entry);
    });
    ipcMain.on('hwp-runtime:action', (event, command: unknown) => { const entry = runtime(event.sender);
      if (entry && entry.view.getVisible() && ['focus','save','save-as'].includes(String(command)))
        this.options.stateFor(entry.owner)?.window.webContents.send('hwp:action', { id: entry.id, command }); });
    ipcMain.on('hwp-runtime:exported', (event, result: { request: string; artifact?: HwpArtifact; error?: string; position?: unknown }) => {
      const entry = runtime(event.sender); const pending = entry?.pending.get(result?.request); if (!entry || !pending) return;
      entry.pending.delete(result.request); clearTimeout(pending.timer);
      const artifact = result.artifact;
      if (!artifact || !(artifact.bytes instanceof Uint8Array) || artifact.bytes.length > MAX_HWP_BYTES
        || !Number.isSafeInteger(artifact.revision) || artifact.revision < entry.savedRevision)
        pending.reject(Error(result.error ?? 'Invalid HWP export.'));
      else pending.resolve(artifact);
    });
  }
}
