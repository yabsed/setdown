import type { TerminalManager } from '../terminal/terminal-manager';
import type { BrowserManager } from '../browser/browser-manager';
import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import type { TransferableTab } from '../../protocol/desktop-api';
import { isMarkdownDocument, documentSurface } from '../../core/document/document-profile';
import { previewThemeBackground, type PreviewThemeId } from '../../core/preview/preview-preferences';
import type { BandLine } from '../../core/preview/viewport-anchor';
import type { WindowState } from '../windows/window-state';
import type { PreviewManager } from '../preview/preview-manager';

type Transfer = {
  dragParticipants: Set<number>; dragActive: boolean; dragTarget: number | null; hoverOwner: number | null;
  sourceWebContentsId: number; tab: TransferableTab; claimedByWebContentsId: number | null;
  expiresAt: number; detachPosition: { x: number; y: number } | null; previewAdopted: boolean;
  detachTimer: ReturnType<typeof setTimeout> | null;
  allowDetach: boolean;
  preparedWindow: BrowserWindow | null; previewScrollPosition: Promise<{ x: number; y: number }>;
  previewBand: Promise<BandLine[]>; sourceContentSize: { width: number; height: number } | null;
};
type Options = {
  globalWindowPositions?: boolean;
  previews: PreviewManager; browsers?: BrowserManager; terminals?: TerminalManager; stateFor: (id: number) => WindowState | null; theme: () => PreviewThemeId;
  windows: () => Iterable<WindowState>;
  createWindow: (position: { x: number; y: number } | null, initialDocument: null,
    showWhenReady: boolean, contentSize: { width: number; height: number } | null) => BrowserWindow;
};
const DETACH_CLAIM_GRACE_MS = 120;

export class TabTransferManager {
  private readonly transfers = new Map<string, Transfer>();
  private readonly watchedSources = new WeakSet<BrowserWindow>();
  constructor(private readonly options: Options) {}
  private endDrag(transferId: string, transfer: Transfer, commitTarget: number | null = null, copy = false): void {
    if (!transfer.dragActive) return;
    transfer.dragActive = false;
    for (const id of transfer.dragParticipants) {
      const window = this.options.stateFor(id)?.window;
      this.options.browsers?.tabDrag.state(id, null);
      if (window && !window.isDestroyed()) window.webContents.send('tabs:drag-state', {
        transferId, active: false, ...(id === commitTarget ? { commitGuide: true, copy } : {}),
      });
    }
  }
  private contentSize(ownerId: number) {
    const owner = this.options.stateFor(ownerId)?.window;
    if (!owner || owner.isDestroyed()) return null;
    const [width, height] = owner.getContentSize();
    return width > 0 && height > 0 ? { width, height } : null;
  }
  private keepsGeometry(transfer: Transfer, destinationId: number) {
    const source = transfer.sourceContentSize;
    const destination = this.contentSize(destinationId);
    return !!source && !!destination && source.width === destination.width && source.height === destination.height;
  }
  private register(sourceId: number, transferId: unknown, candidate: unknown) {
    const incoming = candidate as TransferableTab | null;
    if (typeof transferId !== 'string' || !incoming || typeof incoming.id !== 'string'
      || this.transfers.has(transferId)
      || !this.options.stateFor(sourceId)
      || (incoming.kind === 'terminal' ? !this.options.terminals?.owns(sourceId, incoming.sessionId ?? incoming.id) : incoming.kind === 'web' ? !this.options.browsers?.owns(sourceId, incoming.id) : typeof incoming.document?.path !== 'string')) return;
    for (const [id, pending] of this.transfers) if (pending.dragActive && pending.claimedByWebContentsId === null)
      this.cancel(pending.sourceWebContentsId, id);
    const source = this.options.stateFor(sourceId)!.window;
    const allowDetach = !source.isMaximized() && !source.isFullScreen();
    if (!this.watchedSources.has(source)) {
      this.watchedSources.add(source);
      // The OS drag loop can consume Escape keydown. Its native keyup still
      // arrives, including before an outside dragend requests detachment.
      source.webContents.on('before-input-event', (_event, input) => {
        if (input.key !== 'Escape' || input.isComposing) return;
        for (const [id, transfer] of this.transfers) {
          if (transfer.sourceWebContentsId === sourceId) this.cancel(sourceId, id);
        }
      });
      source.once('closed', () => {
        for (const [id, transfer] of this.transfers) if (transfer.sourceWebContentsId === sourceId) {
          this.endDrag(id, transfer); this.cancel(sourceId, id);
        }
      });
    }
    const markdown = incoming.kind !== 'web' && incoming.kind !== 'terminal' && isMarkdownDocument(incoming.document.path);
    const tab: TransferableTab = incoming.kind === 'terminal' || incoming.kind === 'web' || markdown ? incoming : { ...incoming, surface: documentSurface(incoming.document.path),
      previewUrl: null, previewRevision: null, previewTheme: null, viewerScrollRatio: null,
      viewerBand: [], tocOpen: false };
    const ownedPreview = markdown ? this.options.previews.views.get(tab.id) : undefined;
    const preview = ownedPreview?.ownerWebContentsId === sourceId ? ownedPreview.view.webContents : undefined;
    const transfer: Transfer = {
      dragParticipants: new Set(), dragActive: true, dragTarget: null, hoverOwner: sourceId,
      sourceWebContentsId: sourceId, tab, claimedByWebContentsId: null, expiresAt: Date.now() + 60_000,
      detachPosition: null, detachTimer: null, previewAdopted: false,
      allowDetach,
      preparedWindow: allowDetach ? this.options.createWindow(null, null, false, this.contentSize(sourceId)) : null,
      sourceContentSize: this.contentSize(sourceId),
      previewScrollPosition: preview?.executeJavaScript('({ x: window.scrollX, y: window.scrollY })')
        .catch(() => ({ x: 0, y: 0 })) ?? Promise.resolve({ x: 0, y: 0 }),
      previewBand: preview?.executeJavaScript(`(() => {
        const root = document.querySelector('.markdown-preview[data-for="preview"]');
        if (!root) return [];
        const height = window.innerHeight || 1;
        const band = [];
        root.querySelectorAll('[data-source-line]').forEach((element) => {
          const line = Number(element.getAttribute('data-source-line'));
          if (!Number.isFinite(line) || line < 1) return;
          const rect = element.getBoundingClientRect();
          if ((rect.width === 0 && rect.height === 0) || rect.top < 0 || rect.top > height) return;
          band.push({ sourceLine: line, yRatio: rect.top / height });
        });
        return band;
      })()`).catch(() => [] as BandLine[]) ?? Promise.resolve([] as BandLine[]),
    };
    this.transfers.set(transferId, transfer);
    // Native web/Markdown children do not dispatch dragover to another window's
    // shell. Cover them before entry, so the actual OS drop reaches that shell.
    // End is also shared: HTML dragend is delivered only to the source document.
    for (const { window } of this.options.windows()) {
      if (window.isDestroyed() || !window.isVisible() || window.isMinimized()) continue;
      transfer.dragParticipants.add(window.webContents.id);
      this.options.browsers?.tabDrag.state(window.webContents.id, transferId);
      window.webContents.send('tabs:drag-state', { transferId, active: true });
    }
    setTimeout(() => {
      const pending = this.transfers.get(transferId);
      if (!pending || pending.expiresAt > Date.now()) return;
      this.endDrag(transferId, pending);
      if (pending.detachTimer) clearTimeout(pending.detachTimer);
      if (pending.preparedWindow && !pending.preparedWindow.isDestroyed()) pending.preparedWindow.destroy();
      this.transfers.delete(transferId);
    }, 60_500);
  }
  private async adopt(destinationId: number, transferId: string) {
    const transfer = this.transfers.get(transferId);
    if (!transfer || transfer.claimedByWebContentsId !== destinationId) return false;
    const destination = this.options.stateFor(destinationId)?.window;
    if (!destination || destination.isDestroyed()) return false;
    if (transfer.tab.kind === 'terminal') {
      transfer.previewAdopted = this.options.terminals?.adopt(transfer.sourceWebContentsId, destinationId, transfer.tab.sessionId ?? transfer.tab.id) ?? false;
      return transfer.previewAdopted;
    }
    if (transfer.tab.kind === 'web') {
      transfer.previewAdopted = this.options.browsers?.adopt(transfer.sourceWebContentsId, destinationId, transfer.tab.id) ?? false;
      return transfer.previewAdopted;
    }
    // Text tabs transfer their document/model state; there is no native page to adopt.
    if (!isMarkdownDocument(transfer.tab.document.path)) {
      transfer.previewAdopted = true;
      return true;
    }
    const preview = this.options.previews.views.get(transfer.tab.id);
    if (!preview || preview.ownerWebContentsId !== transfer.sourceWebContentsId) return false;
    const scroll = await transfer.previewScrollPosition;
    void preview.view.webContents.executeJavaScript(
      `window.__setdownTransferScroll = { capturedX: ${JSON.stringify(scroll.x)}, capturedY: ${JSON.stringify(scroll.y)} }`);
    const source = this.options.stateFor(transfer.sourceWebContentsId)?.window;
    preview.view.setVisible(false);
    source?.contentView.removeChildView(preview.view);
    destination.contentView.addChildView(preview.view);
    preview.ownerWebContentsId = destinationId;
    preview.appliedBounds = null;
    preview.view.setBackgroundColor(previewThemeBackground(transfer.tab.previewTheme ?? this.options.theme()));
    const keepsGeometry = this.keepsGeometry(transfer, destinationId);
    const band = await transfer.previewBand.catch(() => [] as BandLine[]);
    preview.pendingScrollPosition = keepsGeometry || band.length ? null : scroll;
    preview.pendingScrollRatio = keepsGeometry || band.length || !Number.isFinite(Number(transfer.tab.viewerScrollRatio))
      ? null : Math.max(0, Math.min(1, Number(transfer.tab.viewerScrollRatio)));
    transfer.previewAdopted = true;
    return true;
  }
  private async claim(destinationId: number, transferId: string) {
    const transfer = this.transfers.get(transferId);
    if (!transfer) return null;
    if (transfer.expiresAt < Date.now()) { this.cancel(transfer.sourceWebContentsId, transferId); return null; }
    if (transfer.sourceWebContentsId === destinationId || transfer.claimedByWebContentsId !== null) return null;
    this.endDrag(transferId, transfer);
    if (transfer.detachTimer) clearTimeout(transfer.detachTimer);
    transfer.detachTimer = null;
    transfer.claimedByWebContentsId = destinationId;
    if (transfer.preparedWindow && !transfer.preparedWindow.isDestroyed()
      && transfer.preparedWindow.webContents.id !== destinationId) {
      transfer.preparedWindow.destroy(); transfer.preparedWindow = null;
    }
    return { transferId, tab: { ...transfer.tab, viewerBand: await transfer.previewBand,
      previewGeometryUnchanged: this.keepsGeometry(transfer, destinationId) } };
  }
  private release(sourceId: number, transferId: string) {
    const transfer = this.transfers.get(transferId);
    if (!transfer || transfer.sourceWebContentsId !== sourceId) return;
    this.endDrag(transferId, transfer);
    if (transfer.detachTimer) clearTimeout(transfer.detachTimer);
    const destination = transfer.claimedByWebContentsId === null ? null : this.options.stateFor(transfer.claimedByWebContentsId)?.window;
    this.transfers.delete(transferId);
    if (!destination || destination.isDestroyed()) return;
    if (!destination.isVisible()) {
      destination.once('show', () => setImmediate(() => {
        for (const preview of this.options.previews.views.values()) {
          if (preview.ownerWebContentsId === destination.webContents.id) this.options.previews.restoreScroll(preview);
        }
        if (!destination.isDestroyed()) destination.focus();
      }));
      destination.show();
    }
    destination.focus();
  }
  private cancel(sourceId: number, transferId: string) {
    const transfer = this.transfers.get(transferId);
    if (transfer?.sourceWebContentsId !== sourceId || transfer.claimedByWebContentsId !== null) return;
    this.endDrag(transferId, transfer);
    if (transfer.detachTimer) clearTimeout(transfer.detachTimer);
    if (transfer.preparedWindow && !transfer.preparedWindow.isDestroyed()) transfer.preparedWindow.destroy();
    this.transfers.delete(transferId);
  }
  private dragTarget(destinationId: number, transferId: string, accepted: unknown, inside: unknown = true, retainGuide: unknown = false) {
    const transfer = this.transfers.get(transferId);
    if (!transfer?.dragActive || transfer.claimedByWebContentsId !== null
      || !transfer.dragParticipants.has(destinationId)) return;
    if (inside === false) {
      if (transfer.hoverOwner === destinationId) {
        transfer.hoverOwner = null;
        // Chromium can send a coordinate-less terminal leave instead of drop.
        // Only an accepted OS dropEffect may commit this retained target.
        if (retainGuide !== true) transfer.dragTarget = null;
      }
      return;
    }
    if (transfer.hoverOwner !== destinationId) {
      // Clear the old window's guide even when Chromium omitted its dragleave.
      for (const id of transfer.dragParticipants) if (id !== destinationId) {
        this.options.stateFor(id)?.window.webContents.send('tabs:native-drag', {
          transferId, type: 'dragleave', clientX: -1, clientY: -1, screenX: 0, screenY: 0, ctrlKey: false, altKey: false,
        });
      }
    }
    transfer.hoverOwner = destinationId;
    transfer.dragTarget = accepted === true ? destinationId : null;
  }
  private detach(sourceId: number, transferId: string, x: unknown, y: unknown, withinSource: unknown = false, dropEffect?: unknown, release?: { x: number; y: number }) {
    const transfer = this.transfers.get(transferId);
    if (!transfer?.dragActive || transfer.sourceWebContentsId !== sourceId || transfer.claimedByWebContentsId !== null) return;
    const screenX = Number(x), screenY = Number(y);
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) { this.endDrag(transferId, transfer); return; }
    transfer.detachPosition = { x: Math.round(screenX - 120), y: Math.round(screenY - 18) };
    if (transfer.detachTimer) clearTimeout(transfer.detachTimer);
    transfer.detachTimer = null;
    const source = this.options.stateFor(sourceId)?.window;
    let releasedInsideSource = false;
    if (source && release && [release.x, release.y].every(Number.isFinite)) {
      const [width, height] = source.getContentSize(), zoom = source.webContents.getZoomFactor();
      let outside = release.x < 0 || release.y < 0 || release.x * zoom >= width || release.y * zoom >= height;
      // On X11/macOS/Windows a final screen point can prove an outside release
      // even when Chromium retains its last in-window client coordinates. Never
      // use this on Wayland, or use global bounds to select a destination.
      const globalPositionAvailable = this.options.globalWindowPositions ?? (process.platform !== 'linux' || !process.env.WAYLAND_DISPLAY);
      if (globalPositionAvailable && (screenX !== 0 || screenY !== 0)) {
        const bounds = source.getContentBounds();
        outside ||= screenX < bounds.x || screenY < bounds.y || screenX >= bounds.x + bounds.width || screenY >= bounds.y + bounds.height;
      }
      releasedInsideSource = !outside;
      if (outside) {
        if (transfer.dragTarget === sourceId) transfer.dragTarget = null;
        if (transfer.hoverOwner === sourceId) transfer.hoverOwner = null;
      }
    }
    // A rejected/canceled release inside the window is not a center tear-off.
    // Native borders can swallow the final over/drop after a center hover.
    if (withinSource === true && releasedInsideSource && dropEffect === 'none') {
      this.cancel(sourceId, transferId); return;
    }
    const accepted = ['move', 'copy'].includes(String(dropEffect));
    const target = transfer.dragTarget === null ? null : this.options.stateFor(transfer.dragTarget)?.window;
    const commitTarget = accepted && target && !target.isDestroyed() && target.isVisible() && !target.isMinimized()
      ? transfer.dragTarget : null;
    if (commitTarget !== null) {
      this.endDrag(transferId, transfer, commitTarget, dropEffect === 'copy');
      return;
    }
    // Only OS-delivered local drag events establish ownership. getBounds().x/y
    // do not expose native Wayland window positions and cannot arbitrate a drop.
    const tearOff = withinSource === true && transfer.hoverOwner === sourceId;
    if (!tearOff && transfer.hoverOwner !== null) {
      if (transfer.hoverOwner === sourceId) this.cancel(sourceId, transferId);
      else this.endDrag(transferId, transfer); // An already-dispatched remote DOM drop may still claim it.
      return;
    }
    // A destination's drop/claim and source dragend use separate IPC queues.
    // Keep the receiver/token alive through arbitration: a local native drop
    // can still be in flight too, and must replace stale center tear-off intent.
    transfer.detachTimer = setTimeout(() => this.commitDetach(sourceId, transferId), DETACH_CLAIM_GRACE_MS);
  }

  private commitDetach(sourceId: number, transferId: string) {
    const transfer = this.transfers.get(transferId);
    if (!transfer || transfer.sourceWebContentsId !== sourceId || transfer.claimedByWebContentsId !== null
      || !transfer.detachPosition) return;
    transfer.detachTimer = null;
    const source = this.options.stateFor(sourceId)?.window;
    // Keep local/remote drops eligible through arbitration, but never turn a
    // fullscreen/maximized drag into a new window, even after a native leave.
    // Check again here in case the window changed state during the drag.
    if (!transfer.allowDetach || !source || source.isDestroyed() || source.isMaximized() || source.isFullScreen()) {
      this.cancel(sourceId, transferId); return;
    }
    this.endDrag(transferId, transfer);
    const destination = transfer.preparedWindow && !transfer.preparedWindow.isDestroyed()
      ? transfer.preparedWindow : this.options.createWindow(transfer.detachPosition, null, false, this.contentSize(sourceId));
    transfer.preparedWindow = destination;
    destination.setPosition(transfer.detachPosition.x, transfer.detachPosition.y, false);
    transfer.claimedByWebContentsId = destination.webContents.id;
    if (!destination.isVisible()) destination.showInactive();
    const sendIncoming = async () => {
      if (!this.transfers.has(transferId) || destination.isDestroyed()) return;
      const band = await transfer.previewBand.catch(() => [] as BandLine[]);
      if (!this.transfers.has(transferId) || destination.isDestroyed()) return;
      destination.webContents.send('tabs:transfer-incoming', { transferId, tab: { ...transfer.tab,
        viewerBand: band, previewGeometryUnchanged: this.keepsGeometry(transfer, destination.webContents.id) } });
    };
    if (destination.webContents.isLoadingMainFrame()) destination.webContents.once('did-finish-load', () => void sendIncoming());
    else void sendIncoming();
  }
  registerIpc() {
    ipcMain.on('tabs:register-transfer', (event, { transferId, tab }) => this.register(event.sender.id, transferId, tab));
    ipcMain.handle('tabs:adopt-transfer', (event, id) => this.adopt(event.sender.id, id));
    ipcMain.handle('tabs:claim-transfer', (event, id) => this.claim(event.sender.id, id));
    ipcMain.on('tabs:complete-transfer', (event, id) => {
      const transfer = this.transfers.get(id);
      if (!transfer || transfer.claimedByWebContentsId !== event.sender.id || !transfer.previewAdopted) return;
      this.options.stateFor(transfer.sourceWebContentsId)?.window.webContents.send(
        'tabs:transfer-completed', { transferId: id, tabId: transfer.tab.id });
    });
    ipcMain.on('tabs:release-source', (event, id) => this.release(event.sender.id, id));
    ipcMain.on('tabs:cancel-transfer', (event, id) => this.cancel(event.sender.id, id));
    ipcMain.on('tabs:drag-target', (event, { transferId, accepted, inside, retainGuide }) => this.dragTarget(event.sender.id, transferId, accepted, inside, retainGuide));
    ipcMain.on('tabs:detach-to-window', (event, { transferId, x, y, withinSource, dropEffect, release }) => this.detach(event.sender.id, transferId, x, y, withinSource, dropEffect, release));
  }
}
