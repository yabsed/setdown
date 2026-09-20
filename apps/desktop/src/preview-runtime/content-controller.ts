import { splitPreviewBlocks } from '../core/preview/preview-blocks';
import {
  DEFERRED_HTML_SCRIPT_ID,
  INITIAL_HTML_TEMPLATE_ID,
  partitionPreviewHtml,
  requiresCrossnoteInstall,
} from '../core/preview/preview-install';
import type { BandLine } from '../core/preview/viewport-anchor';
import {
  ANCHOR_SELECTOR,
  PREVIEW_SELECTOR,
  type SourceAtlas,
  shiftSourceLines,
  shiftSourceLinesHtml,
  sourceLinePair,
} from './source-atlas';

type Options = {
  sourceAtlas: SourceAtlas;
  applyDisclosures: (inserted: Element[] | null) => void;
  scheduleHeadings: () => void;
  viewportChanged: () => void;
};

export type BlockPatch = {
  from?: number;
  removeCount?: number;
  html?: string;
  lineDelta?: number;
};

export class ContentController {
  private deferredBlocks: string[] = [];
  private generation = 0;
  private startedGeneration = 0;
  private backgroundGeneration = -1;
  private batchFrame: number | null = null;
  private batchTimer: number | null = null;

  constructor(private readonly options: Options) {}

  get pendingCount(): number {
    return this.deferredBlocks.length;
  }

  root(): HTMLElement | null {
    return document.querySelector<HTMLElement>(PREVIEW_SELECTOR);
  }

  finishInstall(root: HTMLElement): void {
    root.className = 'crossnote markdown-preview zen-mode';
    this.options.applyDisclosures(null);
    this.options.sourceAtlas.invalidate();
    this.options.scheduleHeadings();
    this.options.viewportChanged();
    void document.fonts?.ready.then(() => {
      this.options.sourceAtlas.invalidate();
      this.options.viewportChanged();
    }).catch(() => {});
  }

  cancelHydration(): void {
    this.cancelBatch();
    this.deferredBlocks = [];
    this.generation += 1;
    document.body.dataset.setdownHydration = 'complete';
    document.body.dataset.setdownDeferredBlockCount = '0';
    document.body.dataset.setdownPendingBlockCount = '0';
  }

  installInitial(): boolean {
    const carrier = document.getElementById(INITIAL_HTML_TEMPLATE_ID);
    const root = this.root();
    if (!(carrier instanceof HTMLTemplateElement) || !root) return false;
    root.replaceChildren(carrier.content);
    carrier.remove();
    const deferred = this.readDeferredInitialBlocks();
    this.finishInstall(root);
    this.beginHydration(root, deferred);
    return true;
  }

  installSanitized(html: string): boolean {
    const root = this.root();
    if (!root || requiresCrossnoteInstall(html)) return false;
    const partition = partitionPreviewHtml(html);
    root.innerHTML = partition.eagerHtml;
    this.finishInstall(root);
    this.beginHydration(root, partition.deferredBlocks);
    return true;
  }

  patch(update: BlockPatch): void {
    const root = this.root();
    let insertedNodes: Element[] = [];
    if (root) {
      const children = Array.from(root.children);
      const completeLength = children.length + this.deferredBlocks.length;
      const from = Math.min(Math.max(0, Math.round(Number(update.from) || 0)), completeLength);
      const removeCount = Math.min(
        Math.max(0, Math.round(Number(update.removeCount) || 0)),
        completeLength - from,
      );
      const insertedHtml = splitPreviewBlocks(String(update.html ?? '')).map((block) => block.html);
      const delta = Math.round(Number(update.lineDelta) || 0);

      if (this.deferredBlocks.length > 0 && from > children.length) {
        const deferredFrom = from - children.length;
        this.deferredBlocks.splice(deferredFrom, removeCount, ...insertedHtml);
        if (delta !== 0) {
          for (let index = deferredFrom + insertedHtml.length;
            index < this.deferredBlocks.length; index += 1) {
            this.deferredBlocks[index] = shiftSourceLinesHtml(this.deferredBlocks[index], delta);
          }
        }
      } else {
        const holder = document.createElement('template');
        holder.innerHTML = insertedHtml.join('\n');
        const inserted = Array.from(holder.content.children);
        const domFrom = Math.min(from, children.length);
        const domRemoveCount = Math.min(removeCount, children.length - domFrom);
        const deferredRemoveCount = removeCount - domRemoveCount;
        const anchor = children[domFrom + domRemoveCount] ?? null;
        for (let index = 0; index < domRemoveCount; index += 1) {
          children[domFrom + index].remove();
        }
        for (const node of inserted) root.insertBefore(node, anchor);
        insertedNodes = inserted;
        if (deferredRemoveCount > 0) this.deferredBlocks.splice(0, deferredRemoveCount);
        if (delta !== 0) {
          for (const element of Array.from(root.children).slice(domFrom + inserted.length)) {
            shiftSourceLines(element, delta);
          }
          for (let index = 0; index < this.deferredBlocks.length; index += 1) {
            this.deferredBlocks[index] = shiftSourceLinesHtml(this.deferredBlocks[index], delta);
          }
        }
      }

      document.body.dataset.setdownPendingBlockCount = String(this.deferredBlocks.length);
      if (this.deferredBlocks.length === 0) this.finishHydration(root);
    }
    this.options.applyDisclosures(insertedNodes);
    this.options.sourceAtlas.invalidate();
  }

  resumeAfterPaint(): void {
    const root = this.root();
    const generation = this.generation;
    if (!root || this.deferredBlocks.length === 0) return;
    if (this.startedGeneration === generation) return;
    this.startedGeneration = generation;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (generation === this.generation) this.scheduleBatch(root, generation);
    }));
  }

  hydrateAll(): void {
    if (this.deferredBlocks.length === 0) return;
    const root = this.root();
    if (!root) return;
    this.cancelBatch();
    const pending = this.deferredBlocks;
    this.deferredBlocks = [];
    this.generation += 1;
    const holder = document.createElement('template');
    holder.innerHTML = pending.join('\n');
    const inserted = Array.from(holder.content.children);
    root.append(holder.content);
    this.options.applyDisclosures(inserted);
    this.finishHydration(root);
  }

  includesSourceLine(sourceLine: number, band: BandLine[]): boolean {
    if (this.deferredBlocks.length === 0) return true;
    const root = this.root();
    if (!root) return false;
    let lastLine = 0;
    root.querySelectorAll(ANCHOR_SELECTOR).forEach((element) => {
      const values = [
        sourceLinePair(element.getAttribute('data-source-end'))?.[0],
        sourceLinePair(element.getAttribute('data-source-lines'))?.[1],
        Number(element.getAttribute('data-source-line')),
      ];
      for (const value of values) {
        if (Number.isFinite(value)) lastLine = Math.max(lastLine, Number(value));
      }
    });
    const requestedLine = band.reduce(
      (largest, entry) => Math.max(largest, entry.sourceLine),
      sourceLine,
    );
    return requestedLine <= lastLine;
  }

  private beginHydration(root: HTMLElement, blocks: string[]): void {
    this.cancelBatch();
    this.generation += 1;
    this.deferredBlocks = blocks;
    document.body.dataset.setdownHydrationStartedMs = String(performance.now());
    document.body.dataset.setdownInitialElementCount = String(root.querySelectorAll('*').length);
    document.body.dataset.setdownDeferredBlockCount = String(blocks.length);
    document.body.dataset.setdownPendingBlockCount = String(blocks.length);
    if (blocks.length === 0) this.finishHydration(root);
    else document.body.dataset.setdownHydration = 'pending';
  }

  private finishHydration(root: HTMLElement): void {
    document.body.dataset.setdownHydration = 'complete';
    document.body.dataset.setdownPendingBlockCount = '0';
    document.body.dataset.setdownHydrationCompletedMs = String(performance.now());
    document.body.dataset.setdownFullElementCount = String(root.querySelectorAll('*').length);
    this.options.sourceAtlas.invalidate();
    this.options.scheduleHeadings();
    this.options.viewportChanged();
  }

  private hydrateBatch(root: HTMLElement, generation: number): void {
    if (generation !== this.generation || this.deferredBlocks.length === 0) return;
    const batch: string[] = [];
    let bytes = 0;
    while (this.deferredBlocks.length > 0 && batch.length < 8) {
      const next = this.deferredBlocks[0];
      if (batch.length > 0 && bytes + next.length > 64 * 1024) break;
      this.deferredBlocks.shift();
      batch.push(next);
      bytes += next.length;
    }
    document.body.dataset.setdownPendingBlockCount = String(this.deferredBlocks.length);
    const holder = document.createElement('template');
    holder.innerHTML = batch.join('\n');
    const inserted = Array.from(holder.content.children);
    root.append(holder.content);
    this.options.applyDisclosures(inserted);
    // Prepare layout in bounded batches so an immediate Esc/click can paint
    // between tasks instead of waiting for the entire math tree to be built.
    if (this.backgroundGeneration === generation) root.getBoundingClientRect();
    this.options.sourceAtlas.invalidate();
    this.options.scheduleHeadings();
    if (this.deferredBlocks.length === 0) this.finishHydration(root);
    else this.scheduleBatch(root, generation);
  }

  private scheduleBatch(root: HTMLElement, generation: number): void {
    if (this.batchFrame !== null || this.batchTimer !== null) return;
    if (this.backgroundGeneration === generation) {
      this.batchTimer = window.setTimeout(() => {
        this.batchTimer = null;
        this.hydrateBatch(root, generation);
      }, 0);
    } else this.batchFrame = window.requestAnimationFrame(() => {
      this.batchFrame = null;
      this.hydrateBatch(root, generation);
    });
  }

  prepareInBackground(): void {
    const root = this.root();
    if (!root || !this.pendingCount || this.backgroundGeneration === this.generation) return;
    this.backgroundGeneration = this.generation;
    this.cancelBatch();
    // Native views that have never been shown do not receive animation frames.
    // Tasks allow preparation during editing without displaying/focusing them.
    this.scheduleBatch(root, this.generation);
  }

  private cancelBatch(): void {
    if (this.batchFrame !== null) window.cancelAnimationFrame(this.batchFrame);
    if (this.batchTimer !== null) window.clearTimeout(this.batchTimer);
    this.batchFrame = this.batchTimer = null;
  }

  private readDeferredInitialBlocks(): string[] {
    const carrier = document.getElementById(DEFERRED_HTML_SCRIPT_ID);
    if (!carrier) return [];
    carrier.remove();
    try {
      const parsed = JSON.parse(carrier.textContent || '[]');
      return Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === 'string')
        : [];
    } catch {
      return [];
    }
  }
}
