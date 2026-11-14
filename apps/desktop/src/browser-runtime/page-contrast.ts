import { webFrame } from 'electron';
import { carriesWhiteText, cssColor, over, readableText, type Color } from '../core/browser/text-contrast';
import { computedColorReader } from './computed-color';

/** Bounded, event-driven correction of text on known solid surfaces. No page captures,
 * navigation, global polling, retained detached DOM, or authored color changes. */
export function installPageContrast(canvas: string, whiteTextScope?: string): () => void {
  const base = cssColor(canvas) ?? [255, 255, 255, 1] as Color;
  const colorOf = computedColorReader();
  const attribute = 'data-setdown-readable', property = '--setdown-readable-text';
  // The site-specific white foreground belongs to a dark panel only. The same
  // panel can also be painted with the light app surface, where white vanishes.
  const whiteAttribute = 'data-setdown-white-text';
  const whiteScope = whiteTextScope && `:is(${whiteTextScope})[${whiteAttribute}]`;
  const sheet = webFrame.insertCSS(`
    [${attribute}] { color:var(${property}) !important; -webkit-text-fill-color:var(${property}) !important; }
    ${whiteScope ? `${whiteScope}, ${whiteScope} * { color:#fff !important; -webkit-text-fill-color:#fff !important; }` : ''}
  `, { cssOrigin: 'user' });
  const corrected = new Map<HTMLElement, { value: string; priority: string; applied: string }>();
  const roots = new Set<Element>();
  /** Solid color painted behind an element by itself and its ancestors; null when it cannot be known. */
  function backdrop(element: Element, own?: CSSStyleDeclaration): Color | null {
    let background: Color = [0, 0, 0, 0], parent: Element | null = element, depth = 0;
    while (parent && depth++ < 32) {
      const layer = parent === element && own ? own : getComputedStyle(parent);
      // Images/gradients, blend modes and group opacity need spatial compositing.
      // Do not guess a solid background or erase deliberately transparent text.
      if (layer.backgroundImage !== 'none' || Number(layer.opacity) < 1 || layer.mixBlendMode !== 'normal' || layer.filter !== 'none') return null;
      const color = colorOf(layer.backgroundColor);
      if (!color) return null;
      background = over(background, color);
      if (background[3] >= .999) break;
      parent = parent.parentElement;
    }
    return over(background, base);
  }
  function markWhiteScopes() {
    if (!whiteTextScope) return;
    for (const scope of document.querySelectorAll(whiteTextScope)) {
      const surface = backdrop(scope), white = !!surface && carriesWhiteText(surface);
      if (white === scope.hasAttribute(whiteAttribute)) continue;
      scope.toggleAttribute(whiteAttribute, white);
      if (roots.size < 32) roots.add(scope);
    }
  }
  let walker: TreeWalker | undefined, timer: ReturnType<typeof setTimeout> | undefined, stopped = false, visited = 0;
  const restore = (element: HTMLElement) => {
    const previous = corrected.get(element);
    if (!previous) return;
    element.removeAttribute(attribute);
    if (element.style.getPropertyValue(property) === previous.applied) {
      if (previous.value) element.style.setProperty(property, previous.value, previous.priority);
      else element.style.removeProperty(property);
    }
    corrected.delete(element);
  };
  function inspect(element: HTMLElement) {
    if (!element.isConnected) { restore(element); return; }
    // A site-specific foreground takes precedence over automatic pole selection.
    if (whiteScope && element.closest(whiteScope)) { restore(element); return; }
    // Correct the control too: its currentColor icons and nested labels must
    // inherit the same readable foreground, even without a direct text node.
    if (!element.matches('input,textarea,button,a,[role="button"],[role="link"]') && !Array.from(element.childNodes).some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) { restore(element); return; }
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) return;
    element.removeAttribute(attribute);
    if (element.closest('[aria-disabled="true"],:disabled')) { restore(element); return; }
    const style = getComputedStyle(element), foreground = colorOf(style.webkitTextFillColor || style.color);
    if (!foreground || foreground[3] === 0 || style.visibility !== 'visible') { restore(element); return; }
    const background = backdrop(element, style), value = background && readableText(foreground, background);
    if (!value) { restore(element); return; }
    if (!corrected.has(element)) {
      if (corrected.size >= 1024) restore(corrected.keys().next().value!);
      corrected.set(element, { value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property), applied: value });
    } else corrected.get(element)!.applied = value;
    if (element.style.getPropertyValue(property) !== value) element.style.setProperty(property, value);
    element.setAttribute(attribute, '');
  }
  // Attribute selectors also change paint (e.g. data-theme and a peeking
  // sidebar's data-* state). Restricting this to class/style misses those paths.
  const observe = () => observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
  function schedule() {
    if (!stopped && !timer && !document.hidden) timer = setTimeout(run, 120);
  }
  function enqueue(element: Element | null) {
    if (!element || !element.isConnected) return;
    if (roots.size < 32) roots.add(element.closest('head') ? document.body ?? document.documentElement : element);
    schedule();
  }
  function run() {
    timer = undefined;
    if (stopped || document.hidden) return;
    observer.disconnect();
    try {
      for (const element of corrected.keys()) if (!element.isConnected) restore(element);
      markWhiteScopes();
      const start = performance.now();
      for (let count = 0; count < 100 && performance.now() - start < 8; count++) {
        if (!walker) {
          const root = roots.values().next().value;
          if (!root) break;
          roots.delete(root); if (!root.isConnected) continue;
          walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT); visited = 0;
          if (root instanceof HTMLElement) inspect(root);
        }
        const element = walker.nextNode();
        if (!element || ++visited > 10000) { walker = undefined; continue; }
        if (element instanceof HTMLElement) inspect(element);
      }
    } finally { if (!stopped) observe(); }
    if (roots.size || walker) schedule();
  }
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes' && (record.attributeName === attribute || record.attributeName === whiteAttribute || record.attributeName?.startsWith('data-darkreader'))) continue;
      if (record.type === 'childList') {
        if (record.removedNodes.length) schedule();
        for (const node of record.addedNodes) enqueue(node instanceof Element ? node : node.parentElement);
      } else enqueue(record.target instanceof Element ? record.target : record.target.parentElement);
    }
  });
  const interaction = (event: Event) => enqueue(event.target instanceof Element ? event.target : document.body);
  let viewportTimer: ReturnType<typeof setTimeout> | undefined;
  const viewport = () => {
    if (viewportTimer || stopped) return;
    viewportTimer = setTimeout(() => {
    viewportTimer = undefined;
    // Start near the viewport after scrolling, even in documents with huge DOMs.
    for (const x of [.2, .5, .8]) for (const y of [.15, .5, .85]) enqueue(document.elementFromPoint(innerWidth * x, innerHeight * y)?.parentElement ?? null);
    schedule();
    }, 120);
  };
  const events = ['pointerover', 'pointerout', 'focusin', 'focusout', 'transitionend'];
  for (const event of events) document.addEventListener(event, interaction, true);
  window.addEventListener('scroll', viewport, { passive: true, capture: true });
  window.addEventListener('resize', viewport);
  document.addEventListener('visibilitychange', viewport);
  observe(); enqueue(document.body);
  return () => {
    stopped = true; clearTimeout(timer); clearTimeout(viewportTimer); observer.disconnect(); roots.clear(); walker = undefined;
    for (const event of events) document.removeEventListener(event, interaction, true);
    window.removeEventListener('scroll', viewport, true); window.removeEventListener('resize', viewport);
    document.removeEventListener('visibilitychange', viewport);
    for (const element of corrected.keys()) restore(element);
    for (const scope of document.querySelectorAll(`[${whiteAttribute}]`)) scope.removeAttribute(whiteAttribute);
    webFrame.removeInsertedCSS(sheet);
  };
}
