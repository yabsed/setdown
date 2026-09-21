/** A late layout settlement owns only the scroll offset it last installed.
 * User scrolling or a newer positioning command permanently supersedes it. */
export function ownScrollSettlement(read: () => readonly [number, number], apply: () => void): () => void {
  let installed: readonly [number, number] | undefined;
  let superseded = false;
  return () => {
    if (superseded) return;
    const current = read();
    if (installed && (Math.abs(current[0] - installed[0]) > 1 || Math.abs(current[1] - installed[1]) > 1)) {
      superseded = true;
      return;
    }
    apply();
    installed = read();
  };
}
