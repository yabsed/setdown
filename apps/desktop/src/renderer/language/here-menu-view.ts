import { gatherHere, type HereMenuSource } from './here-menu';

let leave: (() => void) | undefined;

/** Opens the menu at the cursor. It waits a moment for the tools, so that it opens complete; a
 * second request closes the first. Other surfaces are told while it is open, as for every
 * overlay of the app, and the keyboard goes back to the editor when it closes. */
export async function openHereMenu(source: HereMenuSource): Promise<void> {
  leave?.();
  let withdrawn = false;
  leave = () => { withdrawn = true; };
  const [{ mount, unmount }, { default: Component }, gathered] = await Promise.all([import('svelte'), import('./HereMenu.svelte'), gatherHere(source.probes)]);
  if (withdrawn || !source.alive()) return;
  let closed = false;
  const close = (restore = true) => {
    if (closed) return;
    closed = true;
    if (leave === dismiss) leave = undefined;
    void unmount(component);
    window.dispatchEvent(new CustomEvent('setdown:native-overlay-visibility', { detail: false }));
    if (restore) source.restore();
  };
  const dismiss = () => close(false);
  leave = dismiss;
  window.dispatchEvent(new CustomEvent('setdown:native-overlay-visibility', { detail: true }));
  const component = mount(Component, { target: document.body, props: { source, items: gathered.items, late: gathered.late, close } });
}
