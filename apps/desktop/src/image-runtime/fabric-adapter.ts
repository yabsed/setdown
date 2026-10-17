import { StaticCanvas, FabricImage, filters, Canvas2dFilterBackend, setFilterBackend } from 'fabric';
import type { ImageRecipe } from '../core/image/image-recipe';
import { orientedSize } from '../core/image/image-recipe';

// A deterministic backend shared by preview and export, including software-only
// Electron. Never depends on a GPU's texture-size limit or global DPR.
setFilterBackend(new Canvas2dFilterBackend());
export async function renderImage(source: ImageBitmap, sourceWidth: number, sourceHeight: number,
  recipe: ImageRecipe, maxEdge = Infinity): Promise<Blob> {
  const factor = Math.min(1, maxEdge / Math.max(recipe.width, recipe.height));
  const width = Math.max(1, Math.round(recipe.width * factor)), height = Math.max(1, Math.round(recipe.height * factor));
  const geometry = document.createElement('canvas'); geometry.width = width; geometry.height = height;
  const ctx = geometry.getContext('2d')!;
  const size = orientedSize(sourceWidth, sourceHeight, recipe.turns), c = recipe.crop;
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(width / c.width, height / c.height); ctx.translate(-c.x, -c.y);
  ctx.translate(recipe.flipX ? size.width : 0, recipe.flipY ? size.height : 0);
  ctx.scale(recipe.flipX ? -1 : 1, recipe.flipY ? -1 : 1);
  if (recipe.turns === 1) ctx.translate(sourceHeight, 0);
  if (recipe.turns === 2) ctx.translate(sourceWidth, sourceHeight);
  if (recipe.turns === 3) ctx.translate(0, sourceWidth);
  ctx.rotate(recipe.turns * Math.PI / 2);
  ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight);
  const canvas = new StaticCanvas(document.createElement('canvas'), { width, height,
    enableRetinaScaling: false, renderOnAddRemove: false, backgroundColor: recipe.format === 'jpeg' ? '#ffffff' : '' });
  const object = new FabricImage(geometry, { left: 0, top: 0, originX: 'left', originY: 'top' });
  try {
    object.filters = [new filters.Brightness({ brightness: recipe.brightness }),
      new filters.Contrast({ contrast: recipe.contrast }), new filters.Saturation({ saturation: recipe.saturation })];
    object.applyFilters(); canvas.add(object); canvas.renderAll();
    const blob = await canvas.toBlob({ format: recipe.format, quality: recipe.quality, multiplier: 1, enableRetinaScaling: false });
    if (!blob || blob.type !== `image/${recipe.format}`) throw Error('This image format could not be encoded.');
    return blob;
  } finally { await canvas.dispose(); geometry.width = geometry.height = 0; }
}
