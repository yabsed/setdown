import type { PreviewBounds } from '../../protocol/desktop-api';
import type { PreviewViewState } from './preview-manager';

type Options = {
  views: Map<string, PreviewViewState>;
  applyBounds(preview: PreviewViewState, bounds: PreviewBounds): void;
  navigating(preview: PreviewViewState): boolean;
};
type Primed = { bounds: PreviewBounds; position: Record<string, unknown> };

/** Hidden preparation never changes native visibility or keyboard focus. */
export class ReviewPreparation {
  private readonly primed = new Map<string, Primed>();
  private nextId = 0;
  private readonly waiting = new Map<string, {
    id: number; revision: number; finish(error?: Error): void;
  }>();
  constructor(private readonly options: Options) {}

  command(ownerId: number, tabId: string, message: Record<string, unknown>): boolean {
    if (message.command !== 'marktex:prime-review') return false;
    const preview = this.options.views.get(tabId);
    if (!preview || preview.ownerWebContentsId !== ownerId || preview.view.webContents.isDestroyed()) return true;
    const raw = message.bounds as Partial<PreviewBounds> | null;
    if (!raw || ![raw.x, raw.y, raw.width, raw.height].every((n) => typeof n === 'number' && Number.isFinite(n))
      || raw.width! <= 0 || raw.height! <= 0) {
      this.primed.delete(tabId);
      return true;
    }
    const value = message.position as Record<string, unknown> | null;
    if (!value || typeof value.sourceLine !== 'number' || !Number.isFinite(value.sourceLine)) return true;
    const band = Array.isArray(value.band) ? value.band.slice(0, 2048).flatMap((sample) => {
      const item = sample as { sourceLine?: unknown; yRatio?: unknown } | null;
      return item && typeof item.sourceLine === 'number' && Number.isFinite(item.sourceLine)
        && typeof item.yRatio === 'number' && Number.isFinite(item.yRatio)
        ? [{ sourceLine: Math.max(1, Math.round(item.sourceLine)), yRatio: Math.max(0, Math.min(1, item.yRatio)) }] : [];
    }) : [];
    const position = {
      command: 'marktex:position-preview', sourceLine: Math.max(1, Math.round(value.sourceLine)),
      topRatio: typeof value.topRatio === 'number' && Number.isFinite(value.topRatio)
        ? Math.max(0, Math.min(1, value.topRatio)) : .372,
      sourceSide: value.sourceSide === 'before' ? 'before' : 'after', band, settle: false,
      blockOffset: typeof value.blockOffset === 'number' && Number.isFinite(value.blockOffset)
        ? Math.max(0, Math.min(1, value.blockOffset)) : undefined,
    };
    const bounds = {
      x: Math.max(0, Math.min(100_000, Math.round(raw.x!))),
      y: Math.max(0, Math.min(100_000, Math.round(raw.y!))),
      width: Math.max(1, Math.min(100_000, Math.round(raw.width!))),
      height: Math.max(1, Math.min(100_000, Math.round(raw.height!))),
    };
    // A late source-prewarming event may not reposition the visible front.
    if (preview.view.getVisible()) return true;
    this.primed.set(tabId, { bounds, position });
    this.options.applyBounds(preview, bounds);
    if (!this.options.navigating(preview) && preview.view.webContents.getURL().startsWith('marktex-preview://document/')) {
      preview.view.webContents.send('preview:command', { ...position, command: 'marktex:prime-position' });
    }
    return true;
  }

  prepare(ownerId: number, tabId: string, revision: number): Promise<void> {
    const preview = this.options.views.get(tabId);
    const primed = this.primed.get(tabId);
    // A cold/inactive review can still finish rendering. Its first presentation
    // retains the existing valid-bounds-before-position contract.
    if (!primed || !preview || preview.ownerWebContentsId !== ownerId || preview.view.getVisible()) return Promise.resolve();
    this.options.applyBounds(preview, primed.bounds);
    this.waiting.get(tabId)?.finish(new Error('Superseded preview preparation.'));
    const id = ++this.nextId;
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('Preview positioning did not acknowledge.')), 5000);
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        if (this.waiting.get(tabId)?.id === id) this.waiting.delete(tabId);
        if (error) reject(error); else resolve();
      };
      this.waiting.set(tabId, { id, revision, finish });
      try {
        preview.view.webContents.send('preview:command', {
          ...primed.position, command: 'marktex:prepare-review', requestId: id, revision,
        });
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  receive(tabId: string, message: Record<string, unknown>): void {
    const request = this.waiting.get(tabId);
    if (!request || message.type !== 'marktex:review-prepared' || message.requestId !== request.id
      || message.revision !== request.revision) return;
    request.finish(typeof message.error === 'string' ? new Error(message.error) : undefined);
  }

  forget(tabId: string): void {
    this.primed.delete(tabId);
    this.waiting.get(tabId)?.finish(new Error('Preview closed during preparation.'));
  }
}
