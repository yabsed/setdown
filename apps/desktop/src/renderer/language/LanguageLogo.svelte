<script lang="ts">
  import { languageLogo, logoColors } from './language-logos';
  let { languages }: { languages: string[] } = $props();
  const logo = $derived(languageLogo(languages));
  const colors = $derived(logoColors(logo?.hex ?? '888888'));
  const label = $derived(languages[0] ?? 'Language server');
  const initials = $derived(languages[0]?.replace(/[^\p{L}\p{N}+#]/gu, '').slice(0, 3).toUpperCase() || 'LSP');
</script>

<span class="language-logo" title={logo?.title ?? label} style:--logo-light={colors.light} style:--logo-dark={colors.dark}>
  {#if logo}
    <svg viewBox="0 0 24 24" role="img" aria-label={`${logo.title} logo`}><path d={logo.path}/></svg>
  {:else}<span class="initials" aria-label={label}>{initials}</span>{/if}
</span>

<style>
  .language-logo { display: grid; place-items: center; flex: 0 0 32px; width: 32px; height: 36px; }
  svg { width: 28px; height: 28px; fill: light-dark(var(--logo-light), var(--logo-dark)); }
  .initials { display: grid; place-items: center; width: 30px; height: 30px; color: var(--app-muted-text); background: var(--app-hover); border-radius: 4px; font-family: inherit; font-size: 10px; font-weight: 600; line-height: 1; }
</style>
