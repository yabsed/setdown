<script lang="ts">
  import { onMount, tick } from 'svelte';
  import DOMPurify from 'dompurify';
  import type { AppActions } from '../view-state.svelte';
  import type { ReaderAnchor, ReaderSnapshot } from '../../protocol/browser';
  import { GOLDEN_TOP_RATIO } from '../../core/preview/viewport-anchor';
  import { browser } from './browser-state.svelte';
  import { createRenderedFind } from './rendered-find';
  import { zoomState } from '../zoom-state.svelte';

  let { actions, groupId, tabId, snapshot }: {
    actions: AppActions; groupId: string; tabId: string; snapshot: ReaderSnapshot;
  } = $props();
  const article = $derived(snapshot.article);
  let container: HTMLElement;
  let content: HTMLElement;
  let finder = $state<ReturnType<typeof createRenderedFind>>();
  let exporting = $state(false);
  $effect(() => {
    const request = browser.readerFind[tabId];
    if (finder && request) finder.search(request.query, request.forward, request.next);
  });
  async function exportArticle(format: 'markdown' | 'pdf') {
    if (exporting) return;
    exporting = true;
    try { await actions.browserReaderExport(tabId, format); } finally { exporting = false; }
  }
  async function contextMenu(event: MouseEvent) {
    event.preventDefault(); actions.focusGroup(groupId);
    const selection = window.getSelection();
    const text = selection?.anchorNode && container.contains(selection.anchorNode) ? selection.toString() : '';
    const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
    let link = ''; try { if (anchor) link = new URL(anchor.getAttribute('href')!, article.url).href; } catch { /* malformed link */ }
    const id = tabId, source = snapshot;
    const command = await actions.browserReaderMenu(id, { selection: text, link });
    if (!container?.isConnected || tabId !== id || snapshot !== source || !browser.readers[id]) return;
    if (command === 'select-all') { const range = document.createRange(); range.selectNodeContents(content); selection?.removeAllRanges(); selection?.addRange(range); }
    else if (command === 'find') window.dispatchEvent(new Event('setdown:browser-find'));
    else if (command === 'export-markdown') await exportArticle('markdown');
    else if (command === 'export-pdf') await exportArticle('pdf');
  }
  let appliedTop = -1, userScrolled = false, linkTimer: ReturnType<typeof setTimeout> | undefined;

  // Article HTML is untrusted page content rendered in the shell: strip
  // anything interactive or styled by the page (the shell CSP is the second
  // layer). data-setdown-block ordinals survive for position mapping.
  const html = $derived(DOMPurify.sanitize(article.content, {
    FORBID_TAGS: ['form', 'button', 'input', 'select', 'textarea', 'iframe', 'object', 'embed',
      'audio', 'video', 'source', 'track', 'map', 'noscript', 'title'],
    FORBID_ATTR: ['style', 'class'],
  }));
  const host = $derived((() => { try { return new URL(article.url).hostname; } catch { return ''; } })());
  const meta = $derived([article.byline, article.siteName && article.siteName !== host ? article.siteName : '', host]
    .filter(Boolean).join(' · '));
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const normalize = (value: string | null) => (value ?? '').replace(/\s+/g, ' ').trim();
  const stamped = () => [...container.querySelectorAll<HTMLElement>('[data-setdown-block]')];

  /** Place the extraction anchor at the same viewport height it occupied on
   * the live page (the yRatio half of the Markdown ViewportAnchor). */
  function positionAt(anchor: ReaderAnchor) {
    const blocks = stamped();
    if (!blocks.length) return;
    const ordinal = (el: HTMLElement) => Number(el.dataset.setdownBlock);
    const el = blocks.find(candidate => ordinal(candidate) === anchor.ordinal)
      ?? [...blocks].reverse().find(candidate => ordinal(candidate) < anchor.ordinal) ?? blocks[0];
    const elTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    appliedTop = Math.max(0, elTop - anchor.yRatio * container.clientHeight);
    container.scrollTop = appliedTop;
  }

  onMount(() => {
    const element = container;
    let disposed = false;
    const current = () => !disposed && container === element && element.isConnected;
    const focus = ((event: CustomEvent<string>) => { if (current() && event.detail === tabId) element.focus({ preventScroll: true }); }) as EventListener;
    window.addEventListener('setdown:reader-focus', focus);
    finder = createRenderedFind(container, content, tabId, (active, matches) => {
      if (browser.findId === tabId) { browser.active = active; browser.matches = matches; }
    });
    void (async () => { await tick(); if (!current()) return; positionAt(browser.readerPositions[tabId] ?? snapshot.anchor); element.focus({ preventScroll: true }); })();
    // Late image loads reflow the article; settle once more unless the user
    // has already taken over the scroll position.
    const settle = () => { if (current() && !userScrolled) positionAt(browser.readerPositions[tabId] ?? snapshot.anchor); };
    element.addEventListener('load', settle, true);
    const timer = setTimeout(settle, 350);
    return () => { disposed = true; window.removeEventListener('setdown:reader-focus', focus); finder?.dispose(); element.removeEventListener('load', settle, true); clearTimeout(timer); clearTimeout(linkTimer); cancelAnimationFrame(publishFrame); };
  });

  function anchorFor(el: HTMLElement | undefined): ReaderAnchor {
    const height = container.clientHeight || 1;
    const scrollRatio = clamp(container.scrollTop / Math.max(1, container.scrollHeight - height));
    if (!el) return { ordinal: 0, yRatio: 0, text: '', scrollRatio };
    return {
      ordinal: Number(el.dataset.setdownBlock),
      yRatio: clamp((el.getBoundingClientRect().top - container.getBoundingClientRect().top) / height),
      text: normalize(el.textContent).slice(0, 80),
      scrollRatio,
    };
  }

  /** The block under the double-click becomes the page anchor, at its current
   * viewport height — the same contract as Markdown edit-at-anchor. */
  function exitAnchor(event: MouseEvent): ReaderAnchor {
    const blocks = stamped();
    const el = (event.target as Element).closest<HTMLElement>('[data-setdown-block]')
      ?? [...blocks].reverse().find(candidate => candidate.getBoundingClientRect().top <= event.clientY) ?? blocks[0];
    return anchorFor(el);
  }

  /** Continuously publish the block on the golden reading line (as the
   * Markdown viewport-state does), so leaving via the address-bar toggle —
   * not just a double-click — returns to the current place. */
  let publishFrame = 0;
  function publishAnchor() {
    if (publishFrame) return;
    publishFrame = requestAnimationFrame(() => {
      publishFrame = 0;
      if (!container) return;
      const golden = container.getBoundingClientRect().top + container.clientHeight * GOLDEN_TOP_RATIO;
      const blocks = stamped();
      const el = blocks.find(candidate => {
        const rect = candidate.getBoundingClientRect();
        return rect.top <= golden && rect.bottom > golden;
      }) ?? blocks.find(candidate => candidate.getBoundingClientRect().top > golden) ?? blocks.at(-1);
      if (el) browser.readerPositions[tabId] = anchorFor(el);
    });
  }

  function onScroll() {
    // Chromium can deliver a queued scroll after Svelte unbinds this surface.
    if (!container?.isConnected) return;
    if (appliedTop >= 0 && Math.abs(container.scrollTop - appliedTop) > 2) userScrolled = true;
    publishAnchor();
  }

  function dblclick(event: MouseEvent) {
    clearTimeout(linkTimer);
    actions.browserReaderExit(tabId, exitAnchor(event));
  }

  /** Keyboard counterpart of the double-click: Enter on the focused reader
   * returns to the page at the first visible block. */
  function keydown(event: KeyboardEvent) {
    if (event.isComposing || event.key !== 'Enter' || event.target !== container) return;
    event.preventDefault();
    const blocks = stamped();
    const top = container.getBoundingClientRect().top;
    const el = blocks.find(candidate => candidate.getBoundingClientRect().bottom > top) ?? blocks.at(-1);
    actions.browserReaderExit(tabId, el ? anchorFor(el) : undefined);
  }

  /** Links navigate the web tab, but hold the click briefly so a double-click
   * can still mean "back to the page here", as in the Markdown viewer. */
  function clicked(event: MouseEvent) {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
    if (!link) return;
    const href = link.getAttribute('href')!;
    event.preventDefault();
    if (href.startsWith('#')) {
      try { container.querySelector(`#${CSS.escape(decodeURIComponent(href.slice(1)))}`)?.scrollIntoView(); } catch { /* bad fragment */ }
      return;
    }
    let url: URL;
    try { url = new URL(href, article.url); } catch { return; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (event.ctrlKey || event.metaKey || event.button === 1) { actions.newWebTab(url.href, true); return; }
    clearTimeout(linkTimer);
    linkTimer = setTimeout(() => {
      actions.browserReaderExit(tabId);
      void actions.navigateLocation(groupId, url.href);
    }, 250);
  }
</script>

<!-- The reading region itself owns pointer position, like the Markdown
     viewer's native surface; Enter is its keyboard return path. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="web-reader" aria-label="Reader mode" data-reader-tab={tabId} tabindex="-1"
  data-zoom-tab={tabId} style:font-size={`${14 * (zoomState.tabs?.[tabId] ?? 100) / 100}px`} bind:this={container}
  onscroll={onScroll}
  oncontextmenu={contextMenu}
  onclick={clicked} ondblclick={dblclick} onkeydown={keydown}>
  <div class="web-reader-column">
    <div class="reader-export-actions" aria-label="Export reading view">
      <button disabled={exporting} onclick={() => void exportArticle('markdown')}>Export to Markdown</button>
      <button disabled={exporting} onclick={() => void exportArticle('pdf')}>Export to PDF</button>
    </div>
    <div bind:this={content}>
      <header>
        <h1>{article.title}</h1>
        {#if meta}<p class="meta">{meta}</p>{/if}
      </header>
      {@html html}
    </div>
  </div>
</section>

<style>
  /* Typeset exactly like the Markdown reader: preview theme background, the
     app font override, 14px base scaled by the text factor (the shell already
     carries app zoom), full-width body with 2em page padding and the
     Crossnote github-family element metrics. Colors come from the same theme
     profile that drives the preview, exposed as shell variables. */
  .reader-export-actions { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 12px; }
  .reader-export-actions button { background: transparent; border: 1px solid var(--app-border); border-radius: 4px; padding: 4px 8px; color: var(--app-muted-text); font: 11px var(--app-font-family); cursor: pointer; }
  .reader-export-actions button:hover { color: var(--app-text); background: var(--app-hover); }
  .web-reader {
    position: absolute; inset: 0; overflow: auto; overflow-x: hidden;
    padding: 2em; padding-bottom: 5rem; box-sizing: border-box;
    background: var(--preview-background); color: var(--app-text);
    font-family: var(--app-font-family); line-height: 1.6; word-wrap: break-word;
    cursor: text; outline: none;
  }
  /* Cap the reading measure so wide windows do not stretch lines and
     images edge to edge; below the cap it behaves exactly as before. */
  .web-reader-column { max-width: 900px; margin-inline: auto; }
  .web-reader > :global(:first-child) { margin-top: 0; }
  .web-reader .meta { color: var(--app-muted-text); font-size: .85em; margin: 0 0 16px; }
  .web-reader :global(h1), .web-reader :global(h2), .web-reader :global(h3),
  .web-reader :global(h4), .web-reader :global(h5), .web-reader :global(h6) {
    line-height: 1.2; margin-top: 1em; margin-bottom: 16px; font-weight: 600;
  }
  .web-reader :global(h1) { font-size: 2.25em; font-weight: 300; padding-bottom: .3em; }
  .web-reader h1 { font-size: 2.25em; font-weight: 300; padding-bottom: .3em; line-height: 1.2; margin: 0 0 16px; }
  .web-reader :global(h2) { font-size: 1.75em; font-weight: 400; padding-bottom: .3em; }
  .web-reader :global(h3) { font-size: 1.5em; font-weight: 500; }
  .web-reader :global(h4) { font-size: 1.25em; }
  .web-reader :global(h5) { font-size: 1.1em; }
  .web-reader :global(h6) { font-size: 1em; color: var(--app-muted-text); }
  .web-reader :global(p) { margin: 0 0 16px; }
  .web-reader :global(p), .web-reader :global(li), .web-reader :global(blockquote) { overflow-wrap: break-word; }
  .web-reader :global(a) { color: var(--app-accent); text-decoration: none; }
  .web-reader :global(a:hover) { text-decoration: underline; }
  .web-reader :global(strong) { font-weight: 700; }
  .web-reader :global(ul) { list-style: disc; }
  .web-reader :global(ol) { list-style: decimal; }
  .web-reader :global(blockquote) {
    margin: 16px 0; padding: 0 15px; color: var(--app-muted-text);
    background: color-mix(in srgb, var(--app-text) 6%, transparent);
    border-left: 4px solid var(--app-border);
  }
  .web-reader :global(code), .web-reader :global(kbd), .web-reader :global(samp), .web-reader :global(tt) {
    font-size: .85em; background: color-mix(in srgb, var(--app-text) 8%, transparent);
    border-radius: 3px; padding: .2em 0;
  }
  .web-reader :global(pre) {
    max-width: 100%; overflow-x: auto; overflow-y: hidden; padding: 16px; line-height: 1.45;
    background: color-mix(in srgb, var(--app-text) 6%, transparent); border-radius: 6px;
  }
  .web-reader :global(pre code) { background: transparent; padding: 0; }
  .web-reader :global(hr) { height: 4px; margin: 32px 0; background: var(--app-border); border: 0 none; }
  .web-reader :global(img), .web-reader :global(svg) { display: block; max-width: 100%; height: auto; }
  .web-reader :global(figure) { margin: 16px 0; }
  .web-reader :global(figcaption) { color: var(--app-muted-text); font-size: .85em; margin-top: 8px; }
  .web-reader :global(table) {
    display: block; max-width: 100%; overflow-x: auto; margin: 10px 0 15px;
    border-collapse: collapse; border-spacing: 0; word-break: keep-all;
  }
  .web-reader :global(th), .web-reader :global(td) { border: 1px solid var(--app-border); padding: 6px 13px; }
</style>
