import type { DesktopPort } from '../ports/desktop-port';

const hasFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files');

export function installFolderDrop(
  shell: HTMLElement,
  desktop: DesktopPort,
  open: (path: string) => void,
): () => void {
  const over = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    shell.classList.add('is-folder-drop-target');
  };
  const leave = (event: DragEvent) => {
    if (event.relatedTarget === null) shell.classList.remove('is-folder-drop-target');
  };
  const drop = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    shell.classList.remove('is-folder-drop-target');
    const file = event.dataTransfer?.files.item(0);
    if (!file) return;
    const path = desktop.pathForFile(file);
    if (path) open(path);
  };
  window.addEventListener('dragover', over, { capture: true });
  window.addEventListener('dragleave', leave, { capture: true });
  window.addEventListener('drop', drop, { capture: true });
  return () => {
    window.removeEventListener('dragover', over, { capture: true });
    window.removeEventListener('dragleave', leave, { capture: true });
    window.removeEventListener('drop', drop, { capture: true });
  };
}
