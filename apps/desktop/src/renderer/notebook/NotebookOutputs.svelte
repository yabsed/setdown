<script lang="ts">
  import { staticOutput, notebookHtml, outputText } from './notebook-content';
  import type { DesktopPort } from '../ports/desktop-port';
  let { outputs, path, desktop }: { outputs: unknown[]; path: string; desktop: DesktopPort } = $props();
  let preferences = $state<Record<number, string>>({}), copied = $state('');
  const rendered = $derived(outputs.slice(0, 100).map((output, index) => staticOutput(output, preferences[index])));
  const formats = (index: number) => Object.keys((outputs[index] as { data?: object })?.data ?? {}).filter(mime => ['text/plain', 'text/html', 'text/markdown', 'text/latex', 'application/json', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime));
  async function copy() {
    try { await desktop.notebook.copyOutput(path, outputText(outputs)); copied = 'Copied'; }
    catch { copied = 'Could not copy output'; }
  }
  function link(event: Event) {
    const anchor = (event.target as HTMLElement).closest('a'); if (!anchor) return;
    event.preventDefault(); const href = anchor.getAttribute('href');
    if (href && /^https?:/i.test(href)) void desktop.openLink(href);
  }
</script>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="notebook-outputs" aria-label="Cell outputs" onclick={link} onkeydown={event => { if (event.key === 'Enter') link(event); }}>
  <div class="output-actions"><button aria-label="Copy cell output" onclick={copy}>Copy output</button><span role="status">{copied}</span></div>
  {#each rendered as output, index}
    {#if formats(index).length > 1}<select aria-label="Output format" value={preferences[index] ?? ''} onchange={event => preferences[index] = event.currentTarget.value}>
      <option value="">Rich output</option>{#each formats(index) as mime}<option value={mime}>{mime}</option>{/each}
    </select>{/if}
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
  .output-actions { display: flex; gap: 8px; justify-content: end; color: var(--app-muted-text); font-size: 11px; }
  button, select { font: inherit; color: var(--app-muted-text); background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 3px; padding: 2px 5px; }
  button { cursor: pointer; } button:hover { color: var(--app-text); }
  pre { margin: 0 0 8px; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
  img { max-width: 100%; height: auto; display: block; }
  .error { color: var(--app-danger-text); }
  .output-note { color: var(--app-muted-text); font-size: 12px; }
  .output-html :global(table) { border-collapse: collapse; }
  .output-html :global(td), .output-html :global(th) { border: 1px solid var(--app-border); padding: 4px 8px; }
</style>
