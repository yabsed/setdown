import type { DiskVersion, DocumentSnapshot } from '../core/document/document';
import type { ImageFormat, ImageRecipe } from '../core/image/image-recipe';
import type { SaveResult } from './desktop-api';

export type ImageSource = { id: string; width: number; height: number; format: ImageFormat; preview: Uint8Array };
export type ImageSaveRequest = { sourceId: string; document: DocumentSnapshot; recipe: ImageRecipe; revision: number; saveAs: boolean };
export type ImageEditApi = {
  backup?(sourceId: string): Promise<Uint8Array>;
  open(path: string, version: DiskVersion): Promise<ImageSource>;
  render(sourceId: string, recipe: ImageRecipe): Promise<Uint8Array>;
  release(sourceId: string): void;
  save(request: ImageSaveRequest): Promise<SaveResult>;
};
