import type { DesktopPort } from '../ports/desktop-port';
import { mount } from 'svelte';
import ClosePromptLayer from './ClosePromptLayer.svelte';

/** The page of the layer that asks "Save Changes" above a live web page (`ClosePromptOverlay`). */
export function startClosePromptOverlay(desktop: DesktopPort): void {
  document.documentElement.classList.add('native-menu-layer');
  mount(ClosePromptLayer, { target: document.getElementById('app')!, props: { api: desktop.closePromptOverlay } });
}
