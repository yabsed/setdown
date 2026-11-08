import { displayText, terminalText } from './notebook-content';

/** Match the platform's Monaco default (lineHeight: 0), before an editor exists.
 * Reserving all source lines prevents distant cells moving as views are mounted. */
export function notebookLineHeight(factor: number, mac: boolean): number {
  return Math.max(8, Math.round(14 * factor * (mac ? 1.5 : 1.35)));
}

export function notebookSourceHeight(source: string, factor: number, mac: boolean): number {
  return Math.max(35, source.split(/\r\n|\r|\n/).length * notebookLineHeight(factor, mac) + 16);
}

/** Reserve cheap, deterministic output geometry before virtual output mounting.
 * Read only the PNG header; decoding pixels remains the browser's job. */
export function notebookOutputHeight(outputs: unknown[], width: number, factor: number): number {
  return outputs.slice(0, 100).reduce<number>((height, output) => {
    if (!output || typeof output !== 'object') return height + 48;
    const item = output as { output_type?: string; text?: unknown; data?: Record<string, unknown> };
    if (item.output_type === 'stream') return height + 16 + Math.max(1, terminalText(displayText(item.text)).split('\n').length) * 14 * factor * 1.4;
    if (!item.data?.['text/html'] && item.data?.['image/png']) {
      const value = item.data['image/png'];
      const encoded = typeof value === 'string' ? value : Array.isArray(value) ? value.join('') : '';
      try {
        const header = Uint8Array.from(atob(encoded.slice(0, 48).replace(/\s/g, '')), c => c.charCodeAt(0));
        const view = new DataView(header.buffer), w = view.getUint32(16), h = view.getUint32(20);
        if (view.getUint32(0) === 0x89504e47 && w > 0 && h > 0 && w < 100_000 && h < 100_000)
          return height + 16 + h * Math.min(1, Math.max(1, width - 16) / w);
      } catch { /* Unknown or malformed formats keep a bounded placeholder. */ }
    }
    return height + 48;
  }, 0);
}

/** Small horizontal touchpad noise must not consume an otherwise vertical wheel. */
export function notebookHorizontalWheel(event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'shiftKey' | 'ctrlKey' | 'metaKey'>): number {
  if (event.ctrlKey || event.metaKey) return 0;
  if (event.shiftKey) return event.deltaX || event.deltaY;
  return Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : 0;
}
