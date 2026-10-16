<script lang="ts">
  import { staticOutput, notebookHtml } from './notebook-content';
  import type { DesktopPort } from '../ports/desktop-port';
  let { outputs, path, desktop }: { outputs: unknown[]; path: string; desktop: DesktopPort } = $props();
  const rendered = $derived(outputs.slice(0, 100).map(staticOutput));
  function link(event: Event) {
    const anchor = (event.target as HTMLElement).closest('a'); if (!anchor) return;
    event.preventDefault(); const href = anchor.getAttribute('href');
    if (href && /^https?:/i.test(href)) void desktop.openLink(href);
  }
</script>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="notebook-outputs" aria-label="Cell outputs" onclick={link} onkeydown={event => { if (event.key === 'Enter') link(event); }}>
  {#each rendered as output}
    {#if output.kind === 'image'}<img src={output.content} alt="Notebook output" loading="lazy" />
    {:else if output.kind === 'html'}<div class="output-html">{@html output.content}</div>
    {:else if output.kind === 'markdown'}
      {#await desktop.renderNotebookMarkdown(path, output.content)}<pre>{output.content}</pre>
      {:then rendered}<div class="output-html">{@html notebookHtml(rendered.html, rendered.baseHref)}</div>
      {:catch}<pre>{output.content}</pre>{/await}
    {:else if output.kind === 'unsupported'}<p class="output-note">{output.content}</p>
    {:else}<pre class:error={output.kind === 'error'}>{output.content}</pre>{/if}
  {/each}
  {#if outputs.length > 100}<p class="output-note">Showing 100 outputs. All {outputs.length} outputs are preserved.</p>{/if}
</div>
<style>
  .notebook-outputs { padding: 12px 16px; border-top: 1px solid var(--app-border); overflow-x: auto; contain: content; }
  pre { margin: 0 0 8px; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
  img { max-width: 100%; height: auto; display: block; }
  .error { color: var(--app-danger-text); }
  .output-note { color: var(--app-muted-text); font-size: 12px; }
  .output-html :global(table) { border-collapse: collapse; }
  .output-html :global(td), .output-html :global(th) { border: 1px solid var(--app-border); padding: 4px 8px; }
</style>
