import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WorkspaceZoom } from './workspace-zoom';

/** Separate from theme settings so one preference cannot overwrite the other. */
export function installZoomSettings(file: string, zoom: WorkspaceZoom, notify: () => void) {
  try { zoom.restore(JSON.parse(readFileSync(file, 'utf8'))); } catch { /* First launch or invalid settings. */ }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (!timer) return;
    clearTimeout(timer); timer = undefined;
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file + '.tmp', JSON.stringify(zoom.snapshot));
      renameSync(file + '.tmp', file);
    } catch (error) { console.error('Could not save zoom settings', error); }
  };
  zoom.onChange = () => { notify(); clearTimeout(timer); timer = setTimeout(flush, 200); };
  return flush;
}
