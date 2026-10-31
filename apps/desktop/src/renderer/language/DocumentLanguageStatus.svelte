<script lang="ts">
  import { onMount } from 'svelte';
  import { documentSupport, openLanguageCatalog, type DocumentSupportTarget, type AnalysisPage } from './document-support';
  import { presentSupport } from './document-presentation';
  import DocumentAnalysisPanel from './DocumentAnalysisPanel.svelte';
  let { tabId }: { tabId: string } = $props();
  let revision = $state(0), target = $state<DocumentSupportTarget>(), narrow = $state(false);
  let initialPage = $state<AnalysisPage>('summary'), expanded = $state(false), availableHeight = $state(540);
  let button = $state<HTMLButtonElement>(), panel = $state<HTMLDivElement>();
  const support = $derived.by(() => { revision; return documentSupport.get(tabId); });
  const status = $derived(presentSupport(support?.providers ?? []));
  // Workspace snapshots also refresh on group focus. Only a different view or
  // document incarnation ends this inspection, not an unchanged prop refresh.
  $effect(() => { if (target && (target.id !== tabId || support?.resource !== target.resource)) target = undefined; });
  onMount(() => {
    const off = documentSupport.subscribe(() => revision++);
    const outside = (event: PointerEvent) => { if (target && !expanded && event.target instanceof Node && !panel?.contains(event.target) && !button?.contains(event.target)) target = undefined; };
    const inspect = (event: Event) => {
      const request = (event as CustomEvent<{ target: DocumentSupportTarget; page: AnalysisPage }>).detail;
      if (request?.target.id === tabId && documentSupport.current(request.target)) { event.preventDefault(); initialPage = request.page; target = request.target; }
    };
    window.addEventListener('setdown:document-language-support', inspect);
    window.addEventListener('pointerdown', outside);
    return () => { off(); window.removeEventListener('pointerdown', outside); window.removeEventListener('setdown:document-language-support', inspect); };
  });
  $effect(() => {
    const current = button, parent = current?.parentElement, group = current?.closest('.editor-group');
    if (!parent || !group) return;
    const measure = () => { narrow = parent.clientWidth < 600; availableHeight = Math.max(80, group.getBoundingClientRect().bottom - parent.getBoundingClientRect().bottom - 12); };
    const resize = new ResizeObserver(measure); resize.observe(parent); resize.observe(group); measure();
    return () => resize.disconnect();
  });
  function close() { target = undefined; button?.focus(); }
  function toggle() {
    if (target) { close(); return; }
    if (!support) return;
    const current = { id: support.id, resource: support.resource };
    initialPage = 'summary'; expanded = false; target = current;
  }
</script>

{#if support}
  <button bind:this={button} class="support-button" class:issue={status.tone === 'warning'} title={`${support.name}${status.label ? ` · ${status.label}` : ''}`}
    aria-label={`Language status: ${support.name}${status.label ? `, ${status.label}` : ''}`} aria-expanded={!!target} aria-haspopup="dialog" onclick={toggle}>
    {#if status.tone !== 'neutral'}<span class="indicator" aria-hidden="true">{status.tone === 'warning' ? '!' : '◌'}</span>{/if}
    <span class="language-name">{support.name}</span>{#if status.label && !narrow}<span class="support-label"> · {status.label}</span>{/if}<span aria-hidden="true">⌄</span>
  </button>
  {#if target}
    <div bind:this={panel} class="document-language-status" class:expanded style:max-height={`${availableHeight}px`} role="dialog" aria-label="Current file language support" tabindex="-1">
      {#key target.resource}
        <DocumentAnalysisPanel {target} {initialPage} onpagechange={page => { expanded = ['details', 'tool', 'settings', 'output'].includes(page); if (panel) panel.scrollTop = 0; }} onclose={close} onmanage={(language, server) => { target = undefined; openLanguageCatalog(language, server); }} />
      {/key}
    </div>
  {/if}
{/if}

<style>
  .support-button { display: flex; align-items: center; gap: 5px; flex: 0 1 auto; min-width: 48px; max-width: 250px; white-space: nowrap; height: 26px; border: 0; border-radius: 5px; padding: 0 7px; background: transparent; color: var(--app-muted-text); font: 11px var(--app-font-family); cursor: pointer; }
  .language-name, .support-label { overflow: hidden; text-overflow: ellipsis; }
  .indicator { flex: none; font-weight: 600; }
  .issue { color: var(--app-warning-text); }
  button:hover { background: var(--app-hover); }
  button:focus-visible { outline: 1px solid var(--app-focus-ring); }
  .document-language-status { position: absolute; top: 34px; right: 8px; width: min(370px, calc(100% - 16px)); overflow: auto; padding: 14px; box-sizing: border-box; color: var(--app-text); background: var(--app-raised-surface); border: 1px solid var(--app-border); border-radius: 6px; box-shadow: 0 6px 22px var(--app-shadow); }
  .document-language-status.expanded { width: min(480px, calc(100% - 16px)); }
</style>
