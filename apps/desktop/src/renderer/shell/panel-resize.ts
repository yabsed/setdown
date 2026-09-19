type ResizeOptions = {
  property: `--${string}`;
  direction: 1 | -1;
  min: number;
  max: () => number;
};

const WIDTHS = ['--project-sidebar-width', '--toc-panel-width'] as const;
const storageKey = (property: string) => `setdown:panel-width:${property}`;

export const clampPanelWidth = (width: number, min: number, max: number) =>
  Math.round(Math.min(Math.max(min, max), Math.max(min, width)));

function elements(target: EventTarget | null) {
  const handle = target as HTMLElement | null;
  const panel = handle?.parentElement;
  const shell = handle?.closest<HTMLElement>('.shell');
  return handle && panel && shell ? { handle, panel, shell } : null;
}

function setWidth(target: EventTarget | null, width: number, options: ResizeOptions) {
  const found = elements(target);
  if (!found) return null;
  const next = clampPanelWidth(width, options.min, options.max());
  found.shell.style.setProperty(
    options.property,
    `${next}px`,
  );
  return next;
}

function rememberWidth(property: string, width: number) {
  try {
    sessionStorage.setItem(storageKey(property), String(Math.round(width)));
  } catch {
    // Session storage can be unavailable in hardened browser environments.
  }
}

export function restorePanelWidths(shell: HTMLElement) {
  for (const property of WIDTHS) {
    try {
      const width = Number(sessionStorage.getItem(storageKey(property)));
      if (Number.isFinite(width) && width > 0) shell.style.setProperty(property, `${width}px`);
    } catch {
      return;
    }
  }
}

export function startPanelResize(event: PointerEvent, options: ResizeOptions) {
  if (event.button !== 0) return;
  const found = elements(event.currentTarget);
  if (!found) return;
  event.preventDefault();
  const { handle, panel } = found;
  const startX = event.clientX;
  const startWidth = panel.getBoundingClientRect().width;
  const previousCursor = document.body.style.cursor;
  const previousSelection = document.body.style.userSelect;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  handle.classList.add('is-dragging');
  handle.setPointerCapture(event.pointerId);

  const move = (next: PointerEvent) => {
    setWidth(handle, startWidth + (next.clientX - startX) * options.direction, options);
  };
  const stop = () => {
    handle.classList.remove('is-dragging');
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', stop);
    handle.removeEventListener('pointercancel', stop);
    handle.removeEventListener('lostpointercapture', stop);
    rememberWidth(options.property, panel.getBoundingClientRect().width);
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = previousSelection;
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('lostpointercapture', stop);
}

export function resizePanelWithKeyboard(event: KeyboardEvent, options: ResizeOptions) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const found = elements(event.currentTarget);
  if (!found) return;
  event.preventDefault();
  const movement = event.key === 'ArrowRight' ? 12 : -12;
  const width = setWidth(found.handle, found.panel.getBoundingClientRect().width
    + movement * options.direction, options);
  if (width !== null) rememberWidth(options.property, width);
}
