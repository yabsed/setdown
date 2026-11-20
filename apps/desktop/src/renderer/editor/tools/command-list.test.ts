import { expect, test } from 'vitest';
import { actionCommandId, commandRows, hereValue, recentCommands, recentCommandsKey, recordRecentCommand, type ListedCommand } from './command-list';

const commands: ListedCommand[] = [
  { id: 'setdown.history', label: 'Command history', detail: 'Commands' },
  { id: 'editor.action.revealDefinition', label: 'Go to Definition', detail: 'F12' },
  { id: 'editor.action.formatDocument', label: 'Format Document' },
  { id: 'editor.action.rename', label: 'Rename Symbol', detail: 'F2' },
  { id: 'setdown.tool.rust-analyzer.viewHir', label: 'rust-analyzer: View Hir' },
  { id: 'setdown.tool.rust-analyzer.expandMacro', label: 'rust-analyzer: Expand macro recursively at caret' },
  { id: 'setdown.tool.rust-analyzer.onEnter', label: 'rust-analyzer: Enhanced enter key' },
  { id: 'setdown.tool.gopls.import.add', label: 'Go: Add Import', disabled: 'Unavailable for the current editor.' },
  { id: 'setdown.language-problems', label: 'Show Problems in Open Files' },
];
const places = { here: [{ id: 'definition', label: 'Go to Definition', key: 'F12', action: 'editor.action.revealDefinition' }, { id: 'expand-macro', label: 'Expand Macro', action: 'setdown.tool.rust-analyzer.expandMacro' },
  { id: 'run:Run test', label: 'Run test' }], document: ['editor.action.formatDocument', 'setdown.language-problems', 'setdown.tool.gopls.import.add'], never: ['setdown.tool.rust-analyzer.onEnter'] };
const store = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; };

test('an empty list shows what was used lately and what applies here; nothing of a tool by name', () => {
  const { rows, total } = commandRows(commands, places, ['editor.action.rename', 'gone.command']);
  const empty = rows.filter(row => row.section && row.only !== 'typed');
  expect(empty.map(row => [row.section, row.label])).toEqual([['Recently used', 'Rename Symbol'], ['Here', 'Go to Definition'], ['Here', 'Expand Macro'], ['Here', 'Run test'],
    ['Here', 'Format Document'], ['Here', 'Show Problems in Open Files']]);
  // No line of the empty list starts with a tool's name, and a command that does not apply to this document is not offered as "here".
  expect(empty.some(row => /^(rust-analyzer|clangd|Go|Svelte|Java|Kotlin|Intelephense|JSON|YAML): /.test(row.label))).toBe(false);
  // A behaviour of a key is no row at all, typed or not.
  expect(rows.some(row => row.value === 'setdown.tool.rust-analyzer.onEnter')).toBe(false);
  // Typing searches every command once: a menu entry that is a listed command is found under the command's name.
  const typed = rows.filter(row => row.only !== 'empty');
  expect(total).toBe(typed.length);
  expect(typed.map(row => row.value)).toEqual([hereValue('run:Run test'), ...commands.filter(command => command.id !== 'setdown.tool.rust-analyzer.onEnter').map(command => command.id)]);
  expect(typed.filter(row => row.label === 'Go to Definition')).toHaveLength(1);
  // The tool's inner views are there for the person who types their name.
  expect(typed.some(row => row.label === 'rust-analyzer: View Hir' && !row.section)).toBe(true);
});

test('a command used lately is listed once, and only while it can run', () => {
  const used = commandRows(commands, places, ['editor.action.formatDocument', 'editor.action.revealDefinition', 'setdown.tool.gopls.import.add']);
  const empty = used.rows.filter(row => row.section && row.only !== 'typed');
  // The Go command cannot run in this document, so it is not offered; the two others are not repeated under "Here".
  expect(empty.map(row => [row.section, row.label])).toEqual([['Recently used', 'Format Document'], ['Recently used', 'Go to Definition'], ['Here', 'Expand Macro'], ['Here', 'Run test'], ['Here', 'Show Problems in Open Files']]);
  expect(commandRows(commands, { here: [], document: [], never: [] }, []).rows.some(row => row.section)).toBe(false);
});

test('a choice of the menu at the cursor that is no listed command is offered again where it applies, and nowhere else', () => {
  // "References" is the editor's own action: the list of commands does not have it, the menu at the cursor does.
  const references = { id: 'references', label: 'References', key: 'Shift+F12', action: 'editor.action.goToReferences' };
  const onSymbol = commandRows(commands, { ...places, here: [...places.here, references] }, ['editor.action.goToReferences']);
  const empty = onSymbol.rows.filter(row => row.section && row.only !== 'typed');
  expect(empty.filter(row => row.label === 'References').map(row => [row.section, row.detail, row.value])).toEqual([['Recently used', 'Shift+F12', hereValue('references')]]);
  // It is found by typing as well, once: there is no command of that name to find instead.
  expect(onSymbol.rows.filter(row => row.only !== 'empty' && row.label === 'References')).toHaveLength(1);
  // On a word the tool has nothing to say about, it is not offered: it would only answer "nothing here".
  expect(commandRows(commands, places, ['editor.action.goToReferences']).rows.some(row => row.label === 'References')).toBe(false);
});

test('a tool’s command for the document stands in the empty list without the tool’s name, and is found by typing under its own', () => {
  const go: ListedCommand[] = [...commands.filter(command => command.id !== 'setdown.tool.gopls.import.add'), { id: 'setdown.tool.gopls.import.add', label: 'Go: Add Import' }];
  const named = { ...places, plain: { 'setdown.tool.gopls.import.add': 'Add Import' } };
  const fresh = commandRows(go, named, []);
  const empty = (rows: typeof fresh.rows) => rows.filter(row => row.section && row.only !== 'typed').map(row => [row.section, row.label]);
  expect(empty(fresh.rows)).toContainEqual(['Here', 'Add Import']);
  expect(empty(fresh.rows).some(([, label]) => /^Go: /.test(label!))).toBe(false);
  // Typed, it is one row, under the name the Go extension gives it; the count of commands does not grow.
  const typed = fresh.rows.filter(row => row.only !== 'empty' && row.value === 'setdown.tool.gopls.import.add');
  expect(typed.map(row => row.label)).toEqual(['Go: Add Import']);
  expect(fresh.total).toBe(commandRows(go, places, []).total);
  // Used lately, it leads the list under that same plain name, once.
  const used = commandRows(go, named, ['setdown.tool.gopls.import.add']);
  expect(empty(used.rows).filter(([, label]) => label === 'Add Import')).toEqual([['Recently used', 'Add Import']]);
  expect(empty(used.rows).some(([, label]) => /^Go: /.test(label!))).toBe(false);
});

test('what was run by name is remembered, the latest first, without repeats', () => {
  const kept = store();
  expect(recentCommands(kept)).toEqual([]);
  for (const id of ['a', 'b', 'a', 'c']) recordRecentCommand(id, kept);
  expect(recentCommands(kept)).toEqual(['c', 'a', 'b']);
  for (let index = 0; index < 20; index++) recordRecentCommand(`n${index}`, kept);
  expect(recentCommands(kept)).toHaveLength(12);
  // What another version or a person left in the store never breaks the list.
  kept.setItem(recentCommandsKey, '{"not":"a list"}'); expect(recentCommands(kept)).toEqual([]);
  kept.setItem(recentCommandsKey, 'not json'); expect(recentCommands(kept)).toEqual([]);
  kept.setItem(recentCommandsKey, '["x", 7, null, "y"]'); expect(recentCommands(kept)).toEqual(['x', 'y']);
  expect(recentCommands(undefined)).toEqual([]);
});

test('an action added to one editor is known by its own id, not by the editor it was added to', () => {
  // What `getSupportedActions` reports for `addAction({ id: 'setdown.language-problems' })` on the editor "editor-3".
  expect(actionCommandId('editor-3:setdown.language-problems', 'editor-3')).toBe('setdown.language-problems');
  // The editor's own actions are reported as they are, and another editor's prefix is not this one's.
  expect(actionCommandId('editor.action.formatDocument', 'editor-3')).toBe('editor.action.formatDocument');
  expect(actionCommandId('editor-30:setdown.here', 'editor-3')).toBe('editor-30:setdown.here');
  expect(actionCommandId('editor-3:setdown.here', undefined)).toBe('editor-3:setdown.here');
});
