import { startWorkspace } from './workspace/workspace-controller';
import { electronDesktop } from './adapters/electron-desktop';
import { installTextZoom } from './editor/text-zoom';

installTextZoom(electronDesktop);
startWorkspace(electronDesktop);
