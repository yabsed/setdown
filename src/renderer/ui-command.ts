export type UiCommand =
  | { type: 'activate-tab'; tabId: string }
  | { type: 'close-tab'; tabId: string }
  | { type: 'tab-drag-start'; tabId: string; event: DragEvent }
  | { type: 'tab-drag-end'; tabId: string; event: DragEvent };

const CHANNEL = 'setdown:ui-command';

export function emitUiCommand(command: UiCommand) {
  window.dispatchEvent(new CustomEvent(CHANNEL, { detail: command }));
}

export function onUiCommand(listener: (command: UiCommand) => void) {
  const handler = ((event: CustomEvent<UiCommand>) => listener(event.detail)) as EventListener;
  window.addEventListener(CHANNEL, handler);
  return () => window.removeEventListener(CHANNEL, handler);
}
