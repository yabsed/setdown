import { dialog } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { MAX_EDIT_EDGE, MAX_EDIT_PIXELS, validRecipe } from '../../core/image/image-recipe';
import type { ImageFormat } from '../../core/image/image-recipe';
import type { ImageSaveRequest, ImageSource } from '../../protocol/image-edit';
import type { DiskVersion, SaveResult } from '../../protocol/desktop-api';
import type { WindowIpc } from '../ipc/window-ipc';
import type { WindowState } from '../windows/window-state';
import type { DocumentManager } from './document-manager';
import { readImageBytes } from './image-file';
import { canonicalPath, sameDiskVersion } from './file-system';
import { exportImage } from './image-export-manager';
import { imageHash, imageVersion, writeImage } from './image-save';

type Source = { owner: number; path: string; bytes: Uint8Array; width: number; height: number; hash: string; version: DiskVersion; lifetime: AbortController };
const sources = new Map<string, Source>();
function release(id: string) { const source = sources.get(id); sources.delete(id); source?.lifetime.abort(); }
const targets = new Map<string, Promise<unknown>>();
const owned = (s: WindowState, file: string) => !s.window.isDestroyed() && (s.currentDocument?.path === file || s.rendererTabs.some(t => t.path === file && !t.isUntitled));
export function installImageEditIpc(channels: WindowIpc, documents: DocumentManager) {
  const watched = new Set<number>();
  channels.handle('image-edit:open', async (state, file: string, version: DiskVersion): Promise<ImageSource> => {
    if (typeof file !== 'string' || !owned(state, file) || !/\.(png|jpe?g|webp)$/i.test(file))
      throw Error('Editing supports open PNG, JPEG and static WebP images.');
    const bytes = await readImageBytes(canonicalPath(file), version);
    const metadata = await sharp(bytes, { limitInputPixels: MAX_EDIT_PIXELS }).metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1)
      throw Error('Animated images cannot be edited.');
    // APNG's animation control chunk is not reported as pages by every decoder.
    if (metadata.format === 'png') {
      const buffer = Buffer.from(bytes);
      for (let offset = 8; offset + 12 <= buffer.length;) {
        const length = buffer.readUInt32BE(offset);
        if (buffer.toString('ascii', offset + 4, offset + 8) === 'acTL') throw Error('Animated images cannot be edited.');
        offset += 12 + length;
      }
    }
    const swapped = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
    const width = (swapped ? metadata.height : metadata.width)!, height = (swapped ? metadata.width : metadata.height)!;
    if (!width || !height || Math.max(width, height) > MAX_EDIT_EDGE || width * height > MAX_EDIT_PIXELS)
      throw Error('Editing supports images up to 24 megapixels and 8192 pixels per side.');
    const preview = await sharp(bytes).autoOrient().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    if (!owned(state, file)) throw Error('The image is no longer open.');
    if ([...sources.values()].reduce((sum, s) => sum + s.bytes.length, bytes.length) > 256 * 1024 * 1024)
      throw Error('Close another edited image to free original-image memory.');
    const id = randomUUID(); sources.set(id, { owner: state.webContentsId, path: canonicalPath(file), bytes, width, height, hash: imageHash(bytes), version, lifetime: new AbortController() });
    if (!watched.has(state.webContentsId)) {
      watched.add(state.webContentsId);
      state.window.once('closed', () => { watched.delete(state.webContentsId); for (const [key, s] of sources) if (s.owner === state.webContentsId) release(key); });
    }
    return { id, width, height, format: metadata.format as ImageFormat, preview };
  });
  channels.handle('image-edit:backup', (state, id: string) => {
    const source = sources.get(id);
    if (!source || source.owner !== state.webContentsId) throw Error('The image is no longer open.');
    if (source.bytes.length > 18 * 1024 * 1024) throw Error('This image exceeds the recovery limit. Save a copy to protect your edits.');
    return source.bytes;
  });
  channels.handle('image-edit:render', async (state, id: string, recipe: unknown) => {
    const source = sources.get(id);
    if (!source || source.owner !== state.webContentsId || !validRecipe(recipe, source.width, source.height)) throw Error('Invalid image preview request.');
    return exportImage({ bytes: source.bytes, width: source.width, height: source.height, recipe }, source.lifetime.signal);
  });
  channels.on('image-edit:release', (state, id: string) => { if (sources.get(id)?.owner === state.webContentsId) release(id); });
  channels.handle('image-edit:save', async (state, request: ImageSaveRequest): Promise<SaveResult> => {
    const source = sources.get(request?.sourceId), doc = request?.document, recipe = request?.recipe;
    if (!source || source.owner !== state.webContentsId || !doc || doc.kind !== 'image' || !owned(state, doc.path)
      || !validRecipe(recipe, source.width, source.height) || !Number.isSafeInteger(request.revision) || request.revision < 0)
      throw Error('Invalid image save request.');
    const alive = () => sources.get(request.sourceId) === source && owned(state, doc.path);
    const extension = recipe.format === 'jpeg' ? 'jpg' : recipe.format;
    let target = doc.path;
    const matches = (file: string) => (recipe.format === 'jpeg' ? /\.jpe?g$/i : new RegExp(`\\.${recipe.format}$`, 'i')).test(file);
    if (request.saveAs || !matches(target)) {
      const result = await dialog.showSaveDialog(state.window, { title: 'Save image as',
        defaultPath: path.join(path.dirname(doc.path), `${path.parse(doc.path).name}.${extension}`),
        filters: [{ name: recipe.format.toUpperCase(), extensions: recipe.format === 'jpeg' ? ['jpg', 'jpeg'] : [extension] }] });
      if (result.canceled || !result.filePath) return { canceled: true };
      target = result.filePath;
      if (!path.extname(target)) target += `.${extension}`;
    }
    if (!matches(target)) throw Error('The filename extension must match the selected image format.');
    target = canonicalPath(target);
    if (target !== canonicalPath(doc.path) && state.rendererTabs.some(t => t.path === target))
      throw Error('Close the other tab for this destination before saving over it.');
    const task = (targets.get(target) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (!alive()) throw Error('The image is no longer open.');
      const expected = await imageVersion(target);
      if (target === canonicalPath(doc.path) && (!expected || expected.hash !== source.hash || (target === source.path && !sameDiskVersion(expected.version, source.version))))
        throw Error('This image changed on disk. Reload it or use Save As with a different filename.');
      const bytes = await exportImage({ bytes: source.bytes, width: source.width, height: source.height, recipe }, source.lifetime.signal);
      const metadata = await sharp(bytes, { limitInputPixels: MAX_EDIT_PIXELS }).metadata();
      if (metadata.format !== recipe.format || metadata.width !== recipe.width || metadata.height !== recipe.height)
        throw Error('The exported image did not match the requested format and dimensions.');
      const version = await writeImage(target, bytes, expected, alive);
      source.hash = imageHash(bytes); source.version = version; source.path = target;
      const saved = { ...doc, path: target, name: path.basename(target), diskVersion: version,
        revision: request.revision, savedRevision: request.revision, text: '', savedText: '', isUntitled: false };
      if (state.currentDocument?.path === doc.path) { state.currentDocument = saved; state.activeRoot = path.dirname(target); documents.watch(state); }
      return { canceled: false, document: saved };
    });
    targets.set(target, task);
    try { return await task; } finally { if (targets.get(target) === task) targets.delete(target); }
  });
}
