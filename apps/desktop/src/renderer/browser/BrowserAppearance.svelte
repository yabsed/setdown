<script lang="ts">
  import type { BrowserActions } from './browser-actions';
  import type { BrowserThemeSettings, BrowserThemeUpdate } from '../../protocol/browser-theme';
  import { browser } from './browser-state.svelte';
  let { actions }: { actions: BrowserActions } = $props();
  let settings = $state<BrowserThemeSettings | null>(null), error = $state(''), busy = $state(false);
  $effect(() => {
    void browser.revision;
    let current = true;
    void actions.browserThemeSettings().then(value => { if (current) settings = value; }).catch(reason => { if (current) error = String(reason); });
    return () => { current = false; };
  });
  async function update(value: BrowserThemeUpdate) {
    busy = true; error = '';
    try { settings = await actions.browserUpdateThemeSettings(value); }
    catch (reason) { error = String(reason); }
    finally { busy = false; }
  }
</script>
<section aria-label="Web appearance">
  <h3>Web page colors</h3>
  {#if settings}
    <label><input type="radio" name="web-theme" checked={settings.mode === 'app'} disabled={busy} onchange={() => update({ mode: 'app' })}/> Follow app theme</label>
    <label><input type="radio" name="web-theme" checked={settings.mode === 'original'} disabled={busy} onchange={() => update({ mode: 'original' })}/> Original website colors</label>
    <p>Use the site information button in the address bar to keep a site's original colors.</p>
    {#if settings.originalSites.length}
      <h3>Sites with original colors</h3>
      {#each settings.originalSites as site}<div class="site"><span title={site}>{site}</span><button disabled={busy} aria-label={`Follow app theme for ${site}`} onclick={() => update({ restoreSite: site })}>Reset</button></div>{/each}
    {/if}
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}
</section>
<style>
  section { padding: 0 12px 12px; overflow: auto; font-size: 12px; }
  h3 { font-size: 12px; font-weight: 600; margin: 5px 0 12px; }
  label { display: flex; align-items: center; gap: 7px; margin: 10px 0; }
  p { color: var(--app-muted-text); line-height: 1.6; }
  .site { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
  .site span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  button { border: 1px solid var(--app-border); border-radius: 4px; padding: 4px 6px; background: var(--app-surface); color: var(--app-text); cursor: pointer; font: inherit; }
</style>
