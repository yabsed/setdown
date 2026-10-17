import { flushSync } from 'svelte';
import { createImageEditor } from '../../vendor/svelte-chop-chop/src/lib/composables/create-image-editor.svelte';
import { createCropEngine } from '../../vendor/svelte-chop-chop/src/lib/core/crop-engine.svelte';
import { exportImage } from '../../vendor/svelte-chop-chop/src/lib/core/export';
import { StaticCanvas, FabricImage, Canvas2dFilterBackend, setFilterBackend, filters } from '@fabricjs/browser';

// Research probes call the pinned upstream implementations without patching them.
export async function runCases() {
  const source = document.createElement('canvas');
  source.width = 80; source.height = 40;
  const sourceContext = source.getContext('2d')!;
  sourceContext.fillStyle = '#ff0000'; sourceContext.fillRect(0, 0, 40, 40);
  sourceContext.fillStyle = '#00ff00'; sourceContext.fillRect(40, 0, 40, 40);
  const image = new Image(); image.src = source.toDataURL(); await image.decode();
  const loaded = { element: image, naturalWidth: 80, naturalHeight: 40, exifOrientation: 1, objectURL: null };
  const crop = { pixels: { x: 0, y: 0, width: 80, height: 40 },
    normalized: { x: 0, y: 0, width: 1, height: 1 }, viewport: { x: 0, y: 0, width: 80, height: 40 } };
  const transforms = { rotation: 90, flipX: false, flipY: false, zoom: 1, pan: { x: 0, y: 0 } };
  const rotated = await exportImage(loaded, crop, transforms, { format: 'image/png' });
  function pixels(canvas: HTMLCanvasElement) {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] === 255) opaque++;
    return { width: canvas.width, height: canvas.height, opaquePixels: opaque };
  }
  let editor: ReturnType<typeof createImageEditor>;
  let engine: ReturnType<typeof createCropEngine>;
  const disposeRoot = $effect.root(() => {
    editor = createImageEditor({ initialCropScale: 1 });
    engine = createCropEngine();
  });
  await editor!.loadImage(image);
  flushSync();
  const initialDirty = editor!.dirty;
  editor!.rotate(90); editor!.rotate(90); flushSync();
  const beforeUndo = editor!.transforms.rotation;
  editor!.undo(); flushSync(); const afterUndo = editor!.transforms.rotation;
  editor!.redo(); flushSync(); const afterRedo = editor!.transforms.rotation;
  engine!.setImageSize({ width: 800, height: 400 });
  engine!.setContainerSize({ width: 200, height: 100 });
  engine!.setCrop({ x: 50, y: 25, width: 100, height: 50 });
  const cropBeforeResize = { ...engine!.coordinates.pixels };
  engine!.setContainerSize({ width: 400, height: 200 });
  const cropAfterResize = { ...engine!.coordinates.pixels };
  const beforeKey = editor!.transforms.rotation;
  const key = new KeyboardEvent('keydown', { key: 'r', isComposing: true, bubbles: true, cancelable: true });
  const input = document.createElement('input'); document.body.append(input);
  input.addEventListener('keydown', editor!.handleKeyboard); input.dispatchEvent(key);
  const composingShortcut = { before: beforeKey, after: editor!.transforms.rotation, defaultPrevented: key.defaultPrevented };
  input.remove(); editor!.destroy(); disposeRoot();

  let tuneEditor: ReturnType<typeof createImageEditor>;
  const disposeTune = $effect.root(() => { tuneEditor = createImageEditor({ initialCropScale: 1 }); });
  await tuneEditor!.loadImage(image); tuneEditor!.setFinetune('brightness', 50); flushSync();
  const tuneBefore = { brightness: tuneEditor!.filters.brightness, canUndo: tuneEditor!.canUndo };
  tuneEditor!.undo(); flushSync();
  const tuneAfter = { brightness: tuneEditor!.filters.brightness, canUndo: tuneEditor!.canUndo };
  tuneEditor!.destroy(); disposeTune();

  // Explicit Canvas2D backend: this probe makes no GPU or large-image claim.
  setFilterBackend(new Canvas2dFilterBackend());
  const canvas = new StaticCanvas(document.createElement('canvas'), {
    width: 80, height: 40, enableRetinaScaling: false, renderOnAddRemove: false,
  });
  canvas.add(new FabricImage(source, { left: 0, top: 0, originX: 'left', originY: 'top' }));
  canvas.setZoom(0.5);
  const zoomed = pixels(canvas.toCanvasElement());
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  const canonical = pixels(canvas.toCanvasElement());
  const blob = await canvas.toBlob({ format: 'png', multiplier: 1, enableRetinaScaling: false });
  const bitmap = await createImageBitmap(blob!);
  const encodedDimensions = { width: bitmap.width, height: bitmap.height, mime: blob!.type };
  bitmap.close(); await canvas.dispose();

  const filterCanvas = document.createElement('canvas'); filterCanvas.width = 1; filterCanvas.height = 1;
  const filterContext = filterCanvas.getContext('2d')!;
  filterContext.fillStyle = 'rgb(100,100,100)'; filterContext.fillRect(0, 0, 1, 1);
  const filtered = new FabricImage(filterCanvas);
  filtered.filters = [new filters.Brightness({ brightness: 0.1 })]; filtered.applyFilters();
  const output = document.createElement('canvas'); output.width = 1; output.height = 1;
  output.getContext('2d')!.drawImage(filtered.getElement(), 0, 0);
  const filterPixel = [...output.getContext('2d')!.getImageData(0, 0, 1, 1).data];
  filtered.dispose();

  return {
    svelte: {
      rotateExport: { input: { width: 80, height: 40 }, rotation: 90,
        expected: { width: 40, height: 80, opaquePixels: 3200 }, actual: pixels(rotated.canvas!) },
      rotationHistory: { beforeUndo, afterUndo, afterRedo, expected: [180, 90, 180] },
      initialDirty, finetuneHistory: { before: tuneBefore, after: tuneAfter },
      resizeCrop: { before: cropBeforeResize, after: cropAfterResize }, composingShortcut,
    },
    fabric: { backend: 'Canvas2D', zoomed, canonical, encodedDimensions, filterPixel },
    artifacts: { source: source.toDataURL(), svelteRotated: rotated.canvas!.toDataURL() },
  };
}
