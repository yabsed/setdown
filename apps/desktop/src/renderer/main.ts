import { startWorkspace } from './workspace/workspace-controller';
import { electronDesktop } from './adapters/electron-desktop';
import { installTextZoom } from './editor/text-zoom';
import { zoomState } from './zoom-state.svelte';

if (new URL(location.href).searchParams.has('location-overlay')) {
  void Promise.all([import('svelte'), import('./browser/LocationSuggestions.svelte')]).then(([{ mount }, { default: Suggestions }]) =>
    mount(Suggestions, { target: document.getElementById('app')!, props: { desktop: electronDesktop } }));
} else if (new URL(location.href).searchParams.has('menu-overlay')) {
  void import('./shell/menu-overlay-runtime').then(module => module.startMenuOverlay(electronDesktop));
} else {
  installTextZoom(electronDesktop, snapshot => Object.assign(zoomState, snapshot));
  startWorkspace(electronDesktop);
}
