import './style.css';
import { electronDesktop } from './adapters/electron-desktop';
import { installTextZoom } from './editor/text-zoom';
import { zoomState } from './zoom-state.svelte';

if (new URL(location.href).searchParams.has('browser-find-overlay')) {
  void Promise.all([import('svelte'), import('./browser/BrowserFindPanel.svelte')]).then(([{ mount }, { default: FindPanel }]) =>
    mount(FindPanel, { target: document.getElementById('app')!, props: { api: electronDesktop.browserFindOverlay } }));
} else if (new URL(location.href).searchParams.has('location-overlay')) {
  void Promise.all([import('svelte'), import('./workspace/location/LocationSuggestions.svelte')]).then(([{ mount }, { default: Suggestions }]) =>
    mount(Suggestions, { target: document.getElementById('app')!, props: { desktop: electronDesktop } }));
} else if (new URL(location.href).searchParams.has('office-export')) {
  void import('./office/office-export').then(module =>
    module.startOfficeExport((window as unknown as { officeExport: import('./office/office-export').OfficeExportBridge }).officeExport));
} else if (new URL(location.href).searchParams.has('menu-overlay')) {
  void import('./shell/menu-overlay-runtime').then(module => module.startMenuOverlay(electronDesktop));
} else if (new URL(location.href).searchParams.has('close-prompt-overlay')) {
  void import('./shell/close-prompt-overlay-runtime').then(module => module.startClosePromptOverlay(electronDesktop));
} else {
  installTextZoom(electronDesktop, snapshot => Object.assign(zoomState, snapshot));
  void import('./app/workspace-controller').then(module => module.startWorkspace(electronDesktop));
}
