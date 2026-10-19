<script lang="ts">
  import { tracebackTargets, type TraceTarget } from '../../core/notebook/notebook-tools';
  import { staticOutput, notebookHtml, outputText } from './notebook-content';
  import type { DesktopPort } from '../ports/desktop-port';
  let { outputs, path, desktop, ontrace }: { outputs: unknown[]; path: string; desktop: DesktopPort; ontrace(target: TraceTarget): Promise<void> } = $props();
  let preferences = $state<Record<number, string>>({}), copied = $state('');
  let zoom = $state(''), scale = $state(1);
  async function save(content: string) {
    try { const comma = content.indexOf(','); const saved = await desktop.notebook.saveImage(path, content.slice(5, content.indexOf(';')), content.slice(comma + 1)); copied = saved ? `Saved ${saved}` : ''; }
    catch (error) { copied = String(error); }
  }
  const rendered = $derived(outputs.slice(0, 100).map((output, index) => staticOutput(output, preferences[index])));
  const formats = (index: number) => Object.keys((outputs[index] as { data?: object })?.data ?? {}).filter(mime => ['text/plain', 'text/html', 'text/markdown', 'text/latex', 'application/json', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime));
  async function copy() {
    try { await desktop.notebook.copyOutput(path, outputText(outputs)); copied = 'Copied'; }
    catch { copied = 'Could not copy output'; }
  }
  function focusViewer(node: HTMLElement) { const previous = document.activeElement as HTMLElement | null; node.focus(); return { destroy() { if (previous?.isConnected) previous.focus(); } }; }
  function link(event: Event) {
    const anchor = (event.target as HTMLElement).closest('a'); if (!anchor) return;
    event.preventDefault(); const href = anchor.getAttribute('href');
    if (href && /^https?:/i.test(href)) void desktop.openLink(href);
  }
  // Only annotate numeric cells after sanitization. Keep values and authored
  // HTML intact; text columns and row labels retain their reading alignment.
  function alignNumbers(node: HTMLElement, _content: string) {
    const update = () => queueMicrotask(() => {
      for (const cell of node.querySelectorAll('td')) {
        const value = cell.textContent?.trim() ?? '';
        cell.classList.toggle('notebook-number', /^[+−-]?(?:(?:\d+(?:,\d{3})*)(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?%?$/.test(value));
      }
    });
    update(); return { update };
  }
</script>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="notebook-outputs" aria-label="Cell outputs" onclick={link} onkeydown={event => { if (event.key === 'Enter') link(event); }}>
  {#each rendered as output, index}
    {#if output.kind === 'image'}<img src={output.content} alt="Notebook output" loading="lazy" />
    {:else if output.kind === 'html'}<div class="output-html notebook-prose" use:alignNumbers={output.content}>{@html output.content}</div>
    {:else if output.kind === 'markdown'}
      {#await desktop.renderNotebookMarkdown(path, output.content)}<pre>{output.content}</pre>
      {:then rendered}<div class="output-html notebook-prose" use:alignNumbers={rendered.html}>{@html notebookHtml(rendered.html, rendered.baseHref)}</div>
      {:catch}<pre>{output.content}</pre>{/await}
    {:else if output.kind === 'unsupported'}<p class="output-note">{output.content}</p>
    {:else}<pre class:error={output.kind === 'error'}>{output.content}</pre>{#if output.kind === 'error'}<div class="traceback-links">{#each tracebackTargets(output.content) as target}<button onclick={() => ontrace(target)}>{target.label}</button>{/each}</div>{/if}{/if}
    {#if formats(index).length > 1 || output.kind === 'image' || index === rendered.length - 1}
      <div class="output-actions">
        {#if formats(index).length > 1}<select aria-label="Output format" title={`Output ${index + 1} format`} value={preferences[index] ?? ''} onchange={event => preferences[index] = event.currentTarget.value}>
          <option value="">Rich output</option>{#each formats(index) as mime}<option value={mime}>{mime}</option>{/each}
        </select>{/if}
        {#if output.kind === 'image'}<button onclick={() => { zoom = output.content; scale = 1; }}>View full size</button><button onclick={() => save(output.content)}>Save image…</button>{/if}
        {#if index === rendered.length - 1}<button aria-label="Copy cell output" onclick={copy}>Copy output</button>{/if}
      </div>
    {/if}
  {/each}
  {#if copied}<div class="output-feedback" role="status">{copied}</div>{/if}
  {#if outputs.length > 100}<p class="output-note">Showing 100 outputs. All {outputs.length} outputs are preserved.</p>{/if}
</div>
{#if zoom}<div class="image-viewer" use:focusViewer role="dialog" aria-modal="true" aria-label="Notebook image viewer" tabindex="-1" onkeydown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); zoom = ''; }
    if (event.key === 'Tab') { const buttons = [...event.currentTarget.querySelectorAll('button')]; const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
  <div class="viewer-toolbar"><button onclick={() => scale = Math.max(.1, scale / 1.25)}>−</button><span>{Math.round(scale * 100)}%</span><button onclick={() => scale = Math.min(8, scale * 1.25)}>+</button><button onclick={() => scale = 1}>Actual size</button><button onclick={() => save(zoom)}>Save image…</button><button onclick={() => zoom = ''}>Close image</button></div>
  <div class="image-scroll"><img src={zoom} alt="Full size notebook output" style:zoom={scale} /></div>
</div>{/if}
<style>
  .image-viewer { position: fixed; inset: 40px 20px 20px; z-index: 90; background: var(--app-canvas); border: 1px solid var(--app-border); box-shadow: 0 8px 30px #0005; display: flex; flex-direction: column; }
  .viewer-toolbar, .traceback-links { display: flex; gap: 8px; padding: 6px 0; flex-wrap: wrap; }
  .viewer-toolbar { padding: 8px; } .image-scroll { overflow: auto; flex: 1; } .image-scroll img { max-width: none; }

  .notebook-outputs { padding: 12px 12px 0; overflow-x: auto; contain: content; }
  .output-actions { display: flex; align-items: center; gap: 6px; min-height: 30px; flex-wrap: wrap; color: var(--app-text); font-size: 12px; opacity: 0; }
  :global(.notebook-cell:hover) .output-actions, :global(.notebook-cell.selected) .output-actions, :global(.notebook-cell:focus-within) .output-actions { opacity: 1; }
  .output-feedback { color: var(--app-text); font-size: 12px; padding: 4px 0; overflow-wrap: anywhere; }
  button, select { font: inherit; color: var(--app-text); background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 3px; min-height: 26px; padding: 3px 7px; }
  button:focus-visible, select:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
  button { cursor: pointer; } button:hover { color: var(--app-text); }
  pre { margin: 0 0 8px; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--notebook-code-font); line-height: 1.5; }
  img { max-width: 100%; height: auto; display: block; }
  .error { color: var(--app-danger-text); }
  .output-note { color: var(--notebook-secondary-text); font-size: 12px; }
  .output-html { font-size: 1.07143em; }
  .output-html :global(td.notebook-number) { text-align: right; white-space: nowrap; }
  .output-html :global(.dataframe thead th:not(:first-child)) { text-align: right; }
</style>
