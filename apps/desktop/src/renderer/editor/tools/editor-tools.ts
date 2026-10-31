import type * as Monaco from 'monaco-editor';
import { CopyStore } from '../../../core/editor/copy-store';
import { ResultHistory, type ResultEntry, type ResultLocation } from '../../../core/editor/result-history';
import { textTarget, disjointSpans, type TextTarget } from '../../../core/editor/text-targets';
import { changeInteger, sortLines, reflowParagraph } from '../../../core/editor/text-transforms';
import { EditorCommandRegistry, type CommandContext, type EditorCommand } from './command-registry';
import { NavigationHistory, type EditorLocation } from './navigation-history';
import { choose, ask, explain } from './editor-panel';
import { isComposingInput } from '../composition-guard';
import { liveDocumentModels } from '../live-document-model';
import type { EditorPolicy } from '../../../protocol/editor-tools';
import MarkdownIt from 'markdown-it';
import { setDisplayOptions } from './view-display';

export type EditorToolsOptions = {
  resolve(model: Monaco.editor.ITextModel, editor?: Monaco.editor.ICodeEditor): { path: string; cellId?: string; viewId: string | null; groupId: string } | null;
  open(location: ResultLocation): Promise<void>;
  group(): string;
  root(): string | null;
  commands?(): EditorCommand[];
  settings?(context: CommandContext): Promise<string[]>;
  paths?(context: CommandContext, prefix: string): Promise<Array<{ label: string; text: string }>>;
  policy?(path: string): Promise<EditorPolicy>;
  spelling?(words: string[]): Promise<Array<{ word: string; suggestions: string[] }>>;
  learnWord?(word: string): Promise<void>;
  symbols?(model: Monaco.editor.ITextModel): Promise<Array<{ name: string; line: number; column: number; kind: number }>>;
  bindings?(): Promise<string[]>;
};
type Recipe = { title: string; apply(context: CommandContext): void };
export class EditorTools {
  readonly registry = new EditorCommandRegistry();
  readonly copies = new CopyStore();
  readonly results = new ResultHistory();
  readonly navigation: NavigationHistory;
  private focused: Monaco.editor.IStandaloneCodeEditor | null = null;
  private recipe: Recipe | undefined;
  private readonly watched = new WeakSet<Monaco.editor.ITextModel>();
  private readonly lastSelections = new WeakMap<Monaco.editor.ITextModel, string[]>();
  private alternate: string | null = null;
  private currentPath: string | null = null;
  private search: { query: string; matchCase: boolean; wholeWord: boolean } | undefined;
  private searchHighlight: Monaco.editor.IEditorDecorationsCollection | undefined;
  private wordScope: 'off' | 'currentDocument' | 'matchingDocuments' | 'allDocuments' = 'matchingDocuments';
  private scrollLink: Monaco.IDisposable | undefined;
  private findCharacter: { text: string; direction: -1 | 1 } | undefined;
  private readonly policies = new WeakMap<Monaco.editor.ITextModel, { baseline: Monaco.editor.TextModelResolvedOptions; policy?: EditorPolicy; local: boolean; epoch: number }>();
  constructor(private readonly api: typeof Monaco, private readonly options: EditorToolsOptions) {
    this.navigation = new NavigationHistory(api, location => this.openLocation(location));
    this.registerCommands();
    for (const command of options.commands?.() ?? []) this.registry.register(command);
    for (const editor of api.editor.getEditors()) this.install(editor as Monaco.editor.IStandaloneCodeEditor);
    api.editor.onDidCreateEditor(editor => this.install(editor as Monaco.editor.IStandaloneCodeEditor));
    liveDocumentModels.subscribe(event => {
      if (event.type === 'retargeted') {
        this.navigation.retarget(event.path, event.nextPath);
        for (const model of this.api.editor.getModels()) if (this.options.resolve(model)?.path === event.nextPath)
          void this.loadPolicy({ ...this.context(), model, resource: event.nextPath });
      }
      this.results.markStale(event.path);
    });
    for (const type of ['copy', 'cut'] as const) document.addEventListener(type, () => {
      const editor = this.focused;
      if (!editor?.hasTextFocus() || isComposingInput()) return;
      const context = this.context(editor); if (!context.model || (type === 'cut' && context.readOnly)) return;
      try { this.captureCopy(context, type === 'cut'); } catch (error) { this.registry.messages.push({ time: Date.now(), command: type, message: String(error) }); }
    }, true);
  }
  context(editor = this.focused): CommandContext {
    const host = editor?.getDomNode();
    if (!host?.getClientRects().length || getComputedStyle(host).visibility === 'hidden') editor = null;
    const model = editor?.getModel() ?? null, resource = model ? this.options.resolve(model, editor ?? undefined) : null;
    return { editor, model, resource: resource?.path ?? null, cellId: resource?.cellId,
      groupId: resource?.groupId ?? this.options.group(), viewId: resource?.viewId ?? null,
      version: model?.getVersionId() ?? 0, readOnly: !editor || editor.getOption(this.api.editor.EditorOption.readOnly), origin: 'user' };
  }
  private install(editor: Monaco.editor.IStandaloneCodeEditor): void {
    const listeners: Monaco.IDisposable[] = [];
    const focus = () => {
      this.focused = editor; const context = this.context(editor);
      if (context.resource && context.resource !== this.currentPath) { this.alternate = this.currentPath; this.currentPath = context.resource; }
      this.watch(context);
    };
    listeners.push(editor.onDidFocusEditorText(focus), editor.onDidChangeModel(() => this.watch(this.context(editor))),
      editor.onDidChangeCursorSelection(event => {
        const model = editor.getModel(); if (!model || !event.oldSelections?.some(range => !range.isEmpty())) return;
        const old = this.lastSelections.get(model) ?? [];
        this.lastSelections.set(model, model.deltaDecorations(old, event.oldSelections.map(range => ({ range,
          options: { description: 'Last selection', stickiness: this.api.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges } }))));
      }), editor.onDidPaste(event => this.flash(editor, [event.range])),
      editor.onDidDispose(() => { if (this.focused === editor) this.focused = null; for (const listener of listeners) listener.dispose(); }));
    this.watch(this.context(editor)); if (editor.hasTextFocus()) focus();
    editor.addAction?.({ id: 'setdown.commands', label: 'Setdown: Search Commands…', contextMenuGroupId: 'navigation', contextMenuOrder: 20,
      run: () => this.palette(editor) });
  }
  private watch(context: CommandContext): void {
    const model = context.model; if (!model || this.watched.has(model)) return;
    this.watched.add(model);
    this.policies.set(model, { baseline: model.getOptions(), local: false, epoch: 0 });
    void this.loadPolicy(context);
    const languageChanged = model.onDidChangeLanguage(() => {
      const resource = this.options.resolve(model); void this.loadPolicy({ ...context, model, resource: resource?.path ?? null });
    });
    const listener = model.onDidChangeContent(event => {
      const resource = this.options.resolve(model, this.focused ?? undefined);
      if (!resource || !event.changes.length) return;
      const change = event.changes.at(-1)!;
      const position = model.getPositionAt(Math.min(model.getValueLength(), change.rangeOffset + change.text.length));
      this.navigation.changed(model, { ...resource, uri: model.uri.toString(), line: position.lineNumber, column: position.column,
        text: model.getLineContent(position.lineNumber), version: model.getVersionId() });
      this.results.markStale(resource.path);
    });
    model.onWillDispose(() => { listener.dispose(); languageChanged.dispose(); });
  }
  private async loadPolicy(context: CommandContext): Promise<void> {
    const model = context.model, state = model && this.policies.get(model);
    if (!model || !state || !context.resource || !this.options.policy) return;
    const epoch = ++state.epoch;
    try {
      const policy = await this.options.policy(context.resource);
      if (model.isDisposed() || state.epoch !== epoch || state.local) return;
      state.policy = policy;
      model.updateOptions({ tabSize: policy.tabSize ?? state.baseline.tabSize, indentSize: policy.indentSize ?? state.baseline.indentSize,
        insertSpaces: policy.insertSpaces ?? state.baseline.insertSpaces });
    } catch (error) { this.registry.messages.push({ time: Date.now(), command: 'Editor settings', message: String(error) }); }
  }
  private location(context: CommandContext): EditorLocation | null {
    const position = context.editor?.getPosition();
    return context.model && context.resource && position ? { path: context.resource, uri: context.model.uri.toString(), cellId: context.cellId,
      groupId: context.groupId, viewId: context.viewId, line: position.lineNumber, column: position.column,
      text: context.model.getLineContent(position.lineNumber), version: context.model.getVersionId() } : null;
  }
  rememberJump(editor = this.focused): void { const context = this.context(editor), location = this.location(context); if (location && context.model) this.navigation.remember(context.model, location); }
  private async openLocation(location: EditorLocation): Promise<void> {
    if (isComposingInput()) throw Error('Finish composing text before navigating.');
    const model = this.api.editor.getModels().find(model => model.uri.toString() === location.uri);
    const editors = this.api.editor.getEditors().filter(editor => editor.getModel() === model && editor.getDomNode()?.getClientRects().length);
    const editor = editors.find(editor => model && this.options.resolve(model, editor)?.viewId === location.viewId)
      ?? editors.find(editor => model && this.options.resolve(model, editor)?.groupId === location.groupId);
    if (model && editor) {
      const resource = this.options.resolve(model, editor);
      if (!resource) throw Error('This cell or document is no longer available.');
      editor.setPosition({ lineNumber: location.line, column: location.column }); editor.revealLineInCenter(location.line); editor.focus(); return;
    }
    await this.options.open({ ...location, context: location.stale ? location.text : location.context });
  }
  async palette(editor = this.focused): Promise<void> {
    if (isComposingInput()) return;
    const context = this.context(editor);
    const commands = this.registry.list();
    const known = new Set(commands.map(command => command.id));
    const rows = commands.map(command => ({ label: command.title, detail: `${command.category} · ${command.detail}${command.key ? ` · ${command.key}` : ''}`,
      value: command.id, disabled: this.registry.disabled(command, context) }));
    for (const action of editor?.getSupportedActions() ?? []) if (!known.has(action.id) && action.id !== 'setdown.commands') rows.push({
      label: action.label, detail: `Monaco · ${action.id}`, value: action.id, disabled: action.isSupported() ? undefined : 'Unavailable for the current editor.' });
    const id = await choose('Commands', rows, 'Search commands…'); if (!id) return;
    try {
      if (known.has(id)) await this.registry.execute(id, context);
      else { this.valid(context, false); const action = context.editor?.getAction(id); if (!action?.isSupported()) throw Error('This action is no longer available.'); await action.run(); }
    } catch (error) { await explain('Command could not run', [error instanceof Error ? error.message : String(error)]); }
  }
  private valid(context: CommandContext, editing = true): void {
    if (isComposingInput()) throw Error('Text composition is in progress.');
    if (!context.editor || !context.model || context.model.isDisposed() || context.editor.getModel() !== context.model
      || context.model.getVersionId() !== context.version) throw Error('The document changed while this command was open. Run it again at the intended location.');
    if (editing && context.editor.getOption(this.api.editor.EditorOption.readOnly)) throw Error('This editor is read-only.');
  }
  private apply(context: CommandContext, edits: Monaco.editor.IIdentifiedSingleEditOperation[], highlight = false): void {
    this.valid(context);
    const unique = new Map<string, Monaco.editor.IIdentifiedSingleEditOperation>();
    for (const edit of edits) {
      const key = JSON.stringify(edit.range), previous = unique.get(key);
      if (previous && previous.text !== edit.text) throw Error('Two cursors request different edits to the same target.');
      unique.set(key, edit);
    }
    edits = [...unique.values()];
    disjointSpans(edits.map(edit => ({ start: context.model!.getOffsetAt({ lineNumber: edit.range.startLineNumber, column: edit.range.startColumn }),
      end: context.model!.getOffsetAt({ lineNumber: edit.range.endLineNumber, column: edit.range.endColumn }) })));
    context.editor!.pushUndoStop();
    const ranges: Monaco.IRange[] = [];
    const applied = context.editor!.executeEdits('setdown.command', edits, inverse => inverse.map(edit => {
      ranges.push(edit.range); return new this.api.Selection(edit.range.endLineNumber, edit.range.endColumn, edit.range.endLineNumber, edit.range.endColumn);
    }));
    if (!applied) throw Error('The editor did not accept this edit.');
    context.editor!.pushUndoStop(); context.version = context.model!.getVersionId();
    if (highlight) this.flash(context.editor!, ranges);
  }
  private flash(editor: Monaco.editor.IStandaloneCodeEditor, ranges: Monaco.IRange[]): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const model = editor.getModel(); if (!model) return;
    const decoration = editor.createDecorationsCollection(ranges.map(range => ({ range, options: { description: 'Copied or pasted text', className: 'setdown-edit-feedback' } })));
    const clear = () => { decoration.clear(); clearTimeout(timer); dispose.dispose(); };
    const timer = setTimeout(clear, 650), dispose = editor.onDidDispose(clear);
  }
  private selections(context: CommandContext): Monaco.Selection[] { this.valid(context, false); return context.editor!.getSelections() ?? []; }
  private span(context: CommandContext, kind: TextTarget, outer = false): Monaco.IRange[] {
    const model = context.model!;
    return this.selections(context).map(selection => {
      const target = textTarget(model.getValue(), model.getOffsetAt(selection.getPosition()), kind, outer);
      if (!target) throw Error(`No ${kind} target at this cursor.`);
      return this.api.Range.fromPositions(model.getPositionAt(target.start), model.getPositionAt(target.end));
    });
  }
  private copySelection(context: CommandContext) {
    const selections = this.selections(context), model = context.model!, lines = selections.every(selection => selection.isEmpty());
    const ranges = lines ? selections.map(selection => new this.api.Range(selection.startLineNumber, 1,
      Math.min(selection.startLineNumber + 1, model.getLineCount()), selection.startLineNumber === model.getLineCount() ? model.getLineMaxColumn(selection.startLineNumber) : 1)) : selections;
    return { ranges, fragments: ranges.map(range => model.getValueInRange(range)), kind: lines ? 'lines' as const : selections.length > 1 ? 'block' as const : 'characters' as const };
  }
  private captureCopy(context: CommandContext, cut = false): string | null {
    const { ranges, fragments, kind } = this.copySelection(context);
    const entry = this.copies.add(fragments, kind, context.resource ?? 'Untitled', cut);
    if (entry) this.flash(context.editor!, ranges); return entry?.id ?? null;
  }
  private async chooseCopy(title = 'Copy store'): Promise<string | null> {
    return choose(title, this.copies.list().map(entry => ({ label: `${entry.pinned ? '★ ' : ''}${entry.name ?? entry.fragments.join(' ↵ ').slice(0, 100)}`,
      detail: `${entry.kind} · ${entry.fragments.length} fragments · ${entry.path}`, value: entry.id })), 'Search saved text…');
  }
  private paste(context: CommandContext, id: string, combined = false): void {
    const selections = this.selections(context), entry = this.copies.get(id), texts = this.copies.paste(id, selections.length, combined);
    this.apply(context, selections.map((selection, index) => {
      const linewise = entry.kind === 'lines' && selection.isEmpty(), text = texts[index];
      return { range: linewise ? new this.api.Range(selection.startLineNumber, 1, selection.startLineNumber, 1) : selection,
        text: linewise && !text.endsWith('\n') ? text + context.model!.getEOL() : text };
    }), true);
  }
  private registerCommands(): void {
    const add = (id: string, title: string, category: string, detail: string, run: EditorCommand['run'], flags: Partial<EditorCommand> = {}) =>
      this.registry.register({ id: `setdown.${id}`, title, category, detail, needsEditor: true, run, ...flags });
    add('history', 'Command history', 'Commands', 'Only successful commands are listed.', async context => {
      const item = await choose('Command history', [...this.registry.history].reverse().filter(item => item.id !== 'setdown.history').map(item => ({ label: item.title,
        detail: `${new Date(item.time).toLocaleTimeString()} · ${Object.values(item.inputs).join(' · ')}`, value: item })));
      if (item) await this.registry.execute(item.id, { ...context, origin: 'history' }, item.inputs); else return false;
    }, { needsEditor: false });
    add('help', 'Command help and examples', 'Commands', 'Find a command, its scope, arguments and Undo behavior.', async context => {
      const selected = await choose('Command help', this.registry.list().map(command => ({ label: command.title, detail: command.category, value: command })));
      if (!selected) return false;
      const examples: Record<string, string> = {
        Selection: 'Place the cursor in a quoted string or Markdown link, then select inside or around it. Use Restore last selection after moving away.',
        Edit: 'Place the cursor on 009, run Increment integer, move to another number, then Repeat last semantic edit. Each completed edit has an Undo step.',
        Copy: 'Copy a paragraph, give it a name, then choose it from the copy store after editing elsewhere. Ordinary Delete leaves the last explicit copy intact.',
        Results: 'Search for A, search for B, then Previous result list returns to the captured A results without rerunning its query.',
        Navigation: 'Name a location before editing above it. Live bookmarks follow the original text; closed-file locations are checked before navigation.',
        Session: 'Save a workspace snapshot before closing. Restore is explicit; conflicting dirty text becomes a separate unsaved document.',
        Settings: 'Inspect effective settings to find the EditorConfig source, then reset a temporary file override to its inherited value.',
      };
      await explain(selected.title, [selected.detail, `Category: ${selected.category}`, `Availability: ${this.registry.disabled(selected, context) ?? 'Available'}`,
        `Shortcut: ${selected.key ?? 'Run from Commands'}`, `Repeat last semantic edit: ${selected.repeatable ? 'Supported after success' : 'Not registered for this command'}`,
        examples[selected.category] ?? 'Run from Commands in the intended group. Escape cancels a pending prompt. Arguments are validated before execution.']);
    }, { needsEditor: false });
    add('messages', 'Show command messages', 'Commands', 'Review recent failures and their reasons.', () => explain('Command messages', this.registry.messages.map(item => `${new Date(item.time).toLocaleTimeString()} · ${item.command}: ${item.message}`)), { needsEditor: false });
    add('bindings', 'Inspect keyboard commands', 'Commands', 'App bindings, scope and current availability.', async context => {
      await explain('Keyboard commands', ['Ctrl/Cmd+Shift+P · Commands · app (outside IME)', 'Escape · popup → composition → source/reader (focused surface)',
        'Monaco editor shortcuts: use the built-in command entries; key bindings are scoped to the active editor.',
        ...(await this.options.bindings?.() ?? []),
        ...this.registry.list().filter(command => command.key).map(command => `${command.key} · ${command.title} · ${this.registry.disabled(command, context) ?? 'Available'}`)]);
    }, { needsEditor: false });
    add('settings', 'Show effective settings for this file', 'Settings', 'Values, sources, format and inherited defaults.', async context => {
      const model = context.model!;
      await explain('Effective editor settings', [`Resource: ${context.resource ?? model.uri.toString()}`, `Language: ${model.getLanguageId()}`,
        `Read-only: ${context.readOnly}`, `Indent size: ${model.getOptions().indentSize}`, `Tab width: ${model.getOptions().tabSize}`,
        `Insert spaces: ${model.getOptions().insertSpaces}`, `Line endings: ${JSON.stringify(model.getEOL())}`,
        `Word completion source: ${this.wordScope} · workspace Monaco setting`,
        `Local override: ${this.policies.get(model)?.local ? 'This buffer' : 'Inherited / detected'}`,
        ...(this.policies.get(model)?.policy?.settings.map(setting => `${setting.key} = ${setting.value} · ${setting.source}${setting.supported ? '' : ' · Reported only'}`) ?? []),
        ...(this.policies.get(model)?.policy?.warnings ?? []),
        ...(await this.options.settings?.(context) ?? [])]);
    });
    add('settings.local', 'Set indentation for this file…', 'Settings', 'Temporary buffer override shared by its views.', async context => {
      const kind = await choose('Indentation style', [{ label: 'Spaces', value: true }, { label: 'Tabs', value: false }]); if (kind === null) return false;
      const size = await ask('Indentation width', 'Columns', String(context.model!.getOptions().tabSize), { number: true, min: 1, max: 16 }); if (!size) return false;
      this.valid(context, false); if (!Number.isInteger(Number(size))) throw Error('Use a whole number of columns.');
      const state = this.policies.get(context.model!); if (state) state.local = true;
      context.model!.updateOptions({ tabSize: Number(size), indentSize: Number(size), insertSpaces: kind });
    });
    add('settings.inherit', 'Reset this file to inherited settings', 'Settings', 'Removes the temporary override and rereads EditorConfig.', async context => {
      const state = this.policies.get(context.model!); if (state) state.local = false; await this.loadPolicy(context);
    });
    add('settings.eol', 'Convert line endings…', 'Settings', 'Explicit UTF-8 text conversion, with Undo; saving preserves BOM.', async context => {
      const value = await choose('Line endings', [{ label: 'LF', value: '\n' }, { label: 'CRLF', value: '\r\n' }]); if (!value) return false;
      this.valid(context); context.editor!.pushUndoStop(); context.model!.pushEOL(value === '\n' ? this.api.editor.EndOfLineSequence.LF : this.api.editor.EndOfLineSequence.CRLF); context.editor!.pushUndoStop();
    }, { mutates: true });
    for (const [kind, title] of [['word', 'word'], ['chunk', 'whitespace-delimited word'], ['quote', 'quoted string'], ['paragraph', 'paragraph'], ['sentence', 'sentence'],
      ['section', 'Markdown section'], ['fence', 'fenced code'], ['list-item', 'Markdown list item'], ['link-label', 'link label'], ['link-destination', 'link destination'], ['table-cell', 'table cell']] as Array<[TextTarget, string]>) {
      for (const outer of [false, true]) add(`select.${kind}.${outer ? 'around' : 'inside'}`, `Select ${outer ? 'around' : 'inside'} ${title}`, 'Selection', 'Selects a semantic range at every cursor.', context => {
        const ranges = this.span(context, kind, outer); context.editor!.setSelections(ranges.map(range => new this.api.Selection(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn)));
      });
    }
    add('selection.restore', 'Restore last selection', 'Selection', 'Tracked ranges follow intervening edits.', context => {
      const ranges = (this.lastSelections.get(context.model!) ?? []).flatMap(id => context.model!.getDecorationRange(id) ?? []);
      if (!ranges.length) throw Error('No previous selection in this document.');
      context.editor!.setSelections(ranges.map(range => new this.api.Selection(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn)));
    });
    add('selection.reverse', 'Move to the other end of the selection', 'Selection', 'Preserves the selected range.', context => {
      context.editor!.setSelections(this.selections(context).map(selection => new this.api.Selection(selection.positionLineNumber, selection.positionColumn, selection.selectionStartLineNumber, selection.selectionStartColumn)));
    });
    for (const operation of ['copy', 'delete'] as const) add(`target.${operation}`, `${operation === 'copy' ? 'Copy' : 'Delete'} a structured target…`, 'Selection', 'Choose one target; overlapping edits are rejected.', async context => {
      const target = await choose('Text target', (['word', 'quote', 'paragraph', 'section', 'link-destination'] as TextTarget[]).map(value => ({ label: value, value })));
      if (!target) return false; this.valid(context, operation === 'delete'); const ranges = this.span(context, target);
      if (operation === 'copy') this.copies.add(ranges.map(range => context.model!.getValueInRange(range)), 'characters', context.resource ?? 'Untitled');
      else {
        this.copies.add(ranges.map(range => context.model!.getValueInRange(range)), ranges.length > 1 ? 'block' : 'characters', context.resource ?? 'Untitled', true);
        this.apply(context, ranges.map(range => ({ range, text: '' })));
        this.recipe = { title: `Delete ${target}`, apply: next => this.apply(next, this.span(next, target).map(range => ({ range, text: '' }))) };
      }
    }, { mutates: operation === 'delete' });
    add('copy.name', 'Copy and name the selection…', 'Copy', 'Memory only; explicit copies survive ordinary Delete.', async context => {
      const name = await ask('Named copy', 'Name'); if (!name) return false; this.valid(context, false);
      const id = this.captureCopy(context); if (id) this.copies.name(id, name);
    });
    add('copy.paste', 'Paste from copy store…', 'Copy', 'Preserves fragment order, line endings and Undo.', async context => { const id = await this.chooseCopy(); if (!id) return false; this.paste(context, id); }, { mutates: true });
    add('copy.combined', 'Paste a combined copy…', 'Copy', 'Explicitly broadcasts combined fragments to each cursor.', async context => { const id = await this.chooseCopy(); if (!id) return false; this.paste(context, id, true); }, { mutates: true });
    add('copy.last', 'Paste last explicit copy', 'Copy', 'Cut and ordinary Delete do not replace this value.', context => { if (!this.copies.lastCopy) throw Error('Nothing has been copied yet.'); this.paste(context, this.copies.lastCopy); }, { mutates: true });
    add('copy.manage', 'Manage copy store…', 'Copy', 'Name, append, pin or delete a retained copy.', async context => {
      const id = await this.chooseCopy(); if (!id) return false;
      const action = await choose('Copy actions', ['Name', 'Append selection', 'Pin / unpin', 'Delete'].map(value => ({ label: value, value })));
      if (action === 'Delete') this.copies.remove(id);
      if (action === 'Pin / unpin') this.copies.pin(id, !this.copies.get(id).pinned);
      if (action === 'Name') { const name = await ask('Name copy', 'Name', this.copies.get(id).name); if (name) this.copies.name(id, name); }
      if (action === 'Append selection') { const { fragments, kind } = this.copySelection(context); this.copies.append(id, fragments, kind); }
    }, { needsEditor: false });
    for (const [id, title, direction] of [['back', 'Previous navigation location', -1], ['forward', 'Next navigation location', 1]] as const)
      add(`jump.${id}`, title, 'Navigation', 'Independent of tab URL history; internal scrolling adds no entries.', async context => {
        const location = this.location(context); await this.navigation.move(direction, location && context.model ? { location, model: context.model } : undefined);
      }, { needsEditor: false });
    add('change.previous', 'Go to last edit / previous change', 'Navigation', 'Continuous typing is grouped.', () => this.navigation.change(-1), { needsEditor: false });
    add('change.next', 'Go to next change', 'Navigation', 'Walk the document change locations.', () => this.navigation.change(1), { needsEditor: false });
    add('mark.set', 'Name this location…', 'Navigation', 'Bookmarks follow edits in live models.', async context => {
      const name = await ask('Bookmark location', 'Name'); if (!name) return false; this.valid(context, false);
      const location = this.location(context); if (location) this.navigation.mark(name, context.model!, location);
    });
    add('mark.open', 'Go to a named location…', 'Navigation', 'Closed documents are revalidated; deleted cells are rejected.', async () => {
      const target = await choose('Named locations', this.navigation.marked().map(item => ({ label: item.name, detail: `${item.location.path}:${item.location.line}${item.location.stale ? ' · Verify location' : ''}`, value: item.location })));
      if (target) await this.openLocation(target); else return false;
    }, { needsEditor: false });
    add('alternate', 'Switch to alternate file', 'Navigation', 'Toggles the last two files, independently of tab order.', async () => { if (!this.alternate) throw Error('No alternate file yet.'); await this.options.open({ path: this.alternate, line: 1, column: 1 }); }, { needsEditor: false });
    for (const where of ['center', 'top', 'bottom'] as const) add(`reveal.${where}`, `Place cursor at screen ${where}`, 'View', 'Moves the viewport without adding a navigation entry.', context => {
      const editor = context.editor!, position = editor.getPosition()!;
      editor.setScrollTop(editor.getTopForPosition(position.lineNumber, position.column) - editor.getLayoutInfo().height * (where === 'top' ? .05 : where === 'bottom' ? .9 : .5));
    });
    this.registerTransforms(add);
    this.registerResults(add);
    this.registerCompletion(add);
    this.registerSearch(add);
  }
  private registerTransforms(add: (id: string, title: string, category: string, detail: string, run: EditorCommand['run'], flags?: Partial<EditorCommand>) => unknown): void {
    const repeat = (context: CommandContext, recipe: Recipe) => { recipe.apply(context); this.recipe = recipe; };
    add('repeat', 'Repeat last semantic edit', 'Edit', 'Repeats a successful transform at the current targets, as one Undo step.', async context => {
      if (!this.recipe) throw Error('No repeatable edit yet.'); await this.recipe.apply({ ...context, origin: 'repeat' });
    }, { mutates: true, available: () => this.recipe ? undefined : 'Run a number, line, paragraph or target replacement command first.' });
    add('repeat.count', 'Repeat the last semantic edit several times…', 'Edit', 'Runs the recorded command 1–100 times; each completed edit has its own Undo step.', async context => {
      if (!this.recipe) throw Error('No repeatable edit yet.');
      const value = await ask('Repeat edit', 'Repetitions', '2', { number: true, min: 1, max: 100 }); if (!value) return false;
      const count = Number(value); if (!Number.isInteger(count) || count < 1 || count > 100) throw Error('Choose 1–100 repetitions.');
      for (let index = 0; index < count; index++) this.recipe.apply(context);
    }, { mutates: true });
    for (const amount of [-1, 1]) add(`number.${amount > 0 ? 'increment' : 'decrement'}`, `${amount > 0 ? 'Increment' : 'Decrement'} integer`, 'Edit', 'Decimal and explicitly prefixed integers; preserves padding and uses exact arithmetic.', context => {
      repeat(context, { title: 'Change integer', apply: next => {
        const edits = this.selections(next).map(selection => {
          const change = changeInteger(next.model!.getValue(), next.model!.getOffsetAt(selection.getPosition()), amount);
          if (!change) throw Error('No integer at or after this cursor on the same line.');
          return { range: this.api.Range.fromPositions(next.model!.getPositionAt(change.start), next.model!.getPositionAt(change.end)), text: change.text };
        }); this.apply(next, edits);
      } });
    }, { mutates: true, repeatable: true });
    add('number.sequence', 'Insert a number sequence at cursors…', 'Edit', 'Uses cursor order and a validated integer start and step.', async context => {
      const start = await ask('Number sequence', 'First integer', '1', { number: true }); if (start === null) return false;
      const step = await ask('Number sequence', 'Step', '1', { number: true }); if (step === null) return false;
      if (!/^[+-]?\d+$/.test(start) || !/^[+-]?\d+$/.test(step)) throw Error('Use whole numbers.');
      repeat(context, { title: 'Insert number sequence', apply: next => this.apply(next, this.selections(next).map((range, index) => ({ range, text: String(BigInt(start) + BigInt(step) * BigInt(index)) }))) });
    }, { mutates: true, repeatable: true });
    const lineRanges = (context: CommandContext) => this.selections(context).map(selection => {
      const end = selection.endLineNumber > selection.startLineNumber && selection.endColumn === 1 ? selection.endLineNumber - 1 : selection.endLineNumber;
      return new this.api.Range(selection.startLineNumber, 1, end, context.model!.getLineMaxColumn(end));
    });
    for (const mode of ['numeric', 'unique', 'stable-unique'] as const) add(`sort.${mode}`, mode === 'numeric' ? 'Sort lines by numeric value' : mode === 'unique' ? 'Sort and remove duplicate lines' : 'Remove duplicate lines, keeping order', 'Edit', 'Operates on selected whole lines; preserves document line endings.', context => {
      repeat(context, { title: `Sort ${mode}`, apply: next => this.apply(next, lineRanges(next).map(range => ({ range, text: sortLines(next.model!.getValueInRange(range), mode, next.model!.getEOL()) }))) });
    }, { mutates: true, repeatable: true });
    add('join.compact', 'Join selected lines without spaces', 'Edit', 'Removes line endings and indentation; one Undo restores all cursors.', context => {
      repeat(context, { title: 'Join lines without spaces', apply: next => this.apply(next, lineRanges(next).map(range => ({ range, text: next.model!.getValueInRange(range).replace(/\r?\n\s*/g, '') }))) });
    }, { mutates: true, repeatable: true });
    add('reflow', 'Reflow prose paragraph…', 'Edit', 'Wraps plain prose; structured Markdown and hard breaks are protected.', async context => {
      const width = await ask('Reflow prose', 'Width in characters', '80', { number: true, min: 20, max: 500 }); if (width === null) return false;
      repeat(context, { title: 'Reflow prose', apply: next => this.apply(next, this.span(next, 'paragraph').map(range => ({ range, text: reflowParagraph(next.model!.getValueInRange(range), Number(width), next.model!.getEOL()) }))) });
    }, { mutates: true, repeatable: true });
    add('replace.target', 'Replace a structured target…', 'Edit', 'Records the target and replacement, never raw key events.', async context => {
      const target = await choose('Replace target', (['word', 'quote', 'paragraph', 'link-label', 'link-destination', 'table-cell'] as TextTarget[]).map(value => ({ label: value, value })));
      if (!target) return false;
      const text = await ask('Replacement', 'New text', '', { allowEmpty: true }); if (text === null) return false;
      repeat(context, { title: `Replace ${target}`, apply: next => this.apply(next, this.span(next, target).map(range => ({ range, text })), true) });
    }, { mutates: true, repeatable: true });
    add('lines.matching', 'Transform matching lines…', 'Edit', 'Literal match within the selection or document; previews affected lines before applying.', async context => {
      const needle = await ask('Matching lines', 'Literal text'); if (!needle) return false;
      const operation = await choose('Line operation', ['Delete', 'Uppercase', 'Lowercase', 'Trim trailing spaces'].map(value => ({ label: value, value }))); if (!operation) return false;
      this.valid(context); const model = context.model!, selected = this.selections(context);
      const full = selected.every(range => range.isEmpty()), lines = new Set<number>();
      for (let line = 1; line <= model.getLineCount(); line++) if ((full || selected.some(range => line >= range.startLineNumber && line <= range.endLineNumber - (range.endColumn === 1 && range.endLineNumber > range.startLineNumber ? 1 : 0))) && model.getLineContent(line).includes(needle)) lines.add(line);
      if (!lines.size) throw Error('No lines match.');
      const confirmed = await choose(`Apply ${operation.toLowerCase()} to ${lines.size} lines?`, [{ label: 'Apply one Undo step', detail: [...lines].slice(0, 8).map(line => `${line}: ${model.getLineContent(line)}`).join(' · '), value: true }, { label: 'Cancel', value: false }]);
      if (!confirmed) return false; this.valid(context);
      const edits = [...lines].map(line => {
        const text = model.getLineContent(line), range = new this.api.Range(line, 1, line, model.getLineMaxColumn(line));
        if (operation === 'Delete') return { range: line < model.getLineCount() ? new this.api.Range(line, 1, line + 1, 1) : range, text: '' };
        return { range, text: operation === 'Uppercase' ? text.toLocaleUpperCase() : operation === 'Lowercase' ? text.toLocaleLowerCase() : text.trimEnd() };
      }); this.apply(context, edits);
    }, { mutates: true });
    const find = (context: CommandContext, text: string, direction: -1 | 1) => {
      const selections = this.selections(context).map(selection => {
        const position = selection.getPosition(), line = context.model!.getLineContent(position.lineNumber), offset = position.column - 1;
        const found = direction > 0 ? line.indexOf(text, offset + 1) : line.lastIndexOf(text, offset - 1);
        if (found < 0 || direction < 0 && found >= offset) throw Error('No further occurrence on this line.');
        return new this.api.Selection(position.lineNumber, found + 1, position.lineNumber, found + 1);
      }); context.editor!.setSelections(selections);
    };
    for (const direction of [-1, 1] as const) add(`find-character.${direction}`, `Find character ${direction > 0 ? 'forward' : 'backward'} on line…`, 'Navigation', 'Unicode text, confined to each cursor’s line.', async context => {
      const text = await ask('Find character', 'Character or text'); if (!text) return false; find(context, text, direction); this.findCharacter = { text, direction };
    });
    for (const reverse of [false, true]) add(`find-character.repeat${reverse ? '-reverse' : ''}`, `Repeat character search${reverse ? ' in reverse' : ''}`, 'Navigation', 'Uses the last successful line search.', context => {
      if (!this.findCharacter) throw Error('No character search yet.'); find(context, this.findCharacter.text, (reverse ? -this.findCharacter.direction : this.findCharacter.direction) as -1 | 1);
    });
  }
  recordResults(title: string, provider: string, entries: ResultEntry[], query = '', group = this.options.group(), truncated = false): void {
    try { this.results.add({ title, provider, entries, query, group, root: this.options.root(), truncated }); }
    catch (error) { this.registry.messages.push({ time: Date.now(), command: title, message: String(error) }); }
  }
  private async showResults(id?: string): Promise<void> {
    const snapshot = id ? this.results.select(id) : this.results.current(this.options.group());
    if (!snapshot) throw Error('No result list for this group yet.');
    const index = await choose(`${snapshot.title}${snapshot.stale ? ' · Locations may have changed' : ''}${snapshot.truncated ? ' · Truncated' : ''}`, snapshot.entries.map((entry, value) => ({ label: entry.label, detail: entry.detail, value })), 'Search…', `${snapshot.provider} · ${snapshot.root ?? 'No project'} · ${new Date(snapshot.created).toLocaleString()} · ${snapshot.entries.length} entries · version ${snapshot.version}`);
    if (index === null) return;
    snapshot.selected = index; await this.openResult(snapshot.entries[index]);
  }
  private async openResult(entry: ResultEntry): Promise<void> {
    this.rememberJump();
    if (entry.location) await this.options.open({ ...entry.location, groupId: this.results.current(this.options.group())?.group }); else if (entry.open) await entry.open();
    else throw Error('This result has no navigable location.');
  }
  private registerResults(add: (id: string, title: string, category: string, detail: string, run: EditorCommand['run'], flags?: Partial<EditorCommand>) => unknown): void {
    add('results.history', 'Choose a previous result list…', 'Results', 'Search, symbols, diagnostics and task results retain separate snapshots per group.', async () => {
      const id = await choose('Result history', this.results.list(this.options.group()).slice().reverse().map(snapshot => ({ label: `${snapshot.pinned ? '★ ' : ''}${snapshot.title}`, detail: `${snapshot.provider} · ${snapshot.entries.length} results${snapshot.stale ? ' · Stale' : ''} · ${snapshot.query}`, value: snapshot.id })));
      if (id) await this.showResults(id); else return false;
    }, { needsEditor: false });
    add('results.show', 'Show current result list', 'Results', 'Keeps the original query and location context.', () => this.showResults(), { needsEditor: false });
    for (const direction of [-1, 1] as const) {
      add(`results.list.${direction}`, `${direction < 0 ? 'Previous' : 'Next'} result list`, 'Results', 'Returns to an earlier query without rerunning it.', async () => { const snapshot = this.results.move(this.options.group(), direction); if (snapshot) await this.showResults(snapshot.id); }, { needsEditor: false });
      add(`results.item.${direction}`, `${direction < 0 ? 'Previous' : 'Next'} result`, 'Results', 'Navigates within the current snapshot.', async () => {
        const snapshot = this.results.current(this.options.group()); if (!snapshot?.entries.length) throw Error('No results in this group.');
        snapshot.selected = Math.max(0, Math.min(snapshot.entries.length - 1, snapshot.selected + direction)); await this.openResult(snapshot.entries[snapshot.selected]);
      }, { needsEditor: false });
    }
    for (const direction of [-1, 1] as const) add(`results.file.${direction}`, `${direction < 0 ? 'Previous' : 'Next'} file in result list`, 'Results', 'Skips other locations in the current file without rerunning the provider.', async () => {
      const snapshot = this.results.current(this.options.group()); if (!snapshot?.entries.length) throw Error('No results in this group.');
      const path = snapshot.entries[snapshot.selected]?.location?.path;
      for (let index = snapshot.selected + direction; index >= 0 && index < snapshot.entries.length; index += direction) {
        const entry = snapshot.entries[index]; if (entry.location && entry.location.path !== path) { await this.openResult(entry); snapshot.selected = index; return; }
      }
      throw Error('No further file in this result list.');
    }, { needsEditor: false });
    add('results.pin', 'Pin / unpin current result list', 'Results', 'Pinned lists survive bounded history eviction.', () => {
      const current = this.results.current(this.options.group()); if (!current) throw Error('No current result list.'); this.results.pin(current.id, !current.pinned);
    }, { needsEditor: false });
    add('results.filter', 'Filter current result list…', 'Results', 'Creates a derived list and preserves the original.', async () => {
      const current = this.results.current(this.options.group()); if (!current) throw Error('No current result list.');
      const query = await ask('Filter results', 'Contains'); if (!query) return false; await this.showResults(this.results.filter(current.id, query).id);
    }, { needsEditor: false });
  }
  private registerSearch(add: (id: string, title: string, category: string, detail: string, run: EditorCommand['run'], flags?: Partial<EditorCommand>) => unknown): void {
    const matches = (context: CommandContext, search = this.search) => {
      if (!search) throw Error('Start a smart search first.');
      return context.model!.findMatches(search.query, false, false, search.matchCase, search.wholeWord ? context.editor!.getOption(this.api.editor.EditorOption.wordSeparators) : null, false, 10000);
    };
    const next = (context: CommandContext, direction: -1 | 1) => {
      const found = matches(context), selection = context.editor!.getSelection()!;
      if (!found.length) throw Error('No matches.');
      const offset = context.model!.getOffsetAt(direction > 0 ? selection.getEndPosition() : selection.getStartPosition());
      const match = direction > 0 ? found.find(match => context.model!.getOffsetAt(match.range.getStartPosition()) >= offset && !match.range.equalsRange(selection)) ?? found[0]
        : [...found].reverse().find(match => context.model!.getOffsetAt(match.range.getEndPosition()) <= offset && !match.range.equalsRange(selection)) ?? found.at(-1)!;
      this.rememberJump(context.editor); context.editor!.setSelection(match.range); context.editor!.revealRangeInCenter(match.range);
    };
    add('search.smart', 'Find literal text with smart case…', 'Search', 'Uppercase in the query enables case matching. Uses literal text and reports a bounded result list.', async context => {
      const saved = context.editor!.saveViewState(), position = context.editor!.getPosition()!;
      const query = await ask('Smart search', 'Literal text', this.search?.query ?? '', { preview: value => {
        if (!value || context.model!.isDisposed() || context.model!.getVersionId() !== context.version) return;
        const found = matches(context, { query: value, matchCase: value.toLocaleLowerCase() !== value, wholeWord: false });
        const target = found.find(match => match.range.startLineNumber >= position.lineNumber) ?? found[0];
        if (target) { context.editor!.setSelection(target.range); context.editor!.revealRangeInCenter(target.range); }
      } });
      if (!context.model!.isDisposed() && context.editor!.getModel() === context.model) context.editor!.restoreViewState(saved);
      if (!query) return false;
      this.valid(context, false); this.search = { query, matchCase: query.toLocaleLowerCase() !== query, wholeWord: false };
      const found = matches(context);
      this.searchHighlight?.clear();
      this.searchHighlight = context.editor!.createDecorationsCollection(found.slice(0, 1000).map(match => ({ range: match.range, options: { inlineClassName: 'setdown-search-highlight' } })));
      this.recordResults(`Find: ${query}`, 'File search', found.map(match => ({ label: `${match.range.startLineNumber}: ${context.model!.getLineContent(match.range.startLineNumber)}`,
        detail: context.resource ?? 'Untitled', location: context.resource ? { path: context.resource, cellId: context.cellId, line: match.range.startLineNumber, column: match.range.startColumn,
          endLine: match.range.endLineNumber, endColumn: match.range.endColumn, version: context.version, context: context.model!.getLineContent(match.range.startLineNumber) } : undefined })), query, context.groupId, found.length >= 10000);
      next(context, 1);
    });
    add('search.hide', 'Hide smart-search highlights', 'Search', 'Keeps the query for next/previous and replacement.', () => { this.searchHighlight?.clear(); this.searchHighlight = undefined; });
    for (const direction of [-1, 1] as const) {
      add(`search.word.${direction}`, `Find ${direction > 0 ? 'next' : 'previous'} occurrence of this word`, 'Search', 'Literal whole-word search, independent of regular expression syntax.', context => {
        const word = context.model!.getWordAtPosition(context.editor!.getPosition()!); if (!word) throw Error('Place the cursor on a word.');
        this.search = { query: word.word, matchCase: true, wholeWord: true };
        context.editor!.setSelection(new this.api.Range(context.editor!.getPosition()!.lineNumber, word.startColumn, context.editor!.getPosition()!.lineNumber, word.endColumn));
        next(context, direction);
      });
      add(`search.next.${direction}`, `${direction > 0 ? 'Next' : 'Previous'} smart-search match`, 'Search', 'Wraps at the document boundary and selects the match.', context => next(context, direction));
    }
    add('search.replace-next', 'Replace next smart-search match…', 'Search', 'A repeatable, literal replacement of one next match; review each target with Undo.', async context => {
      if (!this.search) throw Error('Start a smart search first.');
      const replacement = await ask('Replace next match', 'Replacement', '', { allowEmpty: true }); if (replacement === null) return false;
      const search = { ...this.search };
      const recipe: Recipe = { title: 'Replace next search match', apply: current => {
        this.valid(current); const found = matches(current, search), offset = current.model!.getOffsetAt(current.editor!.getPosition()!);
        const match = found.find(match => current.model!.getOffsetAt(match.range.getStartPosition()) >= offset) ?? found[0];
        if (!match) throw Error('No remaining matches.'); this.apply(current, [{ range: match.range, text: replacement }], true);
      } }; recipe.apply(context); this.recipe = recipe;
    }, { mutates: true, repeatable: true });
  }
  private registerCompletion(add: (id: string, title: string, category: string, detail: string, run: EditorCommand['run'], flags?: Partial<EditorCommand>) => unknown): void {
    for (const direction of [-1, 1] as const) add(`symbol.${direction}`, `${direction < 0 ? 'Previous' : 'Next'} function or class`, 'Navigation', 'Uses language-server symbol positions; no regular-expression guess.', async context => {
      const position = context.editor!.getPosition()!, symbols = await this.options.symbols?.(context.model!) ?? [];
      this.valid(context, false);
      const eligible = symbols.filter(symbol => [5, 6, 9, 12].includes(symbol.kind)).sort((a, b) => a.line - b.line || a.column - b.column);
      const target = direction > 0 ? eligible.find(symbol => symbol.line > position.lineNumber || symbol.line === position.lineNumber && symbol.column > position.column)
        : eligible.reverse().find(symbol => symbol.line < position.lineNumber || symbol.line === position.lineNumber && symbol.column < position.column);
      if (!target) throw Error('No further function/class was reported by the language server. The editor’s Go to Symbol command may provide local symbols.');
      this.rememberJump(context.editor); context.editor!.setPosition({ lineNumber: target.line, column: target.column }); context.editor!.revealLineInCenter(target.line);
    }, { available: context => context.cellId ? 'Use the notebook cell outline; this command uses file symbols.' : undefined });
    add('view.scroll-link', 'Link / unlink scrolling with another visible editor…', 'View', 'Links logical source lines without changing text or keyboard focus. Closing either editor removes the link.', async context => {
      if (this.scrollLink) { this.scrollLink.dispose(); this.scrollLink = undefined; return; }
      const candidates = this.api.editor.getEditors().filter(editor => editor !== context.editor && editor.getDomNode()?.getClientRects().length
        && editor.getModel() && this.options.resolve(editor.getModel()!, editor));
      const other = await choose('Link scrolling', candidates.map(editor => ({ label: this.options.resolve(editor.getModel()!, editor)!.path, detail: this.options.resolve(editor.getModel()!, editor)!.groupId, value: editor })));
      if (!other) return false; this.valid(context, false);
      let copying = false; const first = context.editor!;
      const follow = (source: Monaco.editor.ICodeEditor, target: Monaco.editor.ICodeEditor) => {
        if (copying || !source.getModel() || !target.getModel()) return; const visible = source.getVisibleRanges()[0]; if (!visible) return;
        const line = Math.min(visible.startLineNumber, target.getModel()!.getLineCount());
        copying = true; try { target.setScrollTop(target.getTopForLineNumber(line)); } finally { copying = false; }
      };
      const listeners = [first.onDidScrollChange(event => { if (event.scrollTopChanged) follow(first, other); }), other.onDidScrollChange(event => { if (event.scrollTopChanged) follow(other, first); })];
      const link: Monaco.IDisposable = { dispose: () => { for (const listener of listeners) listener.dispose(); if (this.scrollLink === link) this.scrollLink = undefined; } };
      listeners.push(first.onDidDispose(() => link.dispose()), other.onDidDispose(() => link.dispose()), first.onDidChangeModel(() => link.dispose()), other.onDidChangeModel(() => link.dispose()));
      this.scrollLink = link;
    });
    add('completion.options', 'Change completion preferences for this view…', 'Completion', 'Automatic suggestions and delay for this view; word-source scope for the workspace.', async context => {
      const enabled = await choose('Automatic completion', [{ label: 'On', value: true }, { label: 'Off', value: false }]); if (enabled === null) return false;
      const delay = await ask('Completion delay', 'Milliseconds', '100', { number: true, min: 0, max: 2000 }); if (delay === null) return false;
      const scope = await choose('Word suggestions', (['off', 'currentDocument', 'matchingDocuments', 'allDocuments'] as const).map(value => ({ label: value, value }))); if (!scope) return false;
      this.valid(context, false); const options = { quickSuggestions: enabled, quickSuggestionsDelay: Number(delay) }; this.wordScope = scope;
      context.editor!.updateOptions({ ...options, wordBasedSuggestions: scope }); if (context.viewId) setDisplayOptions(context.viewId, options);
    });
    add('complete.line', 'Complete from a whole line…', 'Completion', 'Offers unique lines from the current model, including unsaved edits.', async context => {
      const lines = [...new Set(context.model!.getLinesContent().filter(line => line.trim()))].slice(0, 1000);
      const text = await choose('Whole line completion', lines.map(value => ({ label: value, value }))); if (text === null) return false;
      this.apply(context, this.selections(context).map(range => ({ range, text })));
    }, { mutates: true });
    add('complete.path', 'Complete a file path…', 'Completion', 'Uses the current document directory and project path suggestions.', async context => {
      const prefix = await ask('File path completion', 'Path prefix', './'); if (prefix === null) return false;
      const values = await this.options.paths?.(context, prefix) ?? [];
      const text = await choose('File paths', values.map(value => ({ label: value.label, value: value.text }))); if (text === null) return false;
      this.apply(context, this.selections(context).map(range => ({ range, text })));
    }, { mutates: true, available: () => this.options.paths ? undefined : 'File path completion is unavailable.' });
    add('insert.symbol', 'Insert a symbol…', 'Completion', 'Explicit symbol insertion leaves IME composition untouched.', async context => {
      const symbols = [['→', 'right arrow ->'], ['←', 'left arrow <-'], ['↔', 'both arrows'], ['⇒', 'implies =>'], ['≤', 'less than or equal <='], ['≥', 'greater than or equal >='], ['≠', 'not equal !='], ['±', 'plus minus'], ['×', 'multiply'], ['÷', 'divide'], ['∞', 'infinity'], ['π', 'pi'], ['α', 'alpha'], ['β', 'beta'], ['λ', 'lambda'], ['✓', 'check'], ['—', 'em dash'], ['…', 'ellipsis'], ['©', 'copyright']];
      const text = await choose('Symbols', symbols.map(([value, name]) => ({ label: `${value}  ${name}`, value }))); if (!text) return false;
      this.apply(context, this.selections(context).map(range => ({ range, text })), true);
    }, { mutates: true });
    add('insert.template', 'Insert a document template…', 'Completion', 'Inserts a bounded, explicit template at each selection.', async context => {
      const templates = [{ label: 'Markdown fenced code', text: '```text\n\n```' }, { label: 'Markdown table', text: '| Column | Value |\n| --- | --- |\n|  |  |' }, { label: 'Task list', text: '- [ ] Task\n- [ ] Task' }, { label: 'Python function', text: 'def function_name():\n    pass' }, { label: 'Experiment notes', text: '## Question\n\n## Method\n\n## Results\n\n## Next steps\n' }];
      const text = await choose('Templates', templates.map(template => ({ label: template.label, value: template.text }))); if (!text) return false;
      this.apply(context, this.selections(context).map(range => ({ range, text: text.replace(/\n/g, context.model!.getEOL()) })), true);
    }, { mutates: true });
    for (const direction of [-1, 1] as const) add(`heading.${direction}`, `${direction < 0 ? 'Previous' : 'Next'} Markdown heading`, 'Navigation', 'Uses parsed headings and excludes fenced code.', context => {
      const tokens = new MarkdownIt({ html: false }).parse(context.model!.getValue(), {}) as Array<{ type: string; map: number[] | null }>;
      const headings = tokens.filter(token => token.type === 'heading_open' && token.map).map(token => token.map![0] + 1), line = context.editor!.getPosition()!.lineNumber;
      const target = direction > 0 ? headings.find(target => target > line) : headings.reverse().find(target => target < line);
      if (!target) throw Error('No further heading in this direction.'); this.rememberJump(context.editor);
      context.editor!.setPosition({ lineNumber: target, column: 1 }); context.editor!.revealLineInCenter(target);
    }, { available: context => context.model?.getLanguageId() === 'markdown' ? undefined : 'This command applies to Markdown.' });
    add('spelling', 'Check English spelling in prose…', 'Writing', 'Explicit check; code blocks, inline code and URLs are excluded.', async context => {
      const model = context.model!, text = model.getValue(), tokens = new MarkdownIt({ html: false }).parse(text, {}) as Array<{ type: string; map: number[] | null }>;
      const ignored = tokens.filter(token => ['fence', 'code_block', 'html_block'].includes(token.type) && token.map).map(token => ({ start: model.getOffsetAt({ lineNumber: token.map![0] + 1, column: 1 }), end: token.map![1] >= model.getLineCount() ? text.length : model.getOffsetAt({ lineNumber: token.map![1] + 1, column: 1 }) }));
      for (const match of text.matchAll(/(`+)[\s\S]*?\1|https?:\/\/[^\s<>]+|<[^>]+>/g)) ignored.push({ start: match.index!, end: match.index! + match[0].length });
      const matches = [...text.matchAll(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)].filter(match => match[0].length > 1 && match[0].length <= 80 && !ignored.some(range => range.start <= match.index! && match.index! < range.end));
      const words = [...new Set(matches.map(match => match[0]))], errors = await this.options.spelling!(words.slice(0, 2000)); this.valid(context, false);
      this.recordResults('English spelling', 'Spelling', matches.filter(match => errors.some(error => error.word === match[0])).map(match => {
        const position = model.getPositionAt(match.index!); return { label: match[0], detail: `${context.resource}:${position.lineNumber}`, location: context.resource ? { path: context.resource, cellId: context.cellId, line: position.lineNumber, column: position.column, endColumn: position.column + match[0].length, context: model.getLineContent(position.lineNumber) } : undefined };
      }), '', context.groupId, words.length > 2000);
      if (!errors.length) { await explain('English spelling', [words.length > 2000 ? 'No flagged words among the first 2,000 distinct words.' : 'The English dictionary flagged no words.']); return; }
      const word = await choose('Spelling', errors.map(error => ({ label: error.word, detail: error.suggestions.join(' · '), value: error.word }))); if (!word) return false;
      const error = errors.find(error => error.word === word)!;
      const replacement = await choose(`Spelling: ${word}`, [...error.suggestions.map(value => ({ label: value, value })), { label: 'Add to personal dictionary', value: '__learn__' }]); if (!replacement) return false;
      if (replacement === '__learn__') { await this.options.learnWord?.(word); return; }
      this.valid(context); const match = matches.find(match => match[0] === word)!;
      this.apply(context, [{ range: this.api.Range.fromPositions(model.getPositionAt(match.index!), model.getPositionAt(match.index! + word.length)), text: replacement }], true);
    }, { mutates: true, available: context => !this.options.spelling ? 'Spelling is unavailable.' : !['markdown', 'plaintext'].includes(context.model?.getLanguageId() ?? '') ? 'Focus an English prose document or Markdown cell.' : undefined });
    add('view.options', 'Change this editor’s display…', 'View', 'Window-local options; does not change file contents.', async context => {
      const option = await choose('Editor display', ['Line numbers', 'Whitespace', 'Wrap', '80-column guide', 'Indentation guides'].map(value => ({ label: value, value }))); if (!option) return false;
      this.valid(context, false); const editor = context.editor!, E = this.api.editor.EditorOption;
      if (option === 'Line numbers') { const value = await choose('Line numbers', (['on', 'relative', 'off'] as const).map(value => ({ label: value, value }))); if (value) editor.updateOptions({ lineNumbers: value }); }
      if (option === 'Whitespace') editor.updateOptions({ renderWhitespace: editor.getOption(E.renderWhitespace) === 'all' ? 'selection' : 'all' });
      if (option === 'Wrap') await editor.getAction('editor.action.toggleWordWrap')?.run();
      if (option === '80-column guide') editor.updateOptions({ rulers: editor.getOption(E.rulers).length ? [] : [80] });
      if (option === 'Indentation guides') editor.updateOptions({ guides: { indentation: !editor.getOption(E.guides).indentation } });
      const raw = editor.getRawOptions();
      if (context.viewId) setDisplayOptions(context.viewId, { lineNumbers: raw.lineNumbers, renderWhitespace: raw.renderWhitespace,
        wordWrap: raw.wordWrap, rulers: raw.rulers, guides: raw.guides });
    });
  }
}
