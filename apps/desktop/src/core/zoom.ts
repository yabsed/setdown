/** App shortcuts are independent of the focused content's wheel zoom. */
export function appZoomStep(input: { type: string; isComposing?: boolean; control?: boolean;
  meta?: boolean; alt?: boolean; shift?: boolean; key: string }): number | undefined {
  if (input.type !== 'keyDown' || input.isComposing || !input.control || input.alt || input.meta) return;
  if (input.key === '+' || input.key === '=') return 1;
  if (input.key === '-' || input.key === '_') return -1;
  if (input.key === '0' && !input.shift) return 0;
}
export type ZoomSnapshot = { app: number; text: number; terminal: number; revision: number; tabs?: Record<string, number> };
export const tabZoomKey = (id: string) => /^git-diff:.*:[ab]$/.test(id) ? id.slice(0, -2) : id;
