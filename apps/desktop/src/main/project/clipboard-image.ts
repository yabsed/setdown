/**
 * Image data on the OS clipboard (browser “Copy image”, a screenshot tool, an
 * image viewer) has no file behind it. Pasting it into a folder writes one.
 * Every candidate is checked against its signature: a clipboard owner may
 * advertise a format it cannot actually deliver.
 */
export type ClipboardImageFormat = { mime: string; extension: string; valid(bytes: Uint8Array): boolean };
export type ClipboardImage = { name: string; bytes: Uint8Array };

const ascii = (bytes: Uint8Array, start: number, text: string) => bytes.length >= start + text.length
  && [...text].every((character, index) => bytes[start + index] === character.charCodeAt(0));
const starts = (bytes: Uint8Array, ...signature: number[]) => bytes.length >= signature.length
  && signature.every((value, index) => bytes[index] === value);

/** PNG first: it is lossless, and a browser that also offers JPEG re-encoded both from the same pixels. */
const FORMATS: ClipboardImageFormat[] = [
  { mime: 'image/png', extension: '.png', valid: bytes => starts(bytes, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) },
  { mime: 'image/jpeg', extension: '.jpg', valid: bytes => starts(bytes, 0xff, 0xd8, 0xff) },
  { mime: 'image/webp', extension: '.webp', valid: bytes => ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP') },
  { mime: 'image/gif', extension: '.gif', valid: bytes => ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a') },
  { mime: 'image/avif', extension: '.avif', valid: bytes => ascii(bytes, 4, 'ftyp') && (ascii(bytes, 8, 'avif') || ascii(bytes, 8, 'avis')) },
  { mime: 'image/tiff', extension: '.tiff', valid: bytes => starts(bytes, 0x49, 0x49, 0x2a, 0x00) || starts(bytes, 0x4d, 0x4d, 0x00, 0x2a) },
  { mime: 'image/bmp', extension: '.bmp', valid: bytes => ascii(bytes, 0, 'BM') && bytes.length > 26 },
  { mime: 'image/svg+xml', extension: '.svg', valid: bytes => /<svg[\s>]/i.test(new TextDecoder().decode(bytes.subarray(0, 4096))) },
];
const ALIASES: Record<string, string> = { 'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg', 'image/x-png': 'image/png',
  'image/x-bmp': 'image/bmp', 'image/x-ms-bmp': 'image/bmp', 'image/tif': 'image/tiff' };

/** Electron names a format outside the web's standard set `electron application/osclipboard;format="image/jpeg"`. */
function mimeOf(type: string): string {
  const raw = /^electron application\/osclipboard;format="([^"]+)"$/i.exec(type)?.[1] ?? type;
  const mime = raw.split(';')[0].trim().toLowerCase();
  return ALIASES[mime] ?? mime;
}

/** Clipboard types that can carry an image, best first. */
export function imageCandidates(types: readonly string[]): { type: string; format: ClipboardImageFormat }[] {
  const found: { type: string; format: ClipboardImageFormat; order: number }[] = [];
  for (const type of types) {
    const order = FORMATS.findIndex(format => format.mime === mimeOf(type));
    // The standard name is Chromium's own conversion; prefer it to the raw one for the same format.
    if (order >= 0) found.push({ type, format: FORMATS[order], order: order * 2 + Number(type.startsWith('electron ')) });
  }
  return found.sort((a, b) => a.order - b.order).map(({ type, format }) => ({ type, format }));
}

const FALLBACK = 'Pasted image';
const NAMED = /\.(?:avif|bmp|gif|heic|heif|ico|jfif|jpe?g|png|svg|tiff?|webp)$/i;
const RESERVED = /^(?:con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * A browser copies `<img src="…">` beside the pixels. Its file name is a better
 * name than “Pasted image”, when it looks like one. The clipboard carries the
 * pixels re-encoded, so the extension always follows the bytes, never the URL.
 */
export function pastedImageName(extension: string, html = ''): string {
  return `${sourceStem(html) ?? FALLBACK}${extension}`;
}

function sourceStem(html: string): string | null {
  const tag = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(html);
  const source = (tag?.[1] ?? tag?.[2] ?? tag?.[3] ?? '').replace(/&amp;/gi, '&').trim();
  if (!source) return null;
  let file: string;
  try {
    const url = new URL(source);
    if (!['http:', 'https:', 'file:'].includes(url.protocol)) return null;
    const last = url.pathname.split('/').pop() ?? '';
    try { file = decodeURIComponent(last); } catch { file = last; }
  } catch { return null; }
  if (!NAMED.test(file)) return null;
  let stem = file.replace(NAMED, '').normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '');
  // Leave room for a sequence number and the extension inside one 255-byte name.
  while (Buffer.byteLength(stem) > 180) stem = [...stem].slice(0, -1).join('').trimEnd();
  return stem && !RESERVED.test(stem) ? stem : null;
}
