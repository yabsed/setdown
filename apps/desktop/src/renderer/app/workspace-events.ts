import type {
  AppCommand,
  ClaimedTabTransfer,
  DocumentSnapshot,
  ExternalChange,
  PreviewMessage,
  ProjectFilesChanged,
  ThemeSnapshot,
} from '../../protocol/desktop-api';
import type { DesktopPort } from '../ports/desktop-port';
import { isComposingInput } from '../editor/composition-guard';

type Handlers = {
  previewMessage(payload: PreviewMessage): void;
  previewFindRequested(tabId: string): void;
  documentOpened(document: DocumentSnapshot): void;
  externalChange(change: ExternalChange): void;
  projectFilesChanged(event: ProjectFilesChanged): void;
  themeChanged(theme: ThemeSnapshot): void;
  windowCloseRequested(names: string[]): void;
  command(command: AppCommand): void;
  saveBeforeClose(): void;
  transferIncoming(transfer: ClaimedTabTransfer): void;
  transferCompleted(transfer: { transferId: string; tabId: string }): void;
  keydown(event: KeyboardEvent): void;
};

/** Preload 이벤트를 workspace 명령으로 번역하는 renderer 입력 어댑터. */
export function installWorkspaceEvents(desktop: DesktopPort, handlers: Handlers): () => void {
  const keydown = (event: KeyboardEvent) => {
    // Do not preventDefault: IME must receive its Escape/Enter/processing key.
    if (!isComposingInput(event)) handlers.keydown(event);
  };
  const unsubscribe = [
    desktop.onPreviewMessage(handlers.previewMessage),
    desktop.onPreviewFindRequested(handlers.previewFindRequested),
    desktop.onDocumentOpened(handlers.documentOpened),
    desktop.onExternalChange(handlers.externalChange),
    desktop.onProjectFilesChanged(handlers.projectFilesChanged),
    desktop.onThemeChanged(handlers.themeChanged),
    desktop.onWindowCloseRequested(handlers.windowCloseRequested),
    desktop.onCommand((command) => {
      // Native EditContext events do not necessarily set a DOM event flag.
      if ((command === 'escape' || command === 'toggle-surface') && isComposingInput()) return;
      handlers.command(command);
    }),
    desktop.onSaveBeforeClose(handlers.saveBeforeClose),
    desktop.onTabTransferIncoming(handlers.transferIncoming),
    desktop.onTabTransferCompleted(handlers.transferCompleted),
  ];
  window.addEventListener('keydown', keydown, { capture: true });
  return () => {
    for (const remove of unsubscribe) remove();
    window.removeEventListener('keydown', keydown, { capture: true });
  };
}
