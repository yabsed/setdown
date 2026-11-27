import '@pptx-editor.dev/core/styles/editor.css';
import * as engine from '@pptx-editor.dev/core/editor';
import { packagedFonts } from '@docx-editor.dev/fonts';
import { errors, frames, fromBase64, heapMiB, plain, toBase64 } from './shared';

// The free engine alone, mounted the way its own documentation shows for a host without React or Vue.
const stage = document.getElementById('stage')!;
let editor: any = null, fontErrors: unknown[] = [];
const api = {
  errors,
  exports: () => Object.keys(engine).length,
  async open(base64: string, options: Record<string, unknown> = {}) {
    editor?.destroy(); stage.replaceChildren(); fontErrors = [];
    const host = document.createElement('div');
    host.className = 'pptx-editor'; host.style.cssText = 'position:absolute;inset:0';
    stage.append(host);
    const bytes = fromBase64(base64), started = performance.now();
    let failure: string | null = null, result: unknown;
    try {
      // Fonts the host read from the machine, offered before the packaged substitutes: the way Setdown feeds its Word editor.
      const { faces, files, substitutions, ...rest } = options as { faces?: Array<{ family: string; weight: number; style: string; file: number; faceIndex?: number }>; files?: string[]; substitutions?: unknown[] };
      let fonts: unknown;
      if (faces) {
        const bytes = (files ?? []).map(fromBase64), sources: unknown[] = [];
        for (const face of faces) {
          const made = engine.createFontSource(bytes[face.file], { family: face.family, weight: face.weight, style: face.style, faceIndex: face.faceIndex ?? 0 } as never) as { source?: unknown; failure?: unknown };
          if (made.source) sources.push(made.source); else fontErrors.push({ refused: face.family, failure: plain(made.failure) });
        }
        const installed = engine.defineFontResolver((async () => ({ sources, substitutions: substitutions ?? [] })) as never);
        fonts = (request: never) => engine.composeFontOrigins([installed, packagedFonts() as never], request);
      }
      editor = engine.createPptxEditor({ zoom: 'fit', onFontError: (error: unknown) => fontErrors.push(plain(error)), ...(fonts ? { fonts } : {}), ...rest } as never);
      editor.attach(host);
      result = await editor.load(bytes);
    } catch (error) { failure = String((error as Error)?.message ?? error); }
    const loaded = performance.now();
    await frames(3);
    return { ms: Math.round(loaded - started), paintedMs: Math.round(performance.now() - started), failure, result: plain(result), heapMiB: heapMiB(), ...api.state() };
  },
  state() {
    const snapshot = editor?.snapshot?.();
    return { count: snapshot?.slides?.length ?? null, snapshot: plain(snapshot), fontErrors, fonts: plain(editor?.fontMeasurement?.()), svgs: stage.querySelectorAll('svg').length, texts: stage.querySelectorAll('svg text, svg tspan').length,
      images: stage.querySelectorAll('svg image').length, inputs: stage.querySelectorAll('textarea').length };
  },
  keys: () => editor ? Object.keys(editor).concat(Object.getOwnPropertyNames(Object.getPrototypeOf(editor) ?? {})) : [],
  call: (method: string, ...values: unknown[]) => plain(editor[method](...values)),
  /** Shows one slide and answers where it is painted. */
  async slide(index: number) {
    editor.goToSlide(index);
    await frames(3);
    const drawn = [...stage.querySelectorAll('svg')].map(node => ({ node, rect: node.getBoundingClientRect() })).sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];
    if (!drawn) return null;
    const { rect, node } = drawn;
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height, texts: node.querySelectorAll('text').length, images: node.querySelectorAll('image').length,
      families: [...new Set([...node.querySelectorAll('text')].map(item => getComputedStyle(item).fontFamily))].slice(0, 8), resolving: editor.fontMeasurement?.().resolving };
  },
  can: (command: unknown) => plain(editor.can(command)),
  exec: (command: unknown) => plain(editor.exec(command)),
  save: () => { const started = performance.now(), bytes = editor.save() as Uint8Array | null; return bytes ? { ms: Math.round(performance.now() - started), base64: toBase64(bytes) } : null; },
  text: () => [...stage.querySelectorAll('svg text')].map(node => node.textContent ?? '').filter(Boolean).slice(0, 80),
};
(window as unknown as { spike: typeof api }).spike = api;
