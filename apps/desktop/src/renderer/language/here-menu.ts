// The menu at the cursor: what can be done with the thing under it, and nothing else.
//
// Every language entry is an answer a tool gave for this very position (`language-here.ts`), so
// no entry can end in "not available here", and a word in a comment gets no language entry at
// all. The groups and their order are fixed, whatever the language; a tool adds entries, never a
// group and never its own name. This file is the menu's rules as plain data: what the entries
// are, in which order they stand, and how typing narrows them.

export type HereGroup = 'understand' | 'find' | 'change' | 'run' | 'edit';
export type HereItem = {
  /** Stable for one kind of entry (`definition`), so that a late answer keeps the selection. */
  id: string; group: HereGroup; label: string;
  /** The key that does the same without the menu. */
  key?: string;
  /** The editor action the entry runs, where it is one: the command list shows that action
   * under its own name instead of a second line for the entry. */
  action?: string;
  run(): void | Promise<void>;
};
export const hereGroups: readonly { id: HereGroup; title: string }[] = [
  { id: 'understand', title: 'Understand' }, { id: 'find', title: 'Find' }, { id: 'change', title: 'Change' }, { id: 'run', title: 'Run' }, { id: 'edit', title: 'Edit' }];

/** The entries in the menu's order: by group, and within a group as they were given. An entry
 * with an id that was already given is dropped: two tools that both know the definition make one line. */
export function arrangeHere(items: readonly HereItem[]): HereItem[] {
  const seen = new Set<string>(), unique = items.filter(item => !seen.has(item.id) && !!seen.add(item.id));
  return hereGroups.flatMap(group => unique.filter(item => item.group === group.id));
}
/** The entries whose label has every word that was typed. */
export function narrowHere(items: readonly HereItem[], query: string): HereItem[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return words.length ? items.filter(item => words.every(word => item.label.toLocaleLowerCase().includes(word))) : [...items];
}
/** The rows as they are drawn: a group's name stands beside its first entry only. */
export function hereRows(items: readonly HereItem[], query = ''): { item: HereItem; group?: string }[] {
  let previous: HereGroup | undefined;
  return narrowHere(arrangeHere(items), query).map(item => {
    const group = item.group !== previous ? hereGroups.find(entry => entry.id === item.group)!.title : undefined;
    previous = item.group;
    return { item, group };
  });
}
/** A title a tool wrote for a lens or an action, as a menu entry: without the symbol some tools
 * put in front (`▶︎ Run Test`), and starting with a capital like every other entry. */
export function hereLabel(title: string): string {
  const text = title.replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return text ? text[0].toLocaleUpperCase() + text.slice(1) : '';
}

/** What the menu is opened with. `probes` are the questions already sent to the tools: each
 * resolves with its entries and none rejects. */
export type HereMenuSource = {
  at: { x: number; y: number };
  /** The word or selection the menu is about. */
  subject?: string;
  /** Named while a tool has not answered yet ("Asking Rust…"). */
  language?: string;
  fixed: HereItem[];
  probes: Promise<HereItem[]>[];
  /** False once the document changed: answers for the old text are not offered. */
  alive(): boolean;
  /** Gives the keyboard back to the editor. */
  restore(): void;
  /** Called with the entry a person chose, after it ran. */
  chosen?(item: HereItem): void;
  /** Called once the menu is gone, however it went, and when it never opened. */
  closed?(): void;
};
/** How long the menu waits for every tool before it opens with what it has, and how long a
 * late answer may still fill in. A menu that opened complete never changes afterwards. */
export const hereBudget = { open: 250, late: 2500 } as const;

/** Waits for the probes within the budget. `late` is there only when some did not answer in time. */
export async function gatherHere(probes: readonly Promise<HereItem[]>[], budget: number = hereBudget.open): Promise<{ items: HereItem[]; late?: Promise<HereItem[]> }> {
  const settled: (HereItem[] | undefined)[] = probes.map(() => undefined);
  const each = probes.map((probe, index) => probe.then(items => { settled[index] = items; }, () => { settled[index] = []; }));
  await Promise.race([Promise.all(each), new Promise<void>(resolve => setTimeout(resolve, budget))]);
  const items = settled.flatMap(part => part ?? []);
  if (settled.every(part => part)) return { items };
  return { items, late: Promise.all(each).then(() => settled.flatMap(part => part ?? [])) };
}
