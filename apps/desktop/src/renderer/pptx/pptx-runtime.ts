import '@pptx-editor.dev/core/styles/editor.css';
import { CHROME_GROUPS, composeFontOrigins, createFontSource, createPptxEditor, defineFontResolver, runToolbarCommand, slideshowLinkAt, toolbarCommandState,
  type ChromeSlotId, type PptxEditorInstance } from '@pptx-editor.dev/core/editor';
import { packagedFonts } from '@docx-editor.dev/fonts';
import { cjkFonts, NOTO_SANS_CJK_JP_FAMILY } from '@docx-editor.dev/fonts-cjk/browser';
import { standaloneFontFace } from '../../core/fonts/font-collection';
import type { EngineOptions } from '../office-edit/edit-sessions';
import { installedFontSupply, koreanLastResort, type FontAnswer, type FontWish } from '../office-edit/font-supply';
import type { PptxControlId, PptxEngine, PptxFind, PptxMode, PptxView } from './pptx-engine';

/**
 * The only module that touches eigenpal/pptx-editor. It loads on the first presentation, so
 * startup and every other surface stay free of the engine, its HarfBuzz shaper and its fonts.
 * No engine type reaches the workspace model.
 *
 * Only the Apache-2.0 `core` package is used (parse, layout, paint, edit, save), with the
 * font packages the Word editor already ships. The engine draws slides as SVG; it needs no
 * element in the page to open a deck, to paint a slide into a box or to search, so the stage
 * (`mount`) is attached only while a slide is edited.
 */
type FontSource = Extract<ReturnType<typeof createFontSource>, { source: unknown }>['source'];
type FontOrigin = Parameters<typeof composeFontOrigins>[0][number];
type Resolver = Parameters<typeof defineFontResolver>[0];
const ICONS = new Map<string, readonly string[]>(CHROME_GROUPS.flatMap(group => group.controls.flatMap(control => [
  [`${group.id}.${control.id}`, control.paths ?? []] as const,
  ...(control.options ?? []).map(option => [`${group.id}.${control.id}=${option.value}`, option.paths ?? []] as const)])));
const FAILURES: Record<string, string> = {
  damaged: 'The file is damaged and cannot be opened.',
  'not-pptx': 'The file is not a PowerPoint (.pptx) presentation.',
  'too-large': 'The presentation is too large to open.',
  blocked: 'The presentation was blocked because its content is unsafe to open.',
  unknown: 'The presentation could not be opened.',
};
const message = (error: unknown): string => error instanceof Error ? error.message : typeof error === 'string' ? error : FAILURES.unknown;
/**
 * A face taken out of a collection, kept while the collection's bytes are: the four styles of a family, and every deck
 * that uses it, share one copy instead of each copying tens of megabytes of glyphs.
 */
const extracted = new WeakMap<Uint8Array, Map<number, Uint8Array | null>>();
function singleFace(file: Uint8Array, index: number): Uint8Array | null {
  let faces = extracted.get(file);
  if (!faces) extracted.set(file, faces = new Map());
  if (!faces.has(index)) faces.set(index, standaloneFontFace(file, index));
  return faces.get(index)!;
}
/** How often a deck that is still waiting for its fonts is asked again, and when it is shown regardless. */
const FONT_SETTLE_POLL_MS = 40, FONT_SETTLE_LIMIT_MS = 8000;

export function openPptx(bytes: Uint8Array, options: EngineOptions): PptxEngine {
  const changed = new Set<() => void>(), edited = new Set<() => void>();
  let mode: PptxMode = options.mode;
  // `owner` is the surface's stage element while a surface shows this deck; the engine is attached to it only while editing.
  let stage: HTMLElement | null = null, owner: HTMLElement | null = null;
  let failure: string | null = null;
  let frame = 0, destroyed = false;
  // Whether the deck has been laid out in its own fonts once, and the timer that asks again while it has not.
  let settled = false, fontCheck = 0, fontDeadline = 0;
  /** The document revision last seen: every committed change, undo and redo included, moves it. Null until the deck is open. */
  let revision: number | null = null;
  let query = '', found: PptxFind = { count: 0, index: -1, slide: -1 };

  // Fonts in the Word editor's order: installed faces, the packaged Latin substitutes, the packaged pan-CJK face.
  // The engine draws only the first face of a file, so a face inside a collection is handed over as a font of its own.
  // The engine spaces lines by PowerPoint's rule, 1.2 times the font size whatever the face, so a stand-in for a missing
  // Korean family moves no line; only the baseline inside the line follows the proportions of the face that draws.
  const installed = options.fonts && defineFontResolver(installedFontSupply<FontSource>(options.fonts, (file, face) => {
    const single = singleFace(file, face.faceIndex);
    return single ? createFontSource(single, { family: face.family, weight: face.weight, style: face.style })
      : { failure: { reason: 'collection', diagnostic: `face ${face.faceIndex} could not be read` } };
  }) as unknown as Resolver);
  const cjk = cjkFonts() as unknown as (wish: FontWish) => FontAnswer<FontSource> | undefined | Promise<FontAnswer<FontSource> | undefined>;
  const packagedCjk = defineFontResolver(koreanLastResort<FontSource>(cjk, { family: NOTO_SANS_CJK_JP_FAMILY, weight: 400, style: 'normal' }) as unknown as Resolver);
  const origins = [...(installed ? [installed] : []), packagedFonts(), packagedCjk] as unknown as FontOrigin[];
  // The stage always shows the whole slide in the element it is given; the surface sizes that element for the tab zoom.
  const editor: PptxEditorInstance = createPptxEditor({ mode, zoom: 'fit',
    fonts: (request => composeFontOrigins(origins, request)) as Resolver,
    // A missing face only changes line breaks; the deck still opens.
    onFontError: error => console.warn('PPTX font unavailable:', (error as { code?: string }).code ?? '', (error as { message?: string }).message ?? '') });

  // A listener that throws must never unwind into the engine while it commits and paints.
  const emit = (listeners: Iterable<() => void>) => {
    for (const listener of [...listeners]) try { listener(); } catch (error) { console.error('PPTX listener failed:', error); }
  };
  const notify = () => {
    if (destroyed || frame) return;
    frame = window.requestAnimationFrame(() => { frame = 0; if (!destroyed) emit(changed); });
  };
  /**
   * Fonts arrive after the deck is parsed, and text set in them moves when they land. The engine announces
   * no event for that, so it is asked until it settles. A font that never arrives must not keep the deck closed.
   * Two steps are waited for. The engine first gets the font files (`resolving`). In the same turn it hands their
   * faces to the browser, and only when the browser has loaded them does it lay the deck out again and draw with
   * them: a deck shown in between would show its Korean text as boxes for a moment.
   */
  const fontsSettled = () => {
    if (settled) return true;
    const now = performance.now();
    fontDeadline ||= now + FONT_SETTLE_LIMIT_MS;
    if (!(editor.fontMeasurement().resolving || document.fonts.status === 'loading') || now >= fontDeadline) { settled = true; return true; }
    fontCheck ||= window.setTimeout(() => { fontCheck = 0; notify(); }, FONT_SETTLE_POLL_MS);
    return false;
  };
  const stop = editor.subscribe(() => {
    const snapshot = editor.snapshot();
    if (snapshot.status === 'ready') {
      // Opening is not an edit; every later revision is one the reader made.
      if (revision === null) revision = snapshot.revision;
      else if (snapshot.revision !== revision) { revision = snapshot.revision; emit(edited); if (query) found = count(found.index); }
    }
    notify();
  });
  const count = (index: number): PptxFind => {
    const matches = query ? editor.find.matches(query) : [];
    const at = matches.length ? Math.min(Math.max(index, 0), matches.length - 1) : -1;
    return { count: matches.length, index: at, slide: at < 0 ? -1 : matches[at].slide };
  };
  const step = (direction: 1 | -1): PptxFind => {
    if (!query) return found = { count: 0, index: -1, slide: -1 };
    const result = direction > 0 ? editor.find.next(query) : editor.find.previous(query);
    found = result.ok && result.match ? { count: result.total, index: result.index, slide: result.match.slide } : { count: 0, index: -1, slide: -1 };
    notify();
    return found;
  };
  /** The stage exists exactly while a surface shows the deck for editing. Reading needs no engine element at all. */
  const place = () => {
    if (owner && mode === 'edit' && !stage) {
      stage = owner.ownerDocument.createElement('div');
      // The engine's stylesheet scopes every rule to `.pptx-editor`.
      stage.className = 'pptx-editor';
      owner.replaceChildren(stage);
      try { editor.attach(stage); } catch (error) { failure ??= message(error); }
    } else if (stage && !(owner && mode === 'edit')) { editor.detach(); stage.remove(); stage = null; }
  };
  /** The slide on the stage once its size holds for two frames: a stage that was just shown is fitted a frame later. */
  const settledSlide = async (): Promise<HTMLElement | null> => {
    let last = -1;
    for (let frame = 0; frame < 12 && !destroyed; frame += 1) {
      await new Promise(resolve => window.requestAnimationFrame(resolve));
      const slide = stage?.querySelector<HTMLElement>('.pptx-surface__stage'), width = slide?.getBoundingClientRect().width ?? 0;
      if (slide && width > 0 && width === last) return slide;
      last = width;
    }
    return null;
  };
  // A view of the IPC buffer may not start at offset 0; the engine keeps what it is given.
  void editor.load(bytes.slice()).then(result => { if (!result.ok) failure ??= FAILURES.unknown; }, error => { failure ??= message(error); }).finally(notify);

  return {
    mount(host) {
      if (owner !== host && stage) { editor.detach(); stage.remove(); stage = null; }
      owner = host; place(); notify();
    },
    unmount(host) {
      if (host && host !== owner) return;
      owner = null; place();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
      window.clearTimeout(fontCheck); fontCheck = 0;
      stop(); changed.clear(); edited.clear();
      editor.destroy(); stage?.remove(); stage = null; owner = null;
    },
    mounted: () => !!owner,
    view(): PptxView {
      const snapshot = editor.snapshot();
      const error = failure ?? (snapshot.openFailure ? FAILURES[snapshot.openFailure.reason] ?? FAILURES.unknown : snapshot.status === 'error' ? snapshot.error ?? FAILURES.unknown : null);
      const open = snapshot.status === 'ready' && !error && snapshot.slides.length > 0;
      return { ready: open && fontsSettled(), error, mode,
        slide: snapshot.currentSlide, slides: snapshot.slides.map(slide => ({ key: slide.id, hidden: slide.hidden })),
        aspect: snapshot.slideHeight > 0 ? snapshot.slideWidth / snapshot.slideHeight : 4 / 3,
        canUndo: snapshot.canUndo, canRedo: snapshot.canRedo, selection: snapshot.selection.kind === 'text' ? 'text' : snapshot.selection.kind === 'none' ? 'none' : 'shapes',
        fontSize: snapshot.format?.fontSize ?? null, align: snapshot.format?.align ?? null,
        damaged: snapshot.readOnlyReason === 'damaged-slide' };
    },
    subscribe(listener) { changed.add(listener); return () => { changed.delete(listener); }; },
    onEdit(listener) { edited.add(listener); return () => { edited.delete(listener); }; },
    setMode(next) { if (next === mode) return; mode = next; editor.setMode(next); place(); notify(); },
    control(id) {
      const state = toolbarCommandState(editor, id as ChromeSlotId);
      return { enabled: mode === 'edit' && state.enabled, active: state.active, ...(state.value === undefined ? {} : { value: state.value }) };
    },
    run(id: PptxControlId, value?: string | number) {
      if (mode !== 'edit') return false;
      const result = id === 'font.size' ? runToolbarCommand(editor, id, Number(value))
        : id === 'paragraph.align' ? runToolbarCommand(editor, id, String(value) as 'l' | 'ctr' | 'r' | 'just')
        : runToolbarCommand(editor, id as ChromeSlotId);
      notify();
      return result.ok;
    },
    icon: (id, value) => ICONS.get(value === undefined ? id : `${id}=${value}`) ?? [],
    goToSlide(index) { editor.goToSlide(index); notify(); },
    slide(action) {
      if (mode !== 'edit') return false;
      const index = editor.snapshot().currentSlide;
      const result = editor.exec(action === 'add' ? { type: 'addSlide' } : { type: action === 'duplicate' ? 'duplicateSlide' : 'deleteSlide', index });
      notify();
      return result.ok;
    },
    insert(what) {
      if (mode !== 'edit') return false;
      const result = what.kind === 'textBox' ? editor.exec({ type: 'insertTextBox' })
        : what.kind === 'shape' ? editor.exec({ type: 'insertShape', preset: what.preset })
        : what.kind === 'line' ? editor.exec({ type: 'insertLine', kind: what.line })
        : what.kind === 'table' ? editor.exec({ type: 'insertTable', rows: what.rows, cols: what.columns })
        : editor.exec({ type: 'insertImage', bytes: what.bytes, mime: what.mime, width: what.width, height: what.height });
      notify();
      return result.ok;
    },
    paint: (index, box) => editor.renderThumbnail(index, box, { defer: true }),
    linkAt(index, x, y) {
      const snapshot = editor.snapshot();
      return editor.session ? slideshowLinkAt(editor.session, index, x * snapshot.slideWidth, y * snapshot.slideHeight) : null;
    },
    async serialize() {
      const saved = editor.save();
      if (!saved) throw Error('This presentation cannot be saved because one of its slides could not be read.');
      return saved;
    },
    find(next) {
      query = next; found = count(0);
      if (!found.count) return found;
      // A search starts from the slide on the stage, not from where the last one left its selection.
      editor.setSelection({ kind: 'none' });
      return step(1);
    },
    findStep: direction => step(direction),
    clearFind() { query = ''; found = { count: 0, index: -1, slide: -1 }; },
    focus() { editor.focus(); },
    async press(x, y) {
      const slide = mode === 'edit' ? await settledSlide() : null;
      if (destroyed) return;
      if (slide) {
        const box = slide.getBoundingClientRect(), clientX = box.left + x * box.width, clientY = box.top + y * box.height;
        const target = slide.ownerDocument.elementFromPoint(clientX, clientY);
        // The engine has no call that places a caret from a point; it takes the press it listens for on its slide.
        if (target && slide.contains(target)) {
          const press = { bubbles: true, cancelable: true, composed: true, view: window, clientX, clientY, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };
          target.dispatchEvent(new PointerEvent('pointerdown', { ...press, buttons: 1 }));
          target.dispatchEvent(new PointerEvent('pointerup', { ...press, buttons: 0 }));
        }
      }
      // A press that the browser did not make moves no focus.
      editor.focus(); notify();
    },
  };
}
