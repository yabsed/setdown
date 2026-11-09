<script lang="ts">
  import { onMount } from 'svelte';
  import DOMPurify from 'dompurify';
  import type { AppActions } from '../ports/ui-actions';
  import type { ReaderAnchor, ReaderSnapshot } from '../../protocol/browser';
  import { GOLDEN_TOP_RATIO } from '../../core/preview/viewport-anchor';
  import { browser } from './browser-state.svelte';
  import { createRenderedFind } from './rendered-find';
  import { zoomState } from '../zoom-state.svelte';
  import { DOCUMENT_FONT_SIZE } from '../../core/theme/typography';

  let { actions, groupId, tabId, snapshot }: {
    actions: AppActions; groupId: string; tabId: string; snapshot: ReaderSnapshot;
  } = $props();
  const article = $derived(snapshot.article);
  let container: HTMLElement;
  let content: HTMLElement;
  let finder = $state<ReturnType<typeof createRenderedFind>>();
  let exporting = $state(false);
  let readyTheme = $state('');
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
    if (command === 'select-all') selectAll();
    else if (command === 'find') window.dispatchEvent(new Event('setdown:browser-find'));
    else if (command === 'export-markdown') await exportArticle('markdown');
    else if (command === 'export-pdf') await exportArticle('pdf');
  }
  function selectAll() {
    container.focus({ preventScroll: true });
    const range = document.createRange(); range.selectNodeContents(content);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
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
    const select = ((event: CustomEvent<string>) => { if (current() && event.detail === tabId) selectAll(); }) as EventListener;
    window.addEventListener('setdown:reader-select-all', select);
    finder = createRenderedFind(container, content, tabId, (active, matches) => {
      if (browser.findId === tabId) { browser.active = active; browser.matches = matches; }
    });
    const style = document.createElement('style');
    document.head.append(style);
    let generation = 0;
    const applyTheme = async () => {
      const theme = document.documentElement.dataset.theme ?? 'github-light';
      const request = ++generation;
      const { readerThemeCss } = await import('./reader-theme');
      const css = await readerThemeCss(theme);
      if (!current() || request !== generation) return;
      style.textContent = `@scope ([data-reader-tab="${CSS.escape(tabId)}"] .web-reader-column) { ${css} }`;
      const first = !readyTheme;
      readyTheme = theme;
      positionAt(browser.readerPositions[tabId] ?? snapshot.anchor);
      if (first) element.focus({ preventScroll: true });
    };
    const theme = new MutationObserver(() => { void applyTheme(); });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    // Native Markdown code blocks use Prism's plain-text presentation even
    // when there is no language to highlight. Page-authored classes stay stripped.
    for (const pre of content.querySelectorAll('pre')) {
      pre.classList.add('language-text');
      pre.querySelector('code')?.classList.add('language-text');
    }
    void applyTheme();
    // Late image loads reflow the article; settle once more unless the user
    // has already taken over the scroll position.
    const settle = () => { if (current() && !userScrolled) positionAt(browser.readerPositions[tabId] ?? snapshot.anchor); };
    element.addEventListener('load', settle, true);
    const timer = setTimeout(settle, 350);
    return () => { disposed = true; theme.disconnect(); style.remove(); window.removeEventListener('setdown:reader-focus', focus); window.removeEventListener('setdown:reader-select-all', select); finder?.dispose(); element.removeEventListener('load', settle, true); clearTimeout(timer); clearTimeout(linkTimer); cancelAnimationFrame(publishFrame); };
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
    if (event.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
      event.preventDefault(); event.stopPropagation(); selectAll(); return;
    }
    if (event.key !== 'Enter' || event.target !== container) return;
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
  data-reader-theme={readyTheme} data-zoom-tab={tabId} style:font-size={`${DOCUMENT_FONT_SIZE * (zoomState.tabs?.[tabId] ?? 100) / 100}px`} bind:this={container}
  style:--reader-scale={(zoomState.tabs?.[tabId] ?? 100) / 100}
  style:--reader-font-size={`${DOCUMENT_FONT_SIZE * (zoomState.tabs?.[tabId] ?? 100) / 100}px`}
  onscroll={onScroll}
  oncontextmenu={contextMenu}
  onclick={clicked} ondblclick={dblclick} onkeydown={keydown}>
  <div class="web-reader-column" class:pending={!readyTheme}>
    <div class="web-reader-content" bind:this={content}>
      <h1>{article.title}</h1>
      {#if meta}<p class="meta">{meta}</p>{/if}
      {@html html}
    </div>
  </div>
</section>

<style>
  .web-reader {
    position: absolute; inset: 0; overflow: auto; overflow-x: hidden;
    padding: 2em; padding-bottom: 5em; box-sizing: border-box;
    background: var(--preview-background); color: var(--app-text);
    font-family: var(--app-font-family); line-height: 1.6; word-wrap: break-word;
    cursor: text; outline: none; font-synthesis: initial; text-rendering: auto;
  }
  .web-reader .web-reader-column { width: 100%; padding: 0; margin: 0; }
  .pending { visibility: hidden; }
  /* Native Markdown uses the selected Crossnote theme, with these document
     font and responsive-content overrides. Keep the same screen/tab scale. */
  .web-reader .web-reader-content { font-size: var(--reader-font-size) !important; }
  .web-reader .web-reader-content,
  .web-reader :global(:is(h1,h2,h3,h4,h5,h6,p,blockquote,ul,ol,li,dl,dt,dd,
    table,th,td,pre,code,kbd,samp,tt,summary)) { font-family: var(--app-font-family) !important; }
  .web-reader .meta { color: var(--app-muted-text); font-size: .85em; margin: 0 0 calc(16px * var(--reader-scale)); }
  .web-reader :global(p), .web-reader :global(li), .web-reader :global(blockquote) { overflow-wrap: break-word; }
  .web-reader :global(pre > code) { font-size: inherit; color: inherit; }
  .web-reader :global(pre) { max-width: 100%; overflow-x: auto; overflow-y: hidden; }
  .web-reader :global(table) { display: block; max-width: 100%; overflow-x: auto; }
  .web-reader :global(img), .web-reader :global(svg) { max-width: 100%; height: auto; }
</style>
