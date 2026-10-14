import type { ZoomSnapshot } from '../core/zoom';

export const zoomState = $state<ZoomSnapshot>({ app: 100, text: 100, terminal: 100, revision: -1 });

/** Media surfaces publish their actual rendered scale, including fit modes.
 * Commands belong to the tab, so a background split never zooms its neighbor. */
export type MediaZoom = { percent: number; max: number; change(steps: number): void };
export const mediaZoom = $state<Record<string, MediaZoom>>({});
