import type { ZoomSnapshot } from '../core/zoom';

export const zoomState = $state<ZoomSnapshot>({ app: 100, text: 100, terminal: 100, revision: -1 });
