import type { DesktopPort } from '../ports/desktop-port';
import { mount } from 'svelte';
import ApplicationMenu from './ApplicationMenu.svelte';

export function startMenuOverlay(desktop: DesktopPort): void {
  document.documentElement.classList.add('native-menu-layer');
  mount(ApplicationMenu, { target: document.getElementById('app')!, props: {
    nativeLayer: true, overlay: desktop.menuOverlay, load: desktop.menuOverlay.entries, execute: desktop.menuOverlay.execute,
  } });
}
