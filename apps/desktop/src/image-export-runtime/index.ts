import { renderImage } from '../image-runtime/fabric-adapter';
import type { ImageRecipe } from '../core/image/image-recipe';
declare global {
  interface Window { imageExport: { job(): Promise<{ bytes: Uint8Array; width: number; height: number; recipe: ImageRecipe }>;
    finish(bytes: Uint8Array | null, error?: string): void } }
}
void (async () => {
  let source: ImageBitmap | undefined;
  try {
    const job = await window.imageExport.job();
    source = await createImageBitmap(new Blob([new Uint8Array(job.bytes)]));
    if (source.width !== job.width || source.height !== job.height) throw Error('The decoded image dimensions do not match the source.');
    const blob = await renderImage(source, job.width, job.height, job.recipe);
    window.imageExport.finish(new Uint8Array(await blob.arrayBuffer()));
  } catch (error) { window.imageExport.finish(null, String(error)); }
  finally { source?.close(); }
})();
