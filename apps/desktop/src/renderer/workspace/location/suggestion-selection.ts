/** Arrow keys in the address field walk its suggestion rows. -1 is the text
 * the user typed: stepping past either end of the list returns to it, so
 * showing a row's address in the field never loses that text. */
export function stepSuggestion(selected: number, count: number, step: 1 | -1): number {
  return (selected + 1 + step + count + 1) % (count + 1) - 1;
}
