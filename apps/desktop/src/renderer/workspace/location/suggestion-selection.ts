/** Arrow keys in the address field walk its suggestion rows. -1 is the text
 * the user typed: stepping past either end of the list returns to it, so
 * showing a row's address in the field never loses that text. `step` is the
 * net number of presses: down is positive, up negative. */
export function stepSuggestion(selected: number, count: number, step: number): number {
  const slots = count + 1;
  return (((selected + 1 + step) % slots) + slots) % slots - 1;
}
