type ResizeOptions = {
  property: `--${string}`;
  direction: 1 | -1;
  min: number;
  max: () => number;
};

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
  if (!found) return;
  found.shell.style.setProperty(
    options.property,
    `${clampPanelWidth(width, options.min, options.max())}px`,
  );
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
  setWidth(found.handle, found.panel.getBoundingClientRect().width
    + movement * options.direction, options);
}
