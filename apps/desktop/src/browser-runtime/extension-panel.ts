import type { BrowserExtensionAction } from '../protocol/browser';
import type { ThemePalette } from '../core/theme/theme-catalog';
declare global { interface Window { extensionPanel: {
  context(): Promise<{ items: BrowserExtensionAction[]; appearance: 'light' | 'dark'; palette: ThemePalette }>;
  choose(id: string): Promise<void>;
} } }
void window.extensionPanel.context().then(({ items, appearance, palette }) => {
  const root = document.documentElement;
  root.style.colorScheme = appearance;
  for (const [key, value] of Object.entries({ canvas: palette.chrome, text: palette.mutedText, hover: palette.hover, border: palette.border })) {
    root.style.setProperty(`--${key}`, value);
  }
  const grid = document.createElement('div'); grid.className = 'strip'; grid.setAttribute('aria-label', 'Extensions'); grid.setAttribute('role', 'toolbar');
  for (const item of items) {
    const button = document.createElement('button'); button.title = item.title;
    button.setAttribute('aria-label', item.title); button.disabled = !item.enabled;
    const icon = document.createElement('span'); icon.className = 'icon';
    if (item.icon) { const image = document.createElement('img'); image.src = item.icon; image.alt = ''; icon.append(image); }
    else { icon.classList.add('fallback'); icon.textContent = item.title.slice(0, 1); }
    if (item.badge) { const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = item.badge.slice(0, 4); badge.style.backgroundColor = item.color; icon.append(badge); }
    button.append(icon); grid.append(button);
    button.onclick = () => { void window.extensionPanel.choose(item.id).catch(error => { button.title = String(error); }); };
  }
  document.body.append(grid);
  document.body.addEventListener('wheel', event => {
    if (document.body.scrollWidth <= document.body.clientWidth || !event.deltaY) return;
    event.preventDefault(); document.body.scrollLeft += event.deltaY;
  }, { passive: false });
  const buttons = [...grid.querySelectorAll('button:not(:disabled)')] as HTMLButtonElement[];
  document.addEventListener('keydown', event => {
    const offset = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (offset === undefined && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : index < 0 ? (offset! < 0 ? buttons.length - 1 : 0) : (index + (offset ?? 0) + buttons.length) % buttons.length]?.focus();
  });
  document.body.tabIndex = -1; document.body.focus();
});
