import '@docx-editor.dev/core/styles/editor.css';
import { CHROME_GROUPS, composeFontOrigins, createDocxEditor, createFontSource, defineFontResolver, runToolbarCommand, toolbarCommandState,
  type ChromeSlotId, type DocxEditorInstance, type FontOrigin, type FontSource, type TextMatch } from '@docx-editor.dev/core';
import { packagedFonts } from '@docx-editor.dev/fonts';
import { cjkFonts, NOTO_SANS_CJK_JP_FAMILY } from '@docx-editor.dev/fonts-cjk/browser';
import type { DocxEditApi } from '../../protocol/docx-edit';
import { installedFontSupply, koreanLastResort } from '../office-edit/font-supply';
import type { DocxControlId, DocxEngine, DocxFind, DocxLink, DocxMode, DocxView } from './docx-engine';

/**
 * The only module that touches eigenpal/docx-editor. It loads on the first Word
 * document, so startup and every other surface stay free of the engine, its
 * HarfBuzz shaper and its fonts. No engine type reaches the workspace model.
 *
 * Only the Apache-2.0 packages are used: `core` (parse, layout, paint, save),
 * `fonts` (metric-compatible substitutes for the Latin Word fonts) and `fonts-cjk`
 * (one pan-CJK face), all served from this application's own assets. No font or
 * document byte is ever requested from another origin.
 */
const FIND_HIGHLIGHT = 'setdown-find';
const ICONS = new Map<string, readonly string[]>(CHROME_GROUPS.flatMap(group =>
  group.controls.map(control => [`${group.id}.${control.id}`, control.paths ?? []] as const)));
const FAILURES: Record<string, string> = {
  damaged: 'The file is damaged and cannot be opened.',
  'not-docx': 'The file is not a Word (.docx) document.',
  'too-large': 'The document is too large to open.',
  blocked: 'The document was blocked because its content is unsafe to open.',
  unknown: 'The document could not be opened.',
};
const message = (error: unknown): string => error instanceof Error ? error.message : typeof error === 'string' ? error : FAILURES.unknown;

/**
 * The engine measures and paints text from font bytes. With none for a family it estimates the
 * widths and leaves the glyphs to whatever face the browser picks, which is what made Korean text
 * sit unevenly. So fonts are offered in this order, first answer wins:
 *
 * 1. the fonts installed on this machine, read by main: the document's own families where they
 *    exist, and a Korean face of the same class where a Korean family is missing;
 * 2. the packaged metric-compatible substitutes for the Latin Word fonts;
 * 3. the packaged pan-CJK face, for East Asian text nothing above covers.
 */
type FontSupply = DocxEditApi['fonts'];
/** How often a document that is still waiting for its fonts is asked again, and when it is shown regardless. */
const FONT_SETTLE_POLL_MS = 40, FONT_SETTLE_LIMIT_MS = 8000;

export function openDocx(bytes: Uint8Array, options: { mode: DocxMode; fonts?: FontSupply }): DocxEngine {
  const changed = new Set<() => void>(), edited = new Set<() => void>(), links = new Set<(link: DocxLink) => void>();
  let mode = options.mode, appearance: 'light' | 'dark' = 'light';
  let viewport: HTMLElement | null = null, owner: HTMLElement | null = null;
  let failure: string | null = null;
  let frame = 0, destroyed = false;
  // Whether the document has been laid out in its own fonts once, and the timer that asks again while it has not.
  let settled = false, fontCheck = 0, fontDeadline = 0;
  let query = '', matches: readonly TextMatch[] = [], active = -1;

  const installed = options.fonts && defineFontResolver(installedFontSupply<FontSource>(options.fonts, (bytes, face) => createFontSource(bytes, face)));
  // Last of all the packaged pan-CJK face. For Korean families it keeps Word's line box, as an installed stand-in does.
  const cjk = cjkFonts();
  const packagedCjk = defineFontResolver(koreanLastResort<FontSource>(request => cjk(request), { family: NOTO_SANS_CJK_JP_FAMILY, weight: 400, style: 'normal' }));
  const origins: FontOrigin[] = [...(installed ? [installed] : []), packagedFonts(), packagedCjk];
  // A view of the IPC buffer may not start at offset 0; the engine keeps what it is given.
  const editor: DocxEditorInstance = createDocxEditor({ document: bytes.slice(), mode: mode === 'edit' ? 'edit' : 'view',
    fonts: request => composeFontOrigins(origins, request), locale: 'en-US',
    // A missing face only changes line breaks; the document still opens with canvas measurement.
    onFontError: error => console.warn('DOCX font unavailable:', error.code, error.request?.family ?? '') });

  // A listener that throws must never unwind into the engine while it commits and paints.
  const emit = <T>(listeners: Iterable<(value: T) => void>, value: T) => {
    for (const listener of [...listeners]) try { listener(value); } catch (error) { console.error('DOCX listener failed:', error); }
  };
  const notify = () => {
    if (destroyed || frame) return;
    const schedule = viewport?.ownerDocument.defaultView?.requestAnimationFrame ?? ((callback: FrameRequestCallback) => window.setTimeout(callback, 16));
    frame = schedule(() => { frame = 0; if (!destroyed) emit(changed, undefined); });
  };
  /**
   * Fonts arrive after the document is parsed. Until then the engine lays text out from estimated widths, and
   * moves every line when they land. The engine announces no event for that, so it is asked until it settles.
   * A font that never arrives must not keep the document closed.
   */
  const fontsSettled = () => {
    if (settled) return true;
    const now = performance.now();
    fontDeadline ||= now + FONT_SETTLE_LIMIT_MS;
    if (!editor.fontMeasurement().resolving || now >= fontDeadline) { settled = true; return true; }
    fontCheck ||= window.setTimeout(() => { fontCheck = 0; notify(); }, FONT_SETTLE_POLL_MS);
    return false;
  };
  const paintFind = () => {
    if (!matches.length) { editor.clearHighlights(FIND_HIGHLIGHT); return; }
    editor.setHighlights(FIND_HIGHLIGHT, matches.map(match => ({ blockId: match.blockId, start: match.start, length: match.length,
      ...(match.scope ? { scope: match.scope } : {}) })), active >= 0 ? { activeIndex: active } : {});
  };
  const search = (keep: boolean) => {
    matches = query ? editor.findMatches(query) : [];
    active = matches.length ? Math.min(Math.max(keep ? active : 0, 0), matches.length - 1) : -1;
    paintFind();
  };
  const reveal = (): DocxFind => {
    const match = matches[active];
    if (match) { editor.selectMatch(match); editor.scrollToBlock(match.blockId); paintFind(); }
    return { count: matches.length, index: active };
  };
  const unsubscribe = [
    editor.on('change', change => {
      // Opening, refreshing and recovery replace content without the reader editing anything.
      if (!change.source) { emit(edited, undefined); if (query) search(true); }
      notify();
    }),
    editor.on('selectionChange', notify),
    // Refused commands and font problems are reported here too; none of them closes the document.
    // A file that cannot be opened is reported by the snapshot instead.
    editor.on('error', error => { console.warn('DOCX editor:', error.code ?? '', error.message); notify(); }),
    editor.setHyperlinkChrome({ onPopover: ({ link, rect }) => {
      if (link.kind !== 'external' || !link.href) return;
      emit(links, { href: link.href, left: rect.left, top: rect.top, bottom: rect.bottom });
    } }),
  ];

  return {
    mount(host, mountOptions) {
      const document = host.ownerDocument;
      viewport?.remove();
      viewport = document.createElement('div');
      // The engine's stylesheet scopes every rule to `.docx-editor`; these are its load-bearing scroll classes.
      viewport.className = 'docx-editor docx-editor-one-surface docx-editor-one-surface__viewport docx-editor__scroll-container';
      viewport.classList.toggle('dark', appearance === 'dark');
      viewport.tabIndex = 0; viewport.setAttribute('role', 'region'); viewport.setAttribute('aria-label', 'Document pages');
      const mountPoint = document.createElement('div'); mountPoint.className = 'docx-content-mount';
      const surface = document.createElement('div'); surface.className = 'docx-paginated-surface';
      const dialogs = document.createElement('div'); dialogs.className = 'docx-dialog-mount';
      mountPoint.append(surface, dialogs); viewport.append(mountPoint); host.replaceChildren(viewport);
      owner = host;
      if (editor.getZoomMode().type === 'fit') viewport.dataset.zoomFit = '';
      try { editor.attach(surface, mountOptions?.focus === undefined ? undefined : { focus: mountOptions.focus }); }
      catch (error) { failure ??= message(error); }
      if (query) search(true);
      notify();
      return viewport;
    },
    unmount(host) {
      if (host && host !== owner) return;
      owner = null;
      if (frame) { (viewport?.ownerDocument.defaultView ?? window).cancelAnimationFrame(frame); frame = 0; }
      window.clearTimeout(fontCheck); fontCheck = 0;
      editor.detach(); viewport?.remove(); viewport = null;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.clearTimeout(fontCheck); fontCheck = 0;
      for (const stop of unsubscribe) stop();
      changed.clear(); edited.clear(); links.clear();
      editor.destroy(); viewport?.remove(); viewport = null; owner = null;
    },
    mounted: () => !!viewport,
    view(): DocxView {
      const snapshot = editor.snapshot(), formatting = editor.getSelectionFormatting();
      const error = failure ?? snapshot.parseError ?? (snapshot.openFailure ? FAILURES[snapshot.openFailure.reason] ?? FAILURES.unknown : null);
      // Shown once, in its final layout. A font that arrives later, for text typed in a new family, never hides it again.
      const open = !!viewport && !snapshot.isLoading && !error && snapshot.page.total > 0;
      return { ready: open && fontsSettled(), error, mode,
        page: snapshot.page.current, pages: snapshot.page.total,
        canUndo: snapshot.canUndo === true, canRedo: snapshot.canRedo === true,
        fontSize: formatting?.fontSizeHalfPoints ? formatting.fontSizeHalfPoints / 2 : null, styleId: formatting?.styleId ?? null };
    },
    subscribe(listener) { changed.add(listener); return () => { changed.delete(listener); }; },
    onEdit(listener) { edited.add(listener); return () => { edited.delete(listener); }; },
    onLink(listener) { links.add(listener); return () => { links.delete(listener); }; },
    setMode(next) { if (next === mode) return; mode = next; editor.setMode(next === 'edit' ? 'edit' : 'view'); notify(); },
    setAppearance(next) { appearance = next; viewport?.classList.toggle('dark', next === 'dark'); },
    control(id) {
      const state = toolbarCommandState(editor, id as ChromeSlotId);
      return { enabled: mode === 'edit' && state.enabled, active: state.active, ...(state.value === undefined ? {} : { value: state.value }) };
    },
    run(id: DocxControlId, value?: string | number) {
      if (mode !== 'edit') return false;
      // The engine takes run sizes in half-points; the toolbar speaks points.
      const result = id === 'font.size' ? runToolbarCommand(editor, id, Math.round(Number(value) * 2))
        : id === 'styles.style' ? runToolbarCommand(editor, id, String(value))
        : runToolbarCommand(editor, id as ChromeSlotId);
      notify();
      return result.ok;
    },
    icon: id => ICONS.get(id) ?? [],
    styles: () => editor.getDocumentStyles().filter(style => style.type === 'paragraph').map(style => ({ id: style.styleId, name: style.name })),
    insertTable(rows, columns) {
      if (mode !== 'edit') return false;
      const result = editor.exec({ type: 'insertTable', rows, cols: columns });
      notify();
      return result.ok;
    },
    async serialize() { return new Uint8Array(await editor.save()); },
    find(next) { query = next; search(false); return reveal(); },
    findStep(direction) {
      if (matches.length) active = (active + direction + matches.length) % matches.length;
      return reveal();
    },
    clearFind() { query = ''; matches = []; active = -1; editor.clearHighlights(FIND_HIGHLIGHT); },
    scale: () => editor.getZoom(),
    setScale(scale) {
      if (scale === 'fit') { editor.setZoomMode('auto'); if (viewport) viewport.dataset.zoomFit = ''; }
      else { editor.setZoom(Math.min(5, Math.max(.1, scale))); delete viewport?.dataset.zoomFit; }
      notify();
    },
    focus() { editor.focus(); },
  };
}
