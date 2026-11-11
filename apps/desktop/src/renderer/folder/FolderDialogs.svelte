<script lang="ts">
  import type { FileApplication, FileProperties } from '../../protocol/files';
  import { formatSize } from '../../core/files/folder-presentation';
  import { confirmationFocus } from '../shell/confirmation-focus';

  let { properties, openWith, close, launch }: {
    properties: FileProperties | 'loading' | null;
    openWith: { names: string[]; type: string; applications: FileApplication[] } | 'loading' | null;
    close(): void; launch(id: string): void;
  } = $props();
  const date = (time: number) => time > 0 ? new Date(time).toLocaleString() : '—';
  const access = (value: string) => [['Owner', value.slice(0, 3)], ['Group', value.slice(3, 6)], ['Others', value.slice(6, 9)]]
    .map(([who, bits]) => `${who}: ${[bits[0] === 'r' && 'read', bits[1] === 'w' && 'write', bits[2] === 'x' && 'execute'].filter(Boolean).join(', ') || 'none'}`);
</script>

{#if properties}
  <div class="folder-dialog" role="dialog" aria-modal="true" aria-label="Properties" use:confirmationFocus={close}>
    {#if properties === 'loading'}<p>Reading properties…</p>{:else}
      <h2>{properties.name}</h2>
      <dl>
        <dt>Kind</dt><dd>{properties.directory ? 'Folder' : properties.type}</dd>
        <dt>Size</dt><dd>{properties.partial ? 'More than ' : ''}{formatSize(properties.size)}{properties.size >= 1000 ? ` (${properties.size.toLocaleString()} bytes)` : ''}</dd>
        {#if properties.items !== undefined}<dt>Contents</dt><dd>{properties.partial ? 'More than ' : ''}{properties.items.toLocaleString()} {properties.items === 1 ? 'item' : 'items'}</dd>{/if}
        <dt>Location</dt><dd class="path">{properties.path}</dd>
        {#if properties.link !== undefined}<dt>Link target</dt><dd class="path">{properties.link || 'Unreadable'}</dd>{/if}
        <dt>Modified</dt><dd>{date(properties.modified)}</dd>
        <dt>Created</dt><dd>{date(properties.created)}</dd>
        <dt>Accessed</dt><dd>{date(properties.accessed)}</dd>
        <dt>Owner</dt><dd>{properties.owner}</dd>
        <dt>Permissions</dt><dd>{properties.permissions}<small>{access(properties.permissions).join(' · ')}</small></dd>
        {#if properties.free !== undefined && properties.capacity}<dt>Free space</dt><dd>{formatSize(properties.free)} of {formatSize(properties.capacity)}</dd>{/if}
      </dl>
    {/if}
    <div class="actions"><button type="button" onclick={close}>Close</button></div>
  </div>
{/if}

{#if openWith}
  <div class="folder-dialog" role="dialog" aria-modal="true" aria-label="Open With" use:confirmationFocus={close}>
    {#if openWith === 'loading'}<p>Finding applications…</p>{:else}
      <h2>Open {openWith.names.length === 1 ? `“${openWith.names[0]}”` : `${openWith.names.length} files`} with</h2>
      <p class="muted">{openWith.type}</p>
      {#if openWith.applications.length}
        <ul>
          {#each openWith.applications as application (application.id)}
            <li><button type="button" onclick={() => launch(application.id)}>{application.name}{#if application.isDefault}<small>Default</small>{/if}</button></li>
          {/each}
        </ul>
      {:else}<p>No installed application is registered for this file type.</p>{/if}
    {/if}
    <div class="actions"><button type="button" onclick={close}>Cancel</button></div>
  </div>
{/if}

<style>
  .folder-dialog { position: fixed; z-index: 120; top: 50%; left: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; gap: 10px;
    width: min(460px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow-y: auto; padding: 18px 20px; border: 1px solid var(--app-border); border-radius: 10px;
    background: var(--app-chrome); color: var(--app-text); font: 13px/1.5 var(--app-font-family); box-shadow: 0 18px 48px rgb(0 0 0 / .28); }
  h2 { margin: 0; font: 600 15px/1.4 var(--app-font-family); overflow-wrap: anywhere; }
  p { margin: 0; } .muted { color: var(--app-muted-text); }
  dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 5px 14px; margin: 0; }
  dt { color: var(--app-muted-text); } dd { margin: 0; overflow-wrap: anywhere; }
  dd.path { user-select: text; }
  dd small { display: block; color: var(--app-muted-text); }
  ul { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
  li button { display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 7px 10px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  li button:hover, li button:focus-visible { background: var(--app-hover); outline: none; }
  li small { color: var(--app-muted-text); }
  .actions { display: flex; justify-content: flex-end; }
  .actions button { height: 30px; padding: 0 14px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-canvas); color: inherit; font: inherit; cursor: pointer; }
</style>
