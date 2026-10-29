import type { DesktopPort } from '../ports/desktop-port';

const hasFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files');

export function installFolderDrop(
  shell: HTMLElement,
  desktop: DesktopPort,
  open: (paths: string[]) => void,
): () => void {
  const clear = () => shell.classList.remove('is-folder-drop-target');
  const inExplorer = (event: DragEvent) => event.target instanceof Element
    && !!event.target.closest('#project-explorer-tree, .explorer-root');
  const over = (event: DragEvent) => {
    if (!hasFiles(event) || inExplorer(event)) { clear(); return; }
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    shell.classList.add('is-folder-drop-target');
  };
  const leave = (event: DragEvent) => {
    if (event.relatedTarget === null) clear();
  };
  const drop = (event: DragEvent) => {
    clear();
    if (!hasFiles(event) || inExplorer(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const paths = [...event.dataTransfer?.files ?? []].map(file => desktop.pathForFile(file)).filter(Boolean);
    if (paths.length) open(paths);
  };
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape') clear(); };
  // Own file opening outside the tree before editor/browser defaults can paste
  // the filename. The tree retains its own target-specific import handling.
  window.addEventListener('dragover', over, true);
  window.addEventListener('dragleave', leave, true);
  window.addEventListener('drop', drop, true);
  window.addEventListener('dragend', clear, true);
  window.addEventListener('blur', clear);
  window.addEventListener('keydown', key, true);
  return () => {
    clear();
    window.removeEventListener('dragover', over, true);
    window.removeEventListener('dragleave', leave, true);
    window.removeEventListener('drop', drop, true);
    window.removeEventListener('dragend', clear, true);
    window.removeEventListener('blur', clear);
    window.removeEventListener('keydown', key, true);
  };
}
