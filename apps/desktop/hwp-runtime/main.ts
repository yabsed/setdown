import { WasmBridge } from '@/core/wasm-bridge';
import { EventBus } from '@/core/event-bus';
import { DocumentDirtyState } from '@/core/document-dirty-state';
import { CanvasView, Ruler } from '@hop/upstream/view';
import { InputHandler, CellSelectionRenderer, TableObjectRenderer, TableResizeRenderer } from '@hop/upstream/editor';
import { Toolbar } from '@/ui/toolbar';
import { MenuBar, ContextMenu, CommandPalette, initStyleToolbarOverflow } from '@hop/upstream/ui';
import { createCommandRuntime } from '@hop/host/command-runtime';
import { createRendererSession } from '@hop/host/renderer-session';
import { FONT_LIST } from '@hop/core/font-catalog';
import { enhanceCustomSelects } from '@hop/ui/custom-select';
import { initThemeSync } from '@/core/theme';
import { initToolbarLabels } from '@hop/host/toolbar-labels';

const host = window.setdownHwp;
const wasm = new WasmBridge();
const eventBus = new EventBus();
const documentState = new DocumentDirtyState(eventBus);
let canvasView: CanvasView | null = null;
let input: InputHandler | null = null;
let revision = 0, ready = false, composing = false, page = 0;
const position = () => ({ kind: 'hwp', page, zoom: canvasView?.getViewportManager().getZoom() ?? 1 });
const message = (value: string) => { document.getElementById('sb-message')!.textContent = value; };
const publish = () => host.state({ revision, ready, position: position() });
const runtime = createCommandRuntime({ wasm, eventBus, documentState, getInputHandler: () => input,
  getCanvasView: () => canvasView, setStatusMessage: message });
const { dispatcher, registry } = runtime;
const update = () => { if (!ready) return; revision++; documentState.markDirty('edit'); publish(); };
eventBus.on('document-changed', update);
eventBus.on('document-mutated', update);
document.addEventListener('compositionstart', () => { composing = true; }, true);
document.addEventListener('compositionend', () => { composing = false; }, true);
document.addEventListener('pointerdown', () => host.action('focus'), true);
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => event.preventDefault());
// File shortcuts belong to the host, including when a toolbar input owns focus.
document.addEventListener('keydown', event => {
  if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault(); event.stopImmediatePropagation(); host.action(event.shiftKey ? 'save-as' : 'save');
  }
}, true);
host.onExport(async ({ format }) => {
  try {
    if (!ready) throw Error('HWP 편집기가 아직 준비되지 않았습니다.');
    if (composing) throw Error('한글 입력 조합을 완료한 뒤 저장하세요.');
    input!.flushDeferredPaginationIfNeeded('setdown-save');
    // Report and bytes come from the very same engine export.
    const artifact = format === 'hwpx' ? wasm.exportHwpxWithReport() : wasm.exportHwpWithReport();
    return { artifact: { ...artifact, revision } };
  } catch (error) { return { error: String(error) }; }
});
host.onSaved(({ revision: saved, name }) => {
  wasm.fileName = name;
  if (saved === revision) documentState.markClean('saved');
  message(saved === revision ? `${name} — 저장됨` : `${name} — 저장 후 수정됨`);
});
host.onZoom(steps => { const zoom = canvasView?.getViewportManager(); if (zoom) zoom.setZoom(steps === 0 ? 1 : zoom.getZoom() + steps * .1); });
host.onCommand(command => {
  const target = document.activeElement;
  if (command !== 'find' && target instanceof HTMLElement && target.matches('input, textarea, [contenteditable="true"]')
    && target.getAttribute('aria-label') !== '문서 편집 입력') {
    document.execCommand(command === 'select-all' ? 'selectAll' : command); return;
  }
  dispatcher.dispatch(`edit:${command}`);
});
async function fonts(names: string[]) {
  const wanted = new Set([...names, '함초롬바탕', '함초롬돋움']);
  // HOP's redistributable substitutes preserve family names without fetching CDN fonts.
  await Promise.all(FONT_LIST.filter(font => wanted.has(font.name)).map(async font => {
    try {
      const face = new FontFace(font.name, `url("${/\/(Cafe24|Happiness)/.test(font.file) ? '/fonts/NotoSansKR-Regular.woff2' : font.file}")`, font.unicodeRange ? { unicodeRange: font.unicodeRange } : {});
      document.fonts.add(await face.load());
    } catch (error) { console.warn('HWP font unavailable', font.name, error); }
  }));
}
async function initialize() {
  initToolbarLabels();
  initThemeSync((effective, mode) => eventBus.emit('theme-changed', { effective, mode }));
  message('문서 엔진 로딩 중…');
  await fonts([]);
  await wasm.initialize();
  const source = await host.load();
  const info = wasm.loadDocument(new Uint8Array(source.bytes), source.name);
  await fonts(info.fontsUsed ?? []);
  const container = document.getElementById('scroll-container')!;
  canvasView = new CanvasView(container, wasm, eventBus, createRendererSession());
  new Ruler(document.getElementById('h-ruler') as HTMLCanvasElement, document.getElementById('v-ruler') as HTMLCanvasElement,
    container, eventBus, wasm, canvasView.getVirtualScroll(), canvasView.getViewportManager());
  input = new InputHandler(container, wasm, eventBus, canvasView.getVirtualScroll(), canvasView.getViewportManager());
  input.setDispatcher(dispatcher);
  input.setContextMenu(new ContextMenu(dispatcher, registry));
  input.setCommandPalette(new CommandPalette(registry, dispatcher));
  input.setCellSelectionRenderer(new CellSelectionRenderer(container, canvasView.getVirtualScroll()));
  input.setTableObjectRenderer(new TableObjectRenderer(container, canvasView.getVirtualScroll()));
  input.setTableResizeRenderer(new TableResizeRenderer(container, canvasView.getVirtualScroll()));
  input.setPictureObjectRenderer(new TableObjectRenderer(container, canvasView.getVirtualScroll(), true));
  const toolbar = new Toolbar(document.getElementById('style-bar')!, wasm, eventBus, dispatcher);
  initStyleToolbarOverflow(document.getElementById('style-bar'));
  enhanceCustomSelects(document);
  new MenuBar(document.getElementById('menu-bar')!, eventBus, dispatcher, registry);
  // Disable file commands that would escape main's document ownership.
  document.querySelectorAll<HTMLElement>('[data-cmd^="file:"]').forEach(element => {
    if (!['file:save', 'file:save-as'].includes(element.dataset.cmd!)) element.remove();
  });
  document.querySelectorAll<HTMLElement>('.tb-btn[data-cmd], .tb-split-item[data-cmd]').forEach(button => {
    button.addEventListener('mousedown', event => { event.preventDefault(); dispatcher.dispatch(button.dataset.cmd!, { anchorEl: button }); });
  });
  document.querySelectorAll<HTMLElement>('.tb-split-arrow').forEach(button => button.addEventListener('click', () => button.parentElement?.classList.toggle('open')));
  const zoom = canvasView.getViewportManager();
  document.getElementById('sb-zoom-in')!.onclick = () => zoom.setZoom(zoom.getZoom() + .1);
  document.getElementById('sb-zoom-out')!.onclick = () => zoom.setZoom(zoom.getZoom() - .1);
  document.getElementById('sb-zoom-val')!.onclick = () => zoom.setZoom(1);
  document.getElementById('sb-zoom-fit-width')!.onclick = () => dispatcher.dispatch('view:zoom-fit-width');
  document.getElementById('sb-zoom-fit')!.onclick = () => dispatcher.dispatch('view:zoom-fit-page');
  eventBus.on('zoom-level-display', value => { if (ready) publish(); document.getElementById('sb-zoom-val')!.textContent = `${Math.round(Number(value) * 100)}%`; });
  eventBus.on('current-page-changed', (current, total) => { page = Number(current); if (ready) publish(); document.getElementById('sb-page')!.textContent = `${Number(page) + 1} / ${total} 쪽`; });
  canvasView.prepareDocumentLoad();
  await canvasView.loadDocument();
  toolbar.setEnabled(true); toolbar.initFontDropdown(info.fontsUsed); toolbar.initStyleDropdown();
  if (source.position?.kind === 'hwp') { zoom.setZoom(source.position.zoom); canvasView.gotoPage(Math.min(source.position.page, wasm.pageCount - 1)); }
  input.activateWithCaretPosition();
  documentState.markClean('opened'); ready = true;
  document.documentElement.dataset.hwpReady = 'true';
  message(`${source.name} — ${wasm.pageCount}페이지`); publish();
}
void initialize().catch(error => {
  message(`문서를 열 수 없습니다: ${error}`);
  host.state({ revision, ready: false, error: String(error) });
  console.error(error);
});
