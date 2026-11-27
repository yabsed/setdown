// What both spike pages share: errors of the page, bytes in and out, and a summary of any value that is safe to send to the driver.
export const errors: string[] = [];
window.addEventListener('error', event => errors.push(`error: ${event.message}`));
window.addEventListener('unhandledrejection', event => errors.push(`rejection: ${String((event.reason as Error | undefined)?.message ?? event.reason)}`));
for (const level of ['error', 'warn'] as const) {
  const original = console[level].bind(console);
  console[level] = (...values: unknown[]) => { errors.push(`${level}: ${values.map(value => value instanceof Error ? value.message : typeof value === 'string' ? value : JSON.stringify(plain(value))).join(' ').slice(0, 400)}`); original(...values); };
}
export const fromBase64 = (text: string) => Uint8Array.from(atob(text), character => character.charCodeAt(0));
export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}
export function plain(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return typeof value === 'string' && value.length > 300 ? `${value.slice(0, 300)}…` : value;
  if (value === undefined) return undefined;
  if (typeof value === 'function') return '[function]';
  if (typeof value !== 'object') return String(value);
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return `[${(value as ArrayBuffer).byteLength} bytes]`;
  if (value instanceof Node) return `[${value.nodeName}]`;
  if (depth > 4) return '[…]';
  if (Array.isArray(value)) return value.length > 12 ? [...value.slice(0, 12).map(item => plain(item, depth + 1)), `… ${value.length} items`] : value.map(item => plain(item, depth + 1));
  if (value instanceof Map) return plain(Object.fromEntries([...value].slice(0, 20)), depth);
  if (value instanceof Set) return plain([...value], depth);
  const entries = Object.entries(value as Record<string, unknown>);
  return Object.fromEntries(entries.slice(0, 40).map(([key, item]) => [key, plain(item, depth + 1)]));
}
export const frames = (count = 2) => new Promise<void>(resolve => { const step = (left: number) => left ? requestAnimationFrame(() => step(left - 1)) : resolve(); step(count); });
export const heapMiB = () => Math.round(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576);
