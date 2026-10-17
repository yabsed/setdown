<script lang="ts">
  import { onMount, tick } from 'svelte';
  import ExtensionActions from '../../browser/ExtensionActions.svelte';
  import ZoomControls from '../../ZoomControls.svelte';
  import { zoomState, mediaZoom } from '../../zoom-state.svelte';
  import { view } from '../workspace-view.svelte';
import type { AppActions } from '../../ports/ui-actions';
  import { project } from '../../project/project-state.svelte';
  import { browser } from '../../browser/browser-state.svelte';
  import type { BrowserPlace } from '../../../protocol/browser';
  import { fileLocation } from '../../../core/document/file-location';
  import { isMarkdownPath } from '../../editor/markdown-editor-port';
  let { actions, groupId }: { actions: AppActions; groupId: string } = $props();
  const group = $derived(view.groups.find(g => g.id === groupId));
  const tab = $derived(view.tabs.find(t => t.id === group?.activeId));
  const review = $derived(groupId === view.focusedGroupId && project.gitDiffActive ? project.gitDiff : null);
  const web = $derived(!review && tab?.kind === 'web' ? tab.page : undefined);
  const location = $derived(review ? fileLocation(review.filePath) : tab?.kind === 'web' || tab?.kind === 'terminal' ? tab.path : tab ? fileLocation(tab.path) : '');
  let input = $state<HTMLInputElement>(), finder = $state<HTMLInputElement>();
  let editing = $state(false), draft = $state(''), suggestions = $state<BrowserPlace[]>([]), selected = $state(-1), bookmarked = $state(false);
  let generation = 0, composing = false, timer: ReturnType<typeof setTimeout>;
  let error = $state('');
  let selectOnClick = false;
  let activeTabId: string | undefined;
  const finding = $derived(!!web && browser.findId === tab?.id);
  const requests = $derived(tab ? browser.permissions[tab.id] ?? [] : []);
  let findComposing = false;
  function closeFind() {
    browser.findId = null; browser.active = 0; browser.matches = 0;
    if (tab) { actions.browserFind(tab.id, ''); if (reading) window.dispatchEvent(new CustomEvent('setdown:reader-focus', { detail: tab.id })); else actions.browserCommand(tab.id, 'focus'); }
  }
  const hwp = $derived(view.hwpTabs.some(item => item.id === tab?.id));
  const media = $derived(view.mediaTabs.find(item => item.id === tab?.id));
  const fileZoom = $derived(tab ? mediaZoom[tab.id] : undefined);
  const zoomScope = $derived(tab?.kind === 'terminal' && !review ? 'terminal' : 'text');
  const zoomId = $derived(review && project.activeGitDiffId ? `git-diff:${project.activeGitDiffId}` : tab?.id);
  const reading = $derived(!!tab && !!browser.readers[tab.id]);
  // Markdown surface actions live in the address bar. They act on the focused
  // session, so only the focused group's bar shows them (as the tab strip did).
  const focusedGroup = $derived(groupId === view.focusedGroupId);
  const markdown = $derived(!['web', 'terminal'].includes(tab?.kind ?? 'document') && isMarkdownPath(tab?.path ?? ''));
  const canRender = $derived(project.gitDiffActive
    ? !!project.gitDiff && isMarkdownPath(project.gitDiff.filePath)
      && project.gitDiff.originalText !== null && project.gitDiff.modifiedText !== null
    : markdown);
  const canInsert = $derived(project.gitDiffActive
    ? project.gitDiffMode === 'source' && !!project.gitDiff && !project.gitDiff.staged && !project.gitDiff.history
      && project.gitDiff.originalText !== null && project.gitDiff.modifiedText !== null
      && isMarkdownPath(project.gitDiff.filePath)
    : markdown && view.surface === 'editor');
  $effect(() => {
    const id = tab?.id;
    if (id === activeTabId) return;
    activeTabId = id;
    // The same input serves every tab; release the outgoing tab's edit/selection.
    input?.blur();
    if (input) input.setSelectionRange(input.value.length, input.value.length);
    blur();
  });
  $effect(() => { if (!editing) draft = location === 'about:blank' ? '' : location; });
  $effect(() => {
    const url = web?.url; void browser.revision;
    bookmarked = false;
    if (url?.startsWith('http')) void actions.browserPlaces(url, 'bookmarks').then(rows => { if (web?.url === url) bookmarked = rows.some(p => p.url === url); }).catch(() => {});
  });
  let bar = $state<HTMLElement>();
  let placement = $state(0);
  const popupToken = crypto.randomUUID();
  let popupRequested = false;
  $effect(() => {
    if (!editing || !suggestions.length || !bar) {
      if (popupRequested) { popupRequested = false; actions.locationSuggestions.hide(popupToken); }
      return;
    }
    void placement;
    popupRequested = true;
    const rect = bar.getBoundingClientRect();
    void actions.locationSuggestions.show({ token: popupToken, selected,
      rows: suggestions.map(({ url, title, bookmarked }) => ({ url, title, bookmarked })),
      bounds: { x: rect.left + 9, y: rect.bottom - 1, width: rect.width - 18, height: 12 + 46 * suggestions.length },
    }).catch(reason => { error = String(reason); });
  });
  function search() {
    clearTimeout(timer); const request = ++generation;
    if (composing) return;
    timer = setTimeout(() => void actions.browserPlaces(draft).then(rows => {
      if (request === generation && editing) { suggestions = rows.slice(0, 8); selected = -1; }
    }).catch(() => { if (request === generation) suggestions = []; }), 100);
  }
  async function go(value = selected >= 0 ? suggestions[selected].url : draft) {
    // Submitting ends the address edit and lets navigation focus the content.
    input?.blur();
    editing = false; suggestions = []; generation++; error = '';
    try { await actions.navigateLocation(groupId, value); }
    catch (reason) { error = String(reason); }
  }
  function blur() { editing = false; suggestions = []; generation++; clearTimeout(timer); }
  async function focus() { if (groupId !== view.focusedGroupId) return; await tick(); input?.focus(); input?.select(); }
  onMount(() => {
    const resize = new ResizeObserver(() => { placement++; });
    if (bar) resize.observe(bar);
    const offChoice = actions.locationSuggestions.onChoice(choice => {
      if (choice.token === popupToken && editing && suggestions.some(row => row.url === choice.url)) void go(choice.url);
    });
    const offHidden = actions.locationSuggestions.onHidden(token => { if (token === popupToken) { popupRequested = false; blur(); } });
    const reposition = () => { placement++; };
    window.addEventListener('resize', reposition);
    const find = async () => { if (groupId === view.focusedGroupId && web && tab) {
      browser.findId = tab.id; browser.active = 0; browser.matches = 0;
      actions.browserFind(tab.id, browser.query); await tick(); finder?.focus(); finder?.select();
    } };
    window.addEventListener('setdown:focus-location', focus);
    window.addEventListener('setdown:browser-find', find);
    return () => { resize.disconnect(); offChoice(); offHidden(); actions.locationSuggestions.hide(popupToken); window.removeEventListener('resize', reposition); clearTimeout(timer); window.removeEventListener('setdown:focus-location', focus); window.removeEventListener('setdown:browser-find', find); };
  });
</script>

<div bind:this={bar} class="location-bar" data-group-id={groupId} class:loading={web?.loading}>
  <button aria-label="Back" title="Back (Alt+Left)" disabled={!tab?.canGoBack || !!review} onclick={() => actions.navigateHistory(tab!.id, -1)}>←</button>
  <button aria-label="Forward" title="Forward (Alt+Right)" disabled={!tab?.canGoForward || !!review} onclick={() => actions.navigateHistory(tab!.id, 1)}>→</button>
  {#if web}
    <button aria-label={web.loading ? 'Stop loading' : 'Reload page'} title={web.loading ? 'Stop loading' : 'Reload page'}
      onclick={event => actions.browserCommand(tab!.id, web.loading ? 'stop' : event.shiftKey ? 'reload-no-cache' : 'reload')}>{web.loading ? '×' : '↻'}</button>
  {:else if review}<span class="location-kind" aria-hidden="true">±</span>{/if}
  {#if finding}
    <input bind:this={finder} aria-label="Find in web page" placeholder="Find in page" maxlength="1000" bind:value={browser.query}
      oninput={event => { browser.query = event.currentTarget.value; if (!findComposing) actions.browserFind(tab!.id, browser.query); }}
      oncompositionstart={() => { findComposing = true; }} oncompositionend={() => { findComposing = false; actions.browserFind(tab!.id, browser.query); }}
      onkeydown={event => {
        if (event.isComposing || findComposing) return;
        if (event.key === 'Enter') { event.preventDefault(); actions.browserFind(tab!.id, browser.query, !event.shiftKey, true); }
        else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeFind(); }
      }} />
    <span class="find-count">{browser.active}/{browser.matches}</span>
    <button aria-label="Close web search" onclick={closeFind}>×</button>
  {:else}
    <input bind:this={input} aria-label="Address or file path" placeholder="Search or enter an address" spellcheck="false" autocomplete="off"
      bind:value={draft} title={location} onfocus={() => { editing = true; input?.select(); search(); }} onblur={blur}
      onpointerdown={() => { selectOnClick = document.activeElement !== input || !document.hasFocus(); if (!editing) { editing = true; search(); } }}
      onmouseup={event => { if (selectOnClick) { event.preventDefault(); input?.select(); selectOnClick = false; } }}
      oninput={search} oncompositionstart={() => { composing = true; clearTimeout(timer); generation++; }} oncompositionend={() => { composing = false; search(); }}
      onkeydown={event => {
        if (event.isComposing || composing) return;
        if (event.key === 'Enter') { event.preventDefault(); void go(); }
        else if (event.key === 'Escape') { blur(); input?.blur(); if (web) actions.browserCommand(tab!.id, 'focus'); }
        else if (event.key === 'ArrowDown' && suggestions.length) { event.preventDefault(); selected = (selected + 1) % suggestions.length; }
        else if (event.key === 'ArrowUp' && suggestions.length) { event.preventDefault(); selected = (selected + suggestions.length - 1) % suggestions.length; }
      }} />
    {#if web}
      <ExtensionActions {actions} tabId={tab!.id} />
      <button class="location-icon" aria-label="Site controls" title="Site controls" disabled={!web.url.startsWith('http')}
        onclick={() => actions.browserCommand(tab!.id, 'site-info')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 10h2v7h-2zm0-4h2v2h-2zm1-4a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 1.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z"/></svg>
      </button>
      <button class="location-icon bookmark-toggle" class:bookmarked aria-pressed={bookmarked}
        aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark page'} title={bookmarked ? 'Remove bookmark' : 'Bookmark page'}
        disabled={!web.url.startsWith('http')} onclick={() => void actions.browserBookmark(web.url, web.title, !bookmarked)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.78 5.63L21 9.54l-4.5 4.38 1.06 6.19L12 17.19l-5.56 2.92 1.06-6.19L3 9.54l6.22-.91Z"/></svg>
      </button>
      <button class="location-icon reader-toggle" class:active={reading} aria-pressed={reading}
        aria-label={reading ? 'Exit reader mode' : 'Enter reader mode'}
        title={reading ? 'Exit reader mode' : 'Reader mode (Esc)'} disabled={!web.url.startsWith('http')}
        onclick={() => reading ? actions.browserReaderExit(tab!.id, browser.readerPositions[tab!.id]) : actions.browserReaderEnter(tab!.id)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c4.75 0 8.27 3.13 9.66 6.35a1.62 1.62 0 0 1 0 1.3C20.27 15.87 16.75 19 12 19s-8.27-3.13-9.66-6.35a1.62 1.62 0 0 1 0-1.3C3.73 8.13 7.25 5 12 5Zm0 1.5c-4 0-7 2.63-8.28 5.45a.12.12 0 0 0 0 .1C5 14.87 8 17.5 12 17.5s7-2.63 8.28-5.45a.12.12 0 0 0 0-.1C19 9.13 16 6.5 12 6.5Zm0 2.25A3.25 3.25 0 1 1 12 15.25 3.25 3.25 0 0 1 12 8.75Zm0 1.5A1.75 1.75 0 1 0 12 13.75 1.75 1.75 0 0 0 12 10.25Z"/></svg>
      </button>
    {/if}
  {/if}
  {#if web && requests.length}
    <button class="location-icon permission-request" aria-label={`Review permissions: ${requests.map(r => r.label).join(', ')}`}
      title={requests.map(r => `${r.origin}: ${r.label}`).join('\n')} onclick={() => actions.browserCommand(tab!.id, 'permissions')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a6 6 0 0 0-6 6v4l-2 4v2h16v-2l-2-4V8a6 6 0 0 0-6-6zm0 2a4 4 0 0 1 4 4v4.5l1.75 3.5H6.25L8 12.5V8a4 4 0 0 1 4-4zm-2 16a2 2 0 0 0 4 0z"/></svg>
    </button>
  {/if}
  {#if tab && browser.auth[tab.id]}
    <button aria-label="Sign in to website" title={`Sign in to ${browser.auth[tab.id].origin}`}
      onclick={() => { browser.authId = tab.id; }}>Sign in</button>
  {/if}
  {#if focusedGroup}
    <div class="location-actions">
      <button class="editor-action insert-table-button" class:review-editor-action={project.gitDiffActive} type="button" hidden={!canInsert}
        title="Insert table" aria-label="Insert table" onclick={actions.openTable}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.75A1.75 1.75 0 0 1 5.75 3h12.5A1.75 1.75 0 0 1 20 4.75v14.5A1.75 1.75 0 0 1 18.25 21H5.75A1.75 1.75 0 0 1 4 19.25V4.75Zm1.5 3.75h4.75v-4H5.75a.25.25 0 0 0-.25.25V8.5Zm6.25 0h6.75V4.75a.25.25 0 0 0-.25-.25h-6.5v4Zm-6.25 1.5v4h4.75v-4H5.5Zm6.25 0v4h6.75v-4h-6.75ZM5.5 15.5v3.75c0 .14.11.25.25.25h4.5v-4H5.5Zm6.25 4h6.5a.25.25 0 0 0 .25-.25V15.5h-6.75v4Z"/></svg>
      </button>
      <button class="editor-action insert-link-button" class:review-editor-action={project.gitDiffActive} type="button" hidden={!canInsert}
        title="Insert URL (Ctrl/Cmd+K)" aria-label="Insert URL" onclick={actions.openLink}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 15.5 8 17a3.54 3.54 0 0 1-5-5l3-3a3.54 3.54 0 0 1 5 0 .75.75 0 0 1-1.06 1.06 2.04 2.04 0 0 0-2.88 0l-3 3a2.04 2.04 0 0 0 2.88 2.88l1.5-1.5A.75.75 0 1 1 9.5 15.5Zm5-7L16 7a3.54 3.54 0 0 1 5 5l-3 3a3.54 3.54 0 0 1-5 0 .75.75 0 0 1 1.06-1.06 2.04 2.04 0 0 0 2.88 0l3-3a2.04 2.04 0 0 0-2.88-2.88l-1.5 1.5A.75.75 0 1 1 14.5 8.5Zm1.03.97a.75.75 0 0 1 0 1.06l-5 5a.75.75 0 0 1-1.06-1.06l5-5a.75.75 0 0 1 1.06 0Z"/></svg>
      </button>
      <button class="viewer-action toc-toggle" class:is-active={view.tocOpen} type="button"
        hidden={project.gitDiffActive || !markdown}
        aria-expanded={view.tocOpen} title={view.tocOpen ? 'Close outline' : 'Open outline'}
        aria-label={view.tocOpen ? 'Close outline' : 'Open outline'} onclick={actions.toggleToc}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h2v2H4v-2Zm4 .25h12v1.5H8v-1.5ZM4 11h2v2H4v-2Zm4 .25h12v1.5H8v-1.5ZM4 16.5h2v2H4v-2Zm4 .25h12v1.5H8v-1.5Z"/></svg>
      </button>
      <span class="location-action-divider" aria-hidden="true" hidden={project.gitDiffActive || !markdown}></span>
      <button class="mode-toggle" type="button"
        hidden={!canRender || (!project.gitDiffActive && view.surface === 'empty') || project.gitDiffLoading}
        title={`${project.gitDiffActive && project.gitDiff
          ? project.gitDiffMode === 'rendered' ? 'View Source Diff' : 'View Rendered Diff'
          : view.surface === 'viewer' ? 'Switch to Editor' : 'Switch to Viewer'} (Ctrl/Cmd+E)`}
        aria-label={project.gitDiffActive && project.gitDiff
          ? project.gitDiffMode === 'rendered' ? 'View Source Diff' : 'View Rendered Diff'
          : view.surface === 'viewer' ? 'Switch to Editor' : 'Switch to Viewer'} onclick={actions.toggleSurface}>
        {#if project.gitDiffActive && project.gitDiff ? project.gitDiffMode === 'rendered' : view.surface === 'viewer'}
          <svg class="mode-icon is-visible" viewBox="0 0 24 24" aria-hidden="true"><path d="M16.862 3.487a2.25 2.25 0 0 1 3.182 3.182L8.41 18.303a2 2 0 0 1-.878.507l-3.42 1.026 1.026-3.42a2 2 0 0 1 .507-.878L16.862 3.487Zm1.06 1.06L6.705 15.765a.5.5 0 0 0-.127.22l-.538 1.792 1.792-.538a.5.5 0 0 0 .22-.127L19.104 5.608a.75.75 0 0 0-1.182-1.06Z"/></svg>
        {:else}
          <svg class="mode-icon is-visible" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c4.75 0 8.27 3.13 9.66 6.35a1.62 1.62 0 0 1 0 1.3C20.27 15.87 16.75 19 12 19s-8.27-3.13-9.66-6.35a1.62 1.62 0 0 1 0-1.3C3.73 8.13 7.25 5 12 5Zm0 1.5c-4 0-7 2.63-8.28 5.45a.12.12 0 0 0 0 .1C5 14.87 8 17.5 12 17.5s7-2.63 8.28-5.45a.12.12 0 0 0 0-.1C19 9.13 16 6.5 12 6.5Zm0 2.25A3.25 3.25 0 1 1 12 15.25 3.25 3.25 0 0 1 12 8.75Zm0 1.5A1.75 1.75 0 1 0 12 13.75 1.75 1.75 0 0 0 12 10.25Z"/></svg>
        {/if}
      </button>
    </div>
  {/if}
  {#if tab || review}
    {#if web && !reading}
      <ZoomControls label="Website" percent={web.zoomPercent}
        change={step => actions.browserCommand(tab!.id, step === 0 ? 'zoom-reset' : step < 0 ? 'zoom-out' : 'zoom-in')} />
    {:else if !review && (hwp || media?.document.kind === 'pdf' || media?.document.kind === 'image')}
      <ZoomControls label={hwp ? 'HWP' : media?.document.kind === 'pdf' ? 'PDF' : 'Image'} percent={fileZoom?.percent ?? 100}
        min={10} max={fileZoom?.max ?? 1000} disabled={!fileZoom} change={step => fileZoom?.change(step)} />
    {:else}
      <ZoomControls label={zoomScope === 'terminal' ? 'Terminal' : media?.document.kind === 'video' ? 'Video' : 'Text'}
        percent={zoomState.tabs?.[zoomId ?? ''] ?? 100} change={step => actions.changeZoom(step, zoomScope, zoomId)} />
    {/if}
  {/if}
  {#if error || (browser.error && groupId === view.focusedGroupId)}
    <span class="location-error" role="alert">{error || browser.error}<button aria-label="Dismiss browser error" onclick={() => { error = ''; browser.error = ''; }}>×</button></span>
  {/if}
</div>

<style>
  .location-bar { position: relative; z-index: 15; display: flex; align-items: center; gap: 3px; height: 34px; padding: 3px 9px; box-sizing: border-box; background: var(--app-chrome); border-bottom: 1px solid var(--app-border); color: var(--app-text); }
  button { border: 0; border-radius: 5px; background: transparent; color: inherit; min-width: 26px; height: 26px; cursor: pointer; font-size: 16px; }
  button:hover { background: var(--app-hover); } button:disabled { opacity: .35; cursor: default; }
  input { width: 0; flex: 1; height: 25px; padding: 0 9px; border: 1px solid transparent; border-radius: 5px; background: var(--app-canvas); color: inherit; font: 12px/1.4 var(--app-font-family); outline: none; text-overflow: ellipsis; }
  input:focus { border-color: var(--app-muted-text); } .location-kind { width: 20px; text-align: center; opacity: .5; }
  .location-error { color: #b94f4f; }
  .bookmarked { color: var(--app-text); } .find-count { font: 11px var(--app-font-family); }
  .loading { box-shadow: inset 0 -2px var(--app-muted-text); }
  .location-error { position: absolute; top: 34px; left: 10px; right: 10px; background: var(--app-chrome); padding: 8px; font-size: 12px; }
  .location-icon { display: grid; place-items: center; flex: 0 0 28px; height: 28px; padding: 5px; border-radius: 7px; color: var(--app-muted-text); }
  .location-icon svg { width: 18px; height: 18px; fill: currentColor; }
  .bookmark-toggle svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linejoin: round; }
  .bookmark-toggle.bookmarked svg { fill: currentColor; }
  .location-icon:hover, .location-icon.active, .location-icon.bookmarked { color: var(--app-text); }
  .location-icon.active { background: var(--app-hover); }
  .permission-request { color: var(--app-text); box-shadow: inset 0 0 0 1px var(--app-border); }
  button:focus-visible { outline: 1px solid var(--app-muted-text); outline-offset: -1px; }
  .location-actions { display: flex; align-items: center; flex: 0 0 auto; height: 28px; }
  .location-actions button { min-width: 28px; height: 28px; }
  .location-action-divider { width: 1px; height: 17px; margin: 0 6px; background: var(--app-border); }
  @media (max-width: 620px) { .location-action-divider { margin: 0 4px; } }
  .location-action-divider[hidden] { display: none; }
  :global(.shell) .review-editor-action:not([hidden]) { display: grid; }
  :global(.shell) .editor-action[hidden] { display: none; }
</style>
