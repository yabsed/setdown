import { isComposingInput } from '../composition-guard';
import './editor-panel.css';
export type PanelItem<T> = { label: string; detail?: string; value: T; disabled?: string; keywords?: string };
let active: (() => void) | undefined;
export type CommandInputs = Record<string, string | number | boolean>;
let commandInputs: { previous: CommandInputs; current: CommandInputs } | undefined;
export async function captureCommandInputs<T>(previous: CommandInputs | undefined, run: () => Promise<T>): Promise<{ value: T; inputs: CommandInputs }> {
  const before = commandInputs, current: CommandInputs = {}; commandInputs = { previous: previous ?? {}, current };
  try { return { value: await run(), inputs: current }; } finally { commandInputs = before; }
}
function frame(title: string) {
  active?.();
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = document.createElement('dialog'); dialog.className = 'editor-tool-dialog'; dialog.setAttribute('aria-label', title);
  const heading = document.createElement('h2'); heading.textContent = title;
  const close = document.createElement('button'); close.type = 'button'; close.className = 'editor-tool-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Close');
  dialog.append(heading, close); document.body.append(dialog);
  let closed = false;
  const dispose = () => {
    if (closed) return; closed = true; if (active === cancel) active = undefined;
    dialog.close(); dialog.remove();
    window.dispatchEvent(new CustomEvent('setdown:native-overlay-visibility', { detail: false }));
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  };
  let canceled = () => {};
  const cancel = () => { dispose(); canceled(); };
  active = cancel; close.onclick = cancel;
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!isComposingInput(event as unknown as KeyboardEvent)) cancel(); });
  dialog.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape' && !isComposingInput(event)) { event.preventDefault(); cancel(); } });
  window.dispatchEvent(new CustomEvent('setdown:native-overlay-visibility', { detail: true }));
  dialog.showModal();
  return { dialog, dispose, canceled(callback: () => void) { canceled = callback; } };
}
export function choose<T>(title: string, items: PanelItem<T>[], placeholder = 'Search…', description?: string): Promise<T | null> {
  return new Promise(resolve => {
    const ui = frame(title); ui.canceled(() => resolve(null));
    if (description) { const metadata = document.createElement('p'); metadata.className = 'editor-tool-count'; metadata.textContent = description; ui.dialog.append(metadata); }
    const input = document.createElement('input'); input.type = 'search'; input.placeholder = placeholder; input.setAttribute('aria-label', placeholder);
    const list = document.createElement('div'); list.className = 'editor-tool-list'; list.setAttribute('role', 'listbox');
    const count = document.createElement('p'); count.className = 'editor-tool-count'; count.setAttribute('aria-live', 'polite');
    ui.dialog.append(input, count, list); let selected = Math.max(0, items.findIndex(item => item.value === commandInputs?.previous[title])), filtered = items;
    const accept = (item: PanelItem<T>) => {
      if (item.disabled) { count.textContent = item.disabled; return; }
      if (commandInputs && ['string', 'number', 'boolean'].includes(typeof item.value)) commandInputs.current[title] = item.value as string | number | boolean;
      ui.dispose(); resolve(item.value);
    };
    const render = () => {
      list.replaceChildren();
      count.textContent = `${filtered.length} ${filtered.length === 1 ? 'result' : 'results'}`;
      filtered.slice(0, 1000).forEach((item, index) => {
        const row = document.createElement('button'); row.type = 'button'; row.className = 'editor-tool-row'; row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(index === selected)); row.setAttribute('aria-disabled', String(!!item.disabled));
        const label = document.createElement('span'); label.textContent = item.label;
        const detail = document.createElement('small'); detail.textContent = item.disabled ?? item.detail ?? '';
        row.append(label, detail); row.onclick = () => accept(item); list.append(row);
      });
    };
    input.oninput = () => {
      const query = input.value.toLocaleLowerCase().trim();
      const score = (item: PanelItem<T>) => {
        const label = item.label.toLocaleLowerCase(), haystack = `${label} ${item.keywords ?? ''} ${item.detail ?? ''}`.toLocaleLowerCase();
        if (label.startsWith(query)) return 0;
        if (haystack.includes(query)) return 1;
        let at = 0; for (const character of query) { at = haystack.indexOf(character, at); if (at < 0) return Infinity; at++; } return 2;
      };
      filtered = items.map((item, index) => ({ item, index, score: score(item) })).filter(row => Number.isFinite(row.score))
        .sort((a, b) => a.score - b.score || a.index - b.index).map(row => row.item);
      selected = 0; render();
    };
    input.addEventListener('keydown', event => {
      if (isComposingInput(event)) return;
      if (event.key === 'Enter') { event.preventDefault(); if (filtered[selected]) accept(filtered[selected]); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); selected = Math.max(0, Math.min(Math.min(999, filtered.length - 1), selected + (event.key === 'ArrowDown' ? 1 : -1))); render(); list.children[selected]?.scrollIntoView({ block: 'nearest' }); }
    });
    render(); input.focus();
  });
}
export function ask(title: string, label: string, initial = '', options: { number?: boolean; min?: number; max?: number; allowEmpty?: boolean; preview?(value: string): void } = {}): Promise<string | null> {
  const key = `${title}: ${label}`, previous = commandInputs?.previous[key];
  if (typeof previous === 'string') initial = previous;
  return new Promise(resolve => {
    const ui = frame(title); ui.canceled(() => resolve(null));
    const form = document.createElement('form'), description = document.createElement('label'), input = document.createElement('input'), submit = document.createElement('button');
    description.textContent = label; input.type = options.number ? 'number' : 'text'; input.value = initial; input.required = !options.allowEmpty; input.maxLength = 4096;
    if (options.min !== undefined) input.min = String(options.min); if (options.max !== undefined) input.max = String(options.max);
    input.setAttribute('aria-label', label); submit.type = 'submit'; submit.textContent = 'Apply'; description.append(input); form.append(description, submit); ui.dialog.append(form);
    input.oninput = () => { if (!isComposingInput()) options.preview?.(input.value); };
    form.onsubmit = event => { event.preventDefault(); if (isComposingInput() || !form.reportValidity()) return; const value = input.value; if (commandInputs) commandInputs.current[key] = value; ui.dispose(); resolve(value); };
    input.focus(); input.select();
  });
}
export async function explain(title: string, lines: string[]): Promise<void> {
  await choose(title, lines.map(line => ({ label: line, value: line })), 'Filter details…');
}
