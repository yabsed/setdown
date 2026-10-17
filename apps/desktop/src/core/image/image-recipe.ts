/** All coordinates are upright source pixels, after quarter turns and flips.
 * Display scale/DPR never enters this model. */
export type ImageFormat = 'png' | 'jpeg' | 'webp';
export type ImageRecipe = {
  turns: number; flipX: boolean; flipY: boolean;
  crop: { x: number; y: number; width: number; height: number };
  width: number; height: number;
  brightness: number; contrast: number; saturation: number;
  format: ImageFormat; quality: number;
};
export const MAX_EDIT_PIXELS = 24_000_000;
export const MAX_EDIT_EDGE = 8192;
export function initialRecipe(width: number, height: number, format: ImageFormat): ImageRecipe {
  return { turns: 0, flipX: false, flipY: false, crop: { x: 0, y: 0, width, height },
    width, height, brightness: 0, contrast: 0, saturation: 0, format, quality: .92 };
}
export function orientedSize(width: number, height: number, turns: number) {
  return turns % 2 ? { width: height, height: width } : { width, height };
}
export function rotateRecipe(recipe: ImageRecipe, sourceWidth: number, sourceHeight: number): ImageRecipe {
  const { height } = orientedSize(sourceWidth, sourceHeight, recipe.turns);
  const c = recipe.crop;
  return { ...recipe, turns: (recipe.turns + 1) % 4, flipX: recipe.flipY, flipY: recipe.flipX,
    crop: { x: height - c.y - c.height, y: c.x, width: c.height, height: c.width },
    width: recipe.height, height: recipe.width };
}
export function flipRecipe(recipe: ImageRecipe, axis: 'X' | 'Y', width: number, height: number): ImageRecipe {
  const size = orientedSize(width, height, recipe.turns), c = recipe.crop;
  return { ...recipe, [`flip${axis}`]: !recipe[`flip${axis}`], crop: axis === 'X'
    ? { ...c, x: size.width - c.x - c.width } : { ...c, y: size.height - c.y - c.height } };
}
export function validRecipe(value: unknown, sourceWidth: number, sourceHeight: number): value is ImageRecipe {
  if (!value || typeof value !== 'object') return false;
  const r = value as ImageRecipe, c = r.crop;
  if (![0, 1, 2, 3].includes(r.turns) || typeof r.flipX !== 'boolean' || typeof r.flipY !== 'boolean' || !c) return false;
  const size = orientedSize(sourceWidth, sourceHeight, r.turns);
  return [r.width, r.height, c.width, c.height].every(n => Number.isInteger(n) && n > 0 && n <= MAX_EDIT_EDGE)
    && [c.x, c.y].every(n => Number.isInteger(n) && n >= 0)
    && c.x + c.width <= size.width && c.y + c.height <= size.height
    && r.width * r.height <= MAX_EDIT_PIXELS
    && [r.brightness, r.contrast, r.saturation].every(n => Number.isFinite(n) && Math.abs(n) <= 1)
    && ['png', 'jpeg', 'webp'].includes(r.format) && Number.isFinite(r.quality) && r.quality >= .1 && r.quality <= 1;
}
export function recipeKey(r: ImageRecipe): string {
  return JSON.stringify([r.turns, r.flipX, r.flipY, r.crop.x, r.crop.y, r.crop.width, r.crop.height,
    r.width, r.height, r.brightness, r.contrast, r.saturation, r.format, r.format === 'png' ? null : r.quality]);
}

/** Small immutable recipes only; saved is a content checkpoint, not a history index. */
export class ImageHistory {
  private past: ImageRecipe[] = [];
  private future: ImageRecipe[] = [];
  private checkpoint: string;
  current: ImageRecipe;
  constructor(initial: ImageRecipe) { this.current = structuredClone(initial); this.checkpoint = recipeKey(initial); }
  get dirty() { return recipeKey(this.current) !== this.checkpoint; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  commit(recipe: ImageRecipe): boolean {
    if (recipeKey(recipe) === recipeKey(this.current)) return false;
    this.past.push(this.current); if (this.past.length > 100) this.past.shift();
    this.current = structuredClone(recipe); this.future = []; return true;
  }
  undo() { const r = this.past.pop(); if (r) { this.future.push(this.current); this.current = r; } return !!r; }
  redo() { const r = this.future.pop(); if (r) { this.past.push(this.current); this.current = r; } return !!r; }
  saved(recipe: ImageRecipe) { this.checkpoint = recipeKey(recipe); }
}
