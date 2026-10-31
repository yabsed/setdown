/** App shortcuts are independent of the focused content's wheel zoom. */
export function appZoomStep(input: { type: string; isComposing?: boolean; control?: boolean;
  meta?: boolean; alt?: boolean; shift?: boolean; key: string }): number | undefined {
  if (input.type !== 'keyDown' || input.isComposing || !input.control || input.alt || input.meta) return;
  if (input.key === '+' || input.key === '=') return 1;
  if (input.key === '-' || input.key === '_') return -1;
  if (input.key === '0' && !input.shift) return 0;
}
export type ZoomSnapshot = { app: number; text: number; terminal: number; revision: number; tabs?: Record<string, number> };
export const tabZoomKey = (id: string) => id.startsWith('git-diff:') ? id.slice('git-diff:'.length).replace(/:[ab]$/, '') : id;

// Use one content range for every surface, including original-size media.
// Native Chromium targets still constrain the effective app × content factor.
export const MIN_TAB_ZOOM = 10;
export const MAX_TAB_ZOOM = 1000;
export type TabZoomChange = number | { scale: number } | { percent: number };
export function tabZoomPercent(previous: number, change: unknown): number | undefined {
  const clamp = (value: number) => Math.max(MIN_TAB_ZOOM, Math.min(MAX_TAB_ZOOM, value));
  if (change && typeof change === 'object') {
    if ('percent' in change) {
      return typeof change.percent === 'number' && Number.isFinite(change.percent)
        ? clamp(change.percent) : undefined;
    }
    if ('scale' in change && typeof change.scale === 'number' && Number.isFinite(change.scale)
      && change.scale >= .5 && change.scale <= 2) return clamp(previous * change.scale);
    return;
  }
  if (typeof change !== 'number' || !Number.isInteger(change) || Math.abs(change) > 4) return;
  return change === 0 ? 100 : clamp(Number((previous + change * 10).toFixed(10)));
}
