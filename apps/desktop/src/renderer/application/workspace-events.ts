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
  const unsubscribe = [
    desktop.onPreviewMessage(handlers.previewMessage),
    desktop.onPreviewFindRequested(handlers.previewFindRequested),
    desktop.onDocumentOpened(handlers.documentOpened),
    desktop.onExternalChange(handlers.externalChange),
    desktop.onProjectFilesChanged(handlers.projectFilesChanged),
    desktop.onThemeChanged(handlers.themeChanged),
    desktop.onWindowCloseRequested(handlers.windowCloseRequested),
    desktop.onCommand(handlers.command),
    desktop.onSaveBeforeClose(handlers.saveBeforeClose),
    desktop.onTabTransferIncoming(handlers.transferIncoming),
    desktop.onTabTransferCompleted(handlers.transferCompleted),
  ];
  window.addEventListener('keydown', handlers.keydown, { capture: true });
  return () => {
    for (const remove of unsubscribe) remove();
    window.removeEventListener('keydown', handlers.keydown, { capture: true });
  };
}
