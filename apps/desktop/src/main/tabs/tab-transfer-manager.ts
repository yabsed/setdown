import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import type { TransferableTab } from '../../protocol/desktop-api';
import { isMarkdownDocument, documentSurface } from '../../core/document/document-profile';
import { previewThemeBackground, type PreviewThemeId } from '../../core/preview/preview-preferences';
import type { BandLine } from '../../core/preview/viewport-anchor';
import type { WindowState } from '../windows/window-state';
import type { PreviewManager } from '../preview/preview-manager';

type Transfer = {
  sourceWebContentsId: number; tab: TransferableTab; claimedByWebContentsId: number | null;
  expiresAt: number; detachPosition: { x: number; y: number } | null; previewAdopted: boolean;
  preparedWindow: BrowserWindow | null; previewScrollPosition: Promise<{ x: number; y: number }>;
  previewBand: Promise<BandLine[]>; sourceContentSize: { width: number; height: number } | null;
};
type Options = {
  previews: PreviewManager; stateFor: (id: number) => WindowState | null; theme: () => PreviewThemeId;
  createWindow: (position: { x: number; y: number } | null, initialDocument: null,
    showWhenReady: boolean, contentSize: { width: number; height: number } | null) => BrowserWindow;
};
export class TabTransferManager {
  private readonly transfers = new Map<string, Transfer>();
  constructor(private readonly options: Options) {}
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
      || typeof incoming.document?.path !== 'string') return;
    const markdown = isMarkdownDocument(incoming.document.path);
    const tab: TransferableTab = markdown ? incoming : { ...incoming, surface: documentSurface(incoming.document.path),
      previewUrl: null, previewRevision: null, previewTheme: null, viewerScrollRatio: null,
      viewerBand: [], tocOpen: false };
    const ownedPreview = markdown ? this.options.previews.views.get(tab.id) : undefined;
    const preview = ownedPreview?.ownerWebContentsId === sourceId ? ownedPreview.view.webContents : undefined;
    const transfer: Transfer = {
      sourceWebContentsId: sourceId, tab, claimedByWebContentsId: null, expiresAt: Date.now() + 60_000,
      detachPosition: null, previewAdopted: false,
      preparedWindow: this.options.createWindow(null, null, false, this.contentSize(sourceId)),
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
    setTimeout(() => {
      const pending = this.transfers.get(transferId);
      if (!pending || pending.expiresAt > Date.now()) return;
      if (pending.preparedWindow && !pending.preparedWindow.isDestroyed()) pending.preparedWindow.destroy();
      this.transfers.delete(transferId);
    }, 60_500);
  }
  private async adopt(destinationId: number, transferId: string) {
    const transfer = this.transfers.get(transferId);
    if (!transfer || transfer.claimedByWebContentsId !== destinationId) return false;
    const destination = this.options.stateFor(destinationId)?.window;
    if (!destination || destination.isDestroyed()) return false;
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
    if (!transfer || transfer.expiresAt < Date.now()) { this.transfers.delete(transferId); return null; }
    if (transfer.sourceWebContentsId === destinationId || transfer.claimedByWebContentsId !== null) return null;
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
  private detach(sourceId: number, transferId: string, x: unknown, y: unknown) {
    const transfer = this.transfers.get(transferId);
    if (!transfer || transfer.sourceWebContentsId !== sourceId || transfer.claimedByWebContentsId !== null) return;
    transfer.detachPosition = { x: Math.round(Number(x) - 120), y: Math.round(Number(y) - 18) };
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
    ipcMain.on('tabs:cancel-transfer', (event, id) => {
      const transfer = this.transfers.get(id);
      if (transfer?.sourceWebContentsId !== event.sender.id || transfer.claimedByWebContentsId !== null) return;
      if (transfer.preparedWindow && !transfer.preparedWindow.isDestroyed()) transfer.preparedWindow.destroy();
      this.transfers.delete(id);
    });
    ipcMain.on('tabs:detach-to-window', (event, { transferId, x, y }) => this.detach(event.sender.id, transferId, x, y));
  }
}
