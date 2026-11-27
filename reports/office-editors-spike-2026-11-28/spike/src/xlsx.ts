import '@xlsx-editor.dev/core/styles/editor.css';
import * as engine from '@xlsx-editor.dev/core/editor';
import { errors, frames, fromBase64, heapMiB, plain, toBase64 } from './shared';

// The free engine alone, mounted the way its own README shows for a host without React or Vue.
const stage = document.getElementById('stage')!;
let editor: any = null;
const api = {
  errors,
  exports: () => Object.keys(engine).length,
  async open(base64: string, options: Record<string, unknown> = {}) {
    editor?.destroy(); stage.replaceChildren();
    const host = document.createElement('div');
    host.className = 'xlsx-editor'; host.style.cssText = 'position:absolute;inset:0';
    stage.append(host);
    const bytes = fromBase64(base64), started = performance.now();
    let failure: string | null = null, result: unknown;
    try {
      // Fonts the host read from the machine, added to the packaged substitutes: this engine takes all faces at once.
      const { faces, files, ...rest } = options as { faces?: Array<{ family: string; bold: boolean; italic: boolean; file: number }>; files?: string[] };
      let fonts: unknown;
      if (faces) {
        const bytes = (files ?? []).map(fromBase64);
        fonts = async () => [...(await (engine as never as { loadSubstituteFonts(): Promise<{ sources: unknown[] }> }).loadSubstituteFonts()).sources,
          ...faces.map(face => ({ family: face.family, bold: face.bold, italic: face.italic, bytes: bytes[face.file], origin: 'host' }))];
      }
      editor = engine.createXlsxEditor({ ...(fonts ? { fonts } : {}), ...rest } as never);
      editor.attach(host);
      result = await editor.load(bytes);
    } catch (error) { failure = String((error as Error)?.message ?? error); }
    const loaded = performance.now();
    await frames(3);
    return { ms: Math.round(loaded - started), paintedMs: Math.round(performance.now() - started), failure, result: plain(result), heapMiB: heapMiB(), ...api.state() };
  },
  state() {
    return { count: editor?.snapshot?.()?.sheets?.length ?? null, snapshot: plain(editor?.snapshot?.()), fonts: plain(editor?.fontReport?.()), canvases: stage.querySelectorAll('canvas').length, inputs: stage.querySelectorAll('textarea').length };
  },
  keys: () => editor ? Object.keys(editor).concat(Object.getOwnPropertyNames(Object.getPrototypeOf(editor) ?? {})) : [],
  call: (method: string, ...values: unknown[]) => plain(editor[method](...values)),
  save: () => { const started = performance.now(), bytes = editor.save() as Uint8Array | null; return bytes ? { ms: Math.round(performance.now() - started), base64: toBase64(bytes) } : null; },
};
(window as unknown as { spike: typeof api }).spike = api;
