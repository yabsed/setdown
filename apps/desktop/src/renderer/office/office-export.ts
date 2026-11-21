import type { OfficeFamily } from '../../core/document/document-profile';

/** What the hidden export window's preload exposes; the shell window has no such bridge. */
export type OfficeExportBridge = {
  job(): Promise<{ name: string; family: OfficeFamily; bytes: Uint8Array }>;
  finish(error?: string): void;
};

/**
 * This page shares the shell's entry file and so its stylesheet, while the viewer copies the
 * styles of the document it renders in into the printable result. The sheets are switched off
 * where they are: a removed link would be linked again by the next chunk that names it.
 */
function silenceShellStyles() {
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) link.disabled = true;
  // The dev server delivers the same sheets as style elements.
  for (const style of document.querySelectorAll('style[data-vite-dev-id]')) style.remove();
}

/**
 * The whole page of the hidden export window: render one Office document for paper, turn this
 * window's document into the printable result, and tell the main process it can print.
 */
export async function startOfficeExport(bridge: OfficeExportBridge): Promise<void> {
  try {
    const job = await bridge.job();
    silenceShellStyles();
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:#fff';
    document.body.replaceChildren(host);
    document.body.removeAttribute('class'); document.documentElement.removeAttribute('data-theme');
    const { printOfficeDocument } = await import('./office-runtime');
    silenceShellStyles();
    await printOfficeDocument({ host, family: job.family, name: job.name, bytes: job.bytes, target: window });
    // A shell sheet linked while the document was rendering was copied in under this mark.
    for (const style of document.querySelectorAll('style[data-viewer-inlined-stylesheet]')) style.remove();
    bridge.finish();
  } catch (error) { bridge.finish(error instanceof Error ? error.message : String(error) || 'The document could not be prepared.'); }
}
