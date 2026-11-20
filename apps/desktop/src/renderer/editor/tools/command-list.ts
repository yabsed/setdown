import type { PanelItem } from './editor-panel';

// What the command list shows before anything is typed, and what typing searches.
//
// A list of every command the app has is a list nobody reads: it was 150 to 180 lines in
// alphabetical order. An empty list now shows two short things: what this person used lately, and
// what applies here (to the thing under the cursor and to this document). Everything else is one
// query away, under the name its author gave it; behaviours of a key are not commands at all.

/** One command as the list knows it. `disabled` says why it cannot run now. */
export type ListedCommand = { id: string; label: string; detail?: string; keywords?: string; disabled?: string };
/** An entry of the menu at the cursor, offered in the list as well. `action` names the listed
 * command it stands for, when it is one. */
export type HereCommand = { id: string; label: string; key?: string; action?: string };
/** `plain`: what a command is called while the list is empty, where that differs from its own
 * name: a tool's command for the document, without the tool's name in front. */
export type CommandPlaces = { here: readonly HereCommand[]; document: readonly string[]; never: readonly string[]; plain?: Readonly<Record<string, string>> };

export const recentCommandsKey = 'setdown.commands.recent';
const kept = 12, shown = 6;
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const store = (): Store | undefined => { try { return globalThis.localStorage; } catch { return undefined; } };

/** The commands this person ran by name, the latest first. */
export function recentCommands(storage: Pick<Storage, 'getItem'> | undefined = store()): string[] {
  try { const value: unknown = JSON.parse(storage?.getItem(recentCommandsKey) ?? '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, kept) : []; }
  catch { return []; }
}
export function recordRecentCommand(id: string, storage: Store | undefined = store()): void {
  try { storage?.setItem(recentCommandsKey, JSON.stringify([id, ...recentCommands(storage).filter(other => other !== id)].slice(0, kept))); }
  catch { /* A full or closed store only means the list starts without it. */ }
}
/** The value of a row that stands for an entry of the menu at the cursor. */
export const hereValue = (id: string): string => `here:${id}`;

/** The rows of the list. A row with a `section` is shown while nothing is typed; `only` keeps a
 * row to the empty list (a copy of a command under "Recently used") or to a search. */
export function commandRows(commands: readonly ListedCommand[], places: CommandPlaces, recent: readonly string[]): { rows: PanelItem<string>[]; total: number } {
  const never = new Set(places.never), listed = commands.filter(command => !never.has(command.id));
  const byId = new Map(listed.map(command => [command.id, command]));
  const row = (command: ListedCommand): PanelItem<string> => ({ label: command.label, detail: command.detail, keywords: command.keywords, value: command.id, disabled: command.disabled });
  // An entry of the menu at the cursor. One that is a listed command appears once in a search: under the command's own name.
  const hereRow = (item: HereCommand, section: string): PanelItem<string> => ({ label: item.label, detail: item.key, value: hereValue(item.id), section,
    ...(item.action && byId.has(item.action) ? { only: 'empty' as const } : {}) });
  const plain = (command: ListedCommand) => places.plain?.[command.id] ?? command.label;
  const hereOf = new Map(places.here.flatMap(item => item.action ? [[item.action, item] as const] : []));
  const recently = recent.flatMap((id): { id: string; row: PanelItem<string> }[] => {
    const command = byId.get(id), entry = hereOf.get(id);
    if (command) return command.disabled ? [] : [{ id, row: { ...row(command), label: plain(command), section: 'Recently used', only: 'empty' } }];
    // What was chosen in the menu at the cursor is not always a command of the list ("Go to
    // Definition" is the editor's own): it is offered again where the tool says it applies.
    return entry ? [{ id, row: hereRow(entry, 'Recently used') }] : [];
  }).slice(0, shown);
  const used = new Set(recently.map(item => item.id));
  const document = new Set(places.document);
  const rows: PanelItem<string>[] = [
    ...recently.map(item => item.row),
    ...places.here.filter(item => !(item.action && used.has(item.action))).map(item => hereRow(item, 'Here')),
    ...listed.flatMap(command => {
      if (!document.has(command.id) || command.disabled) return [row(command)];
      // Under another name while the list is empty, the command is two rows: that name there, its own in a search.
      if (plain(command) !== command.label) return [...(used.has(command.id) ? [] : [{ ...row(command), label: plain(command), section: 'Here', only: 'empty' as const }]), row(command)];
      return [{ ...row(command), section: 'Here', ...(used.has(command.id) ? { only: 'typed' as const } : {}) }];
    }),
  ];
  return { rows, total: rows.filter(item => item.only !== 'empty').length };
}

/** The id an action was registered under. The editor reports an action that was added to it
 * (`addAction`) as `<editor id>:<id>`, so that two editors can each have one; every list of
 * commands here, and what is remembered as recently used, speaks of the id itself. */
export const actionCommandId = (reported: string, editorId: string | undefined): string =>
  editorId && reported.startsWith(`${editorId}:`) ? reported.slice(editorId.length + 1) : reported;
