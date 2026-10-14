import { startWorkspace } from './workspace/workspace-controller';
import { electronDesktop } from './adapters/electron-desktop';
import { installTextZoom } from './editor/text-zoom';
import { zoomState } from './zoom-state.svelte';

installTextZoom(electronDesktop, snapshot => Object.assign(zoomState, snapshot));
startWorkspace(electronDesktop);
