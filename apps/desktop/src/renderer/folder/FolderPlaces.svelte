<script lang="ts">
  import type { FolderPlace } from '../../protocol/files';
  let { places, current, workspace, navigate, drop, mount, unmount, removeBookmark }: {
    places: FolderPlace[]; current: string; workspace: { name: string; path: string } | null;
    navigate(path: string): void; drop?(event: DragEvent, path: string): void;
    mount?(place: FolderPlace): void; unmount?(place: FolderPlace): void; removeBookmark?(place: FolderPlace): void;
  } = $props();
  let target = $state('');
  const sections = $derived([
    { label: 'Places', items: places.filter(place => place.kind === 'home' || place.kind === 'user') },
    { label: 'Workspace', items: workspace ? [{ id: 'workspace', name: workspace.name, path: workspace.path, kind: 'project' as const }] : [] },
    { label: 'Bookmarks', items: places.filter(place => place.kind === 'bookmark') },
    { label: 'Devices', items: places.filter(place => place.kind === 'mount' || place.kind === 'volume' || place.kind === 'trash' || place.kind === 'root') },
  ].filter(section => section.items.length));
  const droppable = (place: FolderPlace) => !!place.path && place.kind !== 'trash' && place.kind !== 'root' && place.kind !== 'volume';
  const icon = (kind: FolderPlace['kind']) => ({
    home: 'M3 11.5 12 4l9 7.5M5.5 9.5V20h5v-6h3v6h5V9.5',
    user: 'M3.5 6.5h6l2 2h9v11h-17z',
    bookmark: 'M6.5 3.5h11v17L12 16l-5.5 4.5z',
    project: 'M3.5 6.5h6l2 2h9v11h-17zM8 14h8',
    mount: 'M4 7.5h16v9H4zM7 12h.01M10 12h7',
    volume: 'M4 7.5h16v9H4zM7 12h.01M10 12h7',
    trash: 'M5 7h14M9.5 7V4.5h5V7M7 7l1 13h8l1-13',
    root: 'M4 5h16v11H4zM9 20h6M12 16v4',
  })[kind];
</script>

<nav class="folder-places" aria-label="Places">
  {#each sections as section (section.label)}
    <h3>{section.label}</h3>
    {#each section.items as place (place.id)}
      <div class="place" class:active={!!place.path && place.path === current} class:drop-target={target === place.id} class:unmounted={place.kind === 'volume'}>
        <button type="button" class="place-open" title={place.kind === 'volume' ? `Mount ${place.device}` : place.path}
          aria-current={place.path && place.path === current ? 'location' : undefined} data-place={place.kind}
          onclick={() => place.kind === 'volume' ? mount?.(place) : navigate(place.path)}
          ondragover={event => { if (!drop || !droppable(place)) return; event.preventDefault(); target = place.id; }}
          ondragleave={() => { if (target === place.id) target = ''; }}
          ondrop={event => { target = ''; if (drop && droppable(place)) drop(event, place.path); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={icon(place.kind)} /></svg>
          <span>{place.name}</span>
        </button>
        {#if place.kind === 'mount' && place.device && unmount}
          <button type="button" class="place-action" aria-label={`Unmount ${place.name}`} title="Unmount" onclick={() => unmount(place)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5 5 14h14zM5 18.5h14" /></svg>
          </button>
        {:else if place.kind === 'bookmark' && removeBookmark}
          <button type="button" class="place-action" aria-label={`Remove bookmark ${place.name}`} title="Remove bookmark" onclick={() => removeBookmark(place)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        {/if}
      </div>
    {/each}
  {/each}
</nav>

<style>
  .folder-places { display: flex; flex-direction: column; gap: 1px; min-height: 0; overflow-y: auto; padding: 8px 6px; border-right: 1px solid var(--app-border); background: var(--app-chrome); }
  h3 { margin: 10px 8px 4px; font: 600 11px/1.4 var(--app-font-family); letter-spacing: .02em; color: var(--app-muted-text); text-transform: uppercase; }
  h3:first-child { margin-top: 2px; }
  .place { display: flex; align-items: center; min-width: 0; border-radius: 6px; }
  .place:hover { background: var(--app-hover); }
  .place.active { background: var(--app-selected); }
  .place.drop-target { box-shadow: inset 0 0 0 1px var(--app-accent); }
  .place.unmounted .place-open { color: var(--app-muted-text); }
  button { border: 0; background: transparent; color: var(--app-text); cursor: pointer; }
  .place-open { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; height: 28px; padding: 0 8px; border-radius: 6px; font: 13px/1 var(--app-font-family); text-align: left; }
  .place-action { display: none; flex: 0 0 24px; height: 24px; margin-right: 2px; padding: 0; border-radius: 5px; place-items: center; }
  .place:hover .place-action, .place:focus-within .place-action { display: grid; }
  .place-action:hover { background: var(--app-border); }
  .place-action svg { width: 13px; height: 13px; }
  button:focus-visible { outline: 1px solid var(--app-focus-ring, var(--app-muted-text)); outline-offset: -1px; }
  span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  svg { flex: 0 0 16px; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; opacity: .8; }
</style>
