<script lang="ts">
  // One version of a PDF or Office file in Setdown's own reader of that type. The reader is the
  // one an ordinary tab uses; only where its bytes come from differs: this version, held here.
  import type { DocumentSnapshot } from '../../../core/document/document';
  import type { GitFileVersion } from '../../../protocol/desktop-api';
  import type { OfficePort, PdfPort } from '../../ports/desktop-port';
  import { electronDesktop } from '../../adapters/electron-desktop';
  import { bytesIdentity, byteSize, versionLabel } from './compared-file';

  let { version, kind, label, side, filePath, tabId, active, focused, onfocus, onpage, reader = $bindable() }: {
    version: GitFileVersion; kind: 'pdf' | 'office'; label: string; side: 'Original' | 'Modified'; filePath: string; tabId: string;
    active: boolean; focused: boolean; onfocus(): void; onpage(page: number): void;
    /** The mounted PDF reader, so that the other side can ask it to show a page. */
    reader?: { showPage(page: number): void } | undefined;
  } = $props();
  const bytes = $derived(version && 'bytes' in version ? version.bytes : undefined);
  const identity = $derived(bytes ? bytesIdentity(bytes) : '');
  const name = $derived(filePath.split(/[\\/]/).at(-1) ?? filePath);
  const snapshot = $derived<DocumentSnapshot | undefined>(bytes ? { kind, path: filePath, name, text: '', savedText: '', revision: 0, savedRevision: 0,
    diskVersion: { size: bytes.byteLength, mtimeMs: 0 }, isUntitled: false } : undefined);
  const held = () => bytes ?? new Uint8Array();
  const pdf: PdfPort = {
    readPdfRange: async (_path, begin, end) => held().slice(begin, end),
    // The selection menu of an open document belongs to that document; here Ctrl+C copies.
    showPdfSelectionMenu: async () => {},
    openLink: url => electronDesktop.openLink(url),
    setTabZoom: (...args) => electronDesktop.setTabZoom(...args),
  };
  const office: OfficePort = { readOfficeBytes: async () => held(), openLink: url => electronDesktop.openLink(url) };
</script>

<section class="document-version" class:modified={side === 'Modified'} aria-label={`${side} document`}
  onpointerdowncapture={onfocus} onfocusin={onfocus}>
  <header>{side}<span>{versionLabel(label)}</span></header>
  <div class="reader">
    {#if !version}
      <p>The file is not in this version.</p>
    {:else if 'error' in version}
      <p role="status">Could not read this version. {version.error}</p>
    {:else if snapshot}
      {#key identity}
        {#if kind === 'pdf'}
          {#await import('../../pdf/PdfSurface.svelte') then module}
            <module.default bind:this={reader} {tabId} document={snapshot} {active} focused={active && focused} desktop={pdf}
              onposition={() => {}} {onpage} />
          {:catch error}<p role="alert">Could not load the PDF reader: {String(error)}</p>{/await}
        {:else}
          {#await import('../../office/OfficeSurface.svelte') then module}
            <module.default {tabId} document={snapshot} {active} focused={active && focused} desktop={office} onposition={() => {}} />
          {:catch error}<p role="alert">Could not load the Office viewer: {String(error)}</p>{/await}
        {/if}
      {/key}
    {/if}
  </div>
  <footer>{#if bytes}{byteSize(bytes.byteLength)}{/if}</footer>
</section>

<style>
  .document-version { display: grid; grid-template-rows: 30px minmax(0, 1fr) 24px; min-width: 0; min-height: 0; }
  .modified { border-left: 1px solid var(--app-border); }
  header { display: flex; align-items: center; gap: 8px; padding: 0 10px; font-size: 12px; border-bottom: 1px solid var(--app-border); }
  header span, footer { color: var(--app-muted-text); font-size: 11px; }
  header span { margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* A flex box: the readers place themselves in the app's grid when they are a tab's surface, and those placements mean nothing here. */
  .reader { display: flex; flex-direction: column; min-width: 0; min-height: 0; position: relative; }
  .reader :global(.pdf-surface), .reader :global(.office-surface) { flex: 1; min-height: 0; }
  p { margin: auto; padding: 12px; color: var(--app-muted-text); font-size: 12px; text-align: center; overflow-wrap: anywhere; }
  footer { padding: 3px 10px; border-top: 1px solid var(--app-border); }
</style>
