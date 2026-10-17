<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { documentSupport, supportLabel, featureLabels, type DocumentSupport } from './document-support';
  import { isComposingInput } from '../editor/composition-guard';
  let { tabId }: { tabId: string } = $props();
  let revision = $state(0), open = $state(false);
  let button = $state<HTMLButtonElement>(), panel = $state<HTMLDivElement>();
  const support = $derived.by((): DocumentSupport | undefined => { revision; return documentSupport.get(tabId); });
  const label = $derived(supportLabel(support?.providers ?? []));
  const issue = $derived(support?.providers.some(provider => provider.state === 'failed' || provider.state === 'selection-needed'));
  $effect(() => { tabId; open = false; });
  onMount(() => {
    const off = documentSupport.subscribe(() => revision++);
    const outside = (event: PointerEvent) => { if (open && event.target instanceof Node && !panel?.contains(event.target) && !button?.contains(event.target)) open = false; };
    window.addEventListener('pointerdown', outside);
    return () => { off(); window.removeEventListener('pointerdown', outside); };
  });
  async function toggle() { open = !open; if (open) { await tick(); panel?.querySelector('select')?.focus(); } }
</script>

{#if support}
  <button bind:this={button} class="support-button" class:issue title={`${support.name} · ${label}`} aria-label={`Language status: ${support.name}, ${label}`}
    aria-expanded={open} aria-haspopup="dialog" onclick={toggle}><span class="dot" aria-hidden="true"></span>{support.name}<span class="support-label"> · {label}</span></button>
  {#if open}
    <div bind:this={panel} class="document-language-status" role="dialog" aria-label="Current file language support" tabindex="-1"
      onkeydown={event => { if (event.key === 'Escape' && !isComposingInput(event)) { event.preventDefault(); event.stopPropagation(); open = false; button?.focus(); } }}>
      <header><strong>Language support</strong><button aria-label="Close language status" onclick={() => { open = false; button?.focus(); }}>×</button></header>
      <label>Language mode <select aria-label="Language mode" value={support.language} onchange={event => support?.setLanguage(event.currentTarget.value)}>
        <option value="">Auto-detect</option>
        {#each support.choices as choice}<option value={choice.id}>{choice.name}</option>{/each}
      </select></label>
      <p class="hint">Language mode applies to this open document. Syntax colors and basic editing remain available without an analysis server.</p>
      {#each support.providers as provider (provider.id)}
        <section class:failed={provider.state === 'failed'}>
          <div class="provider-title"><strong>{provider.name}</strong><span>{provider.state === 'ready' ? provider.kind === 'builtin' ? 'Built in' : 'Connected' : provider.state === 'missing' ? 'Not installed' : provider.state === 'selection-needed' ? 'Selection needed' : provider.state}</span></div>
          {#if provider.features.length}{@const features = featureLabels(provider.features)}<p>{features.slice(0, 6).join(' · ')}</p>
            {#if features.length > 6}<details><summary>All supported features</summary><p>{features.join(' · ')}</p></details>{/if}
          {/if}
          <p>Checks: {provider.checks === 'none' ? provider.message === 'Diagnostics provided by the analysis server.' ? 'Provided by analysis server' : 'Not provided' : provider.checks}</p>
          {#if provider.message}<p class="message">{provider.message}</p>{/if}
          {#each provider.context ?? [] as context}<p class="context">{context}</p>{/each}
        </section>
      {/each}
      {#if !support.providers.some(provider => provider.state === 'ready' && provider.checks !== 'none')}
        <p class="hint">Code checks are not active for this document.</p>
      {/if}
      <footer>
        <button onclick={() => { open = false; window.dispatchEvent(new Event('setdown:language-support')); }}>Set up analysis…</button>
        <button onclick={() => { open = false; support?.problems(); }}>Problems</button>
        {#if support.providers.some(provider => provider.kind === 'server')}<button onclick={() => support?.restart()}>Restart services</button>{/if}
      </footer>
    </div>
  {/if}
{/if}

<style>
  .support-button { flex: 0 1 auto; min-width: 36px; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; height: 26px; border: 0; border-radius: 5px; padding: 0 7px; background: transparent; color: var(--app-muted-text); font: 11px var(--app-font-family); cursor: pointer; }
  .dot { display: inline-block; width: 5px; height: 5px; margin: 0 6px 1px 0; border-radius: 50%; background: currentColor; }
  .issue { color: var(--app-warning-text); }
  button:hover { background: var(--app-hover); }
  button:focus-visible, select:focus-visible { outline: 1px solid var(--app-focus-ring); }
  .document-language-status { position: absolute; top: 34px; right: 8px; width: min(390px, calc(100% - 16px)); max-height: min(560px, 70vh); overflow: auto; padding: 14px; box-sizing: border-box; color: var(--app-text); background: var(--app-raised-surface); border: 1px solid var(--app-border); border-radius: 6px; box-shadow: 0 6px 22px var(--app-shadow); font: 12px/1.5 var(--app-font-family); }
  header, .provider-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  header { margin-bottom: 12px; }
  header button { border: 0; font-size: 18px; }
  button { color: inherit; background: transparent; cursor: pointer; font: inherit; }
  label { display: grid; gap: 6px; }
  select { padding: 6px; color: inherit; background: var(--app-canvas); border: 1px solid var(--app-border); font: inherit; }
  section { padding: 12px 0; border-top: 1px solid var(--app-border); }
  .provider-title span, .hint { color: var(--app-muted-text); font-size: 11px; }
  p { margin: 6px 0; overflow-wrap: anywhere; }
  .context { color: var(--app-muted-text); font-size: 11px; }
  .failed .message { color: var(--app-warning-text); }
  footer { display: flex; flex-wrap: wrap; gap: 6px; border-top: 1px solid var(--app-border); padding-top: 10px; }
  footer button { padding: 5px 7px; border: 1px solid var(--app-border); border-radius: 3px; font-size: 11px; }
  @media (max-width: 900px) { .support-label { display: none; } }
</style>
