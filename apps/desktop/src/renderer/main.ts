import { startWorkspace } from './workspace/workspace-controller';
import { electronDesktop } from './adapters/electron-desktop';

startWorkspace(electronDesktop);
