// How well a row of a list answers what a person typed. Lower is better; `Infinity` is no match.
//
// A name that says the word comes before a row that only mentions it in its description: someone
// who types "symbol" is looking for "Go to Symbol…", not for a command whose small print lists
// "search, symbols, diagnostics". Rows of one rank keep the order the list gave them.
const letter = /[\p{L}\p{N}]/u;

/** `query` is already lower-cased and trimmed. `rest` is what the row says besides its name. */
export function matchRank(query: string, label: string, rest = ''): number {
  const name = label.toLocaleLowerCase();
  if (name.startsWith(query)) return 0;
  let inside = false;
  for (let at = name.indexOf(query); at >= 0; at = name.indexOf(query, at + 1)) {
    if (!letter.test(name[at - 1] ?? '')) return 1; // A word of the name starts with it.
    inside = true;
  }
  if (inside) return 2;
  const haystack = `${name} ${rest.toLocaleLowerCase()}`;
  if (haystack.includes(query)) return 3;
  let at = 0; for (const character of query) { at = haystack.indexOf(character, at); if (at < 0) return Infinity; at++; }
  return 4;
}
