import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import {
  yamlAllSchemasMethod, yamlDetectionAfterPick, yamlDetectionDisabled, yamlDetectionSetting, yamlFileSchemasMethod, yamlFileSpellings, yamlMaxItemsSetting,
  yamlNoSchemaLabel, yamlResultLimitReachedMethod, yamlRules, yamlSchemaChoices, yamlSchemaDeclaration, yamlSchemaLine, yamlSchemaRequest,
  yamlSchemaSelectionSupported, yamlSchemasAfterPick, yamlSchemasSetting, yamlSchemaStoreInitializedMethod, yamlStartupNotifications, yamlVersionSelection,
} from './yaml-schema-choice';

const vendor = path.resolve(__dirname, '../../../../../vendor');
const source = (file: string) => readFileSync(path.join(vendor, 'vscode-yaml', file), 'utf8');
const statusBar = source('src/schema-status-bar-item.ts'), extension = source('src/extension.ts'), upstreamTest = source('test/json-schema-selection.test.ts');

const workflow = 'https://json.schemastore.org/github-workflow.json';
const file = { uri: 'file:///workspace/test.yaml', folder: '/workspace' };

test('the requests and notifications are the ones the extension uses, in the form its connection writes them', () => {
  expect(statusBar).toContain(`new RequestType('${yamlAllSchemasMethod}')`);
  expect(statusBar).toContain(`new RequestType('${yamlFileSchemasMethod}')`);
  // Both take the document's address as their one parameter.
  expect(statusBar).toContain('const schema = await client.sendRequest(getSchemaRequestType, fileUri);');
  expect(statusBar).toContain('const schemas = await client.sendRequest(getJSONSchemasRequestType, fileUri);');
  expect(yamlSchemaRequest(yamlFileSchemasMethod, file.uri)).toEqual({ method: 'yaml/get/jsonSchema', params: ['file:///workspace/test.yaml'] });
  expect(yamlSchemaRequest(yamlAllSchemasMethod, file.uri)).toEqual({ method: 'yaml/get/all/jsonSchemas', params: ['file:///workspace/test.yaml'] });
  // A parameter that is not an object travels in a list.
  const connection = readFileSync(path.join(vendor, 'vscode-languageserver-node/jsonrpc/src/common/connection.ts'), 'utf8');
  expect(connection).toContain('if (isNamedParam(param)) {\n\t\t\t\t\treturn nullToUndefined(param);\n\t\t\t\t} else {\n\t\t\t\t\treturn [undefinedToNull(param)];');

  expect(extension).toContain(`new NotificationType('${yamlResultLimitReachedMethod}')`);
  expect(extension).toContain(`new NotificationType('${yamlSchemaStoreInitializedMethod}')`);
  expect(extension).toContain('client.onNotification(SchemaSelectionRequests.schemaStoreInitialized, () => {\n    createJSONSchemaStatusBarItem(context, client);');
  const manifest = JSON.parse(source('package.json')) as { contributes: { configuration: { properties: Record<string, unknown> } } };
  for (const name of [yamlSchemasSetting, yamlDetectionSetting, yamlMaxItemsSetting]) expect(manifest.contributes.configuration.properties).toHaveProperty([name]);
  expect(statusBar).toContain(`const schemaDeclarationPattern = ${yamlSchemaDeclaration};`);
  expect(yamlSchemaDeclaration.test('# yaml-language-server: $schema=https://example.com/s.json\nname: x')).toBe(true);
  expect(yamlSchemaDeclaration.test('name: x\n$schema: ./s.json')).toBe(true);
  expect(yamlSchemaDeclaration.test('name: $schema')).toBe(false);
});

test('what the extension sends at startup, in its order, and what each obliges the editor to answer', () => {
  const started = extension.slice(extension.indexOf('await client.start();'));
  const sent = [
    'client.sendNotification(SchemaAssociationNotification.type, getSchemaAssociations());',
    'client.sendNotification(DynamicCustomSchemaRequestRegistration.type);',
    'client.sendNotification(VSCodeContentRequestRegistration.type);',
    'client.sendNotification(SchemaSelectionRequests.type);',
  ].map(line => started.indexOf(line));
  expect(sent.every(index => index > 0)).toBe(true);
  expect([...sent].sort((a, b) => a - b)).toEqual(sent);
  expect(yamlStartupNotifications.map(notification => notification.method)).toEqual([
    'json/schemaAssociations', 'yaml/registerCustomSchemaRequest', 'yaml/registerContentRequest', 'yaml/supportSchemaSelection']);
  for (const { method } of yamlStartupNotifications) expect(extension).toContain(`'${method}'`);
  // The list of associations is the one parameter, so it travels inside a list; the other three are sent without a parameter.
  expect(extension).toContain('function getSchemaAssociations(): ISchemaAssociation[] {');
  expect(yamlStartupNotifications.map(notification => notification.params)).toEqual([[[]], [null], [null], [null]]);
  // What the server then asks of its editor is what the extension answers.
  for (const { asks } of yamlStartupNotifications) for (const request of asks) expect(source('src/schema-extension-api.ts') + extension).toContain(`'${request}'`);
  expect(extension).toContain('client.onRequest(CUSTOM_SCHEMA_REQUEST, (resource: string) => {');
  expect(extension).toContain('client.onRequest(VSCodeContentRequest.type, (uri: string) => {');
  // The one that asks nothing of the editor is the one to send.
  expect(yamlStartupNotifications.filter(notification => !notification.asks.length && notification.method.startsWith('yaml/')).map(({ method, params }) => ({ method, params })))
    .toEqual([yamlSchemaSelectionSupported]);
  expect(yamlSchemaSelectionSupported).toEqual({ method: 'yaml/supportSchemaSelection', params: [null] });
  for (const { switchesOn } of yamlStartupNotifications) expect(switchesOn.length).toBeGreaterThan(40);
});

test('the answers become the entries of a picker, in the extension\'s order', () => {
  const all = [
    { uri: 'https://example.com/zebra.json', name: 'Zebra', fromStore: true, usedForCurrentFile: false },
    { uri: 'https://example.com/plain.json', usedForCurrentFile: true, fromStore: false },
    { uri: 'https://example.com/apple.json', name: 'Apple', description: 'An apple.', fromStore: true, usedForCurrentFile: false },
    { uri: 'https://example.com/k8s-1.30.json', name: 'Kubernetes', usedForCurrentFile: true, fromStore: true,
      versions: { '1.29': 'https://example.com/k8s-1.29.json', '1.30': 'https://example.com/k8s-1.30.json' } },
  ];
  expect(yamlSchemaChoices(all)).toEqual([
    { name: 'Kubernetes', uri: 'https://example.com/k8s-1.30.json', inUse: true, fromStore: true, versions: [
      { version: '1.29', uri: 'https://example.com/k8s-1.29.json', current: false }, { version: '1.30', uri: 'https://example.com/k8s-1.30.json', current: true }] },
    { name: 'https://example.com/plain.json', uri: 'https://example.com/plain.json', inUse: true, fromStore: false },
    { name: 'Apple', description: 'An apple.', uri: 'https://example.com/apple.json', inUse: false, fromStore: true },
    { name: 'Zebra', uri: 'https://example.com/zebra.json', inUse: false, fromStore: true },
  ]);
  expect(statusBar).toContain('label: val.name ?? val.uri,');
  expect(statusBar).toContain('if (a.schema?.usedForCurrentFile && a.schema?.versions) {\n      return -1;');
  expect(statusBar).toContain('return a.label.localeCompare(b.label);');
  expect(statusBar).toContain('pickItems.unshift(noSchemaItem);');
  expect(statusBar).toContain('schemasPick.canSelectMany = true;');

  // A schema only the file's own answer names is in use; one both name keeps what the first says of it.
  const merged = yamlSchemaChoices(all.slice(0, 1), [{ uri: 'https://example.com/zebra.json' }, { uri: 'file:///workspace/schema.json', name: 'Local' }]);
  expect(merged).toEqual([
    { name: 'Local', uri: 'file:///workspace/schema.json', inUse: true, fromStore: false },
    { name: 'Zebra', uri: 'https://example.com/zebra.json', inUse: true, fromStore: true },
  ]);
  // No version has the schema's address: the one named `latest` counts as in use (`findUsedVersion`).
  expect(statusBar).toContain("  return 'latest';");
  expect(yamlSchemaChoices([{ uri: 'https://example.com/s.json', versions: { latest: 'https://example.com/latest.json', v1: 'https://example.com/v1.json' } }])[0].versions?.map(version => version.current)).toEqual([true, false]);

  // An address named twice is one entry.
  expect(yamlSchemaChoices([{ uri: 'a:1', name: 'First' }, { uri: 'a:1', name: 'Second' }])).toEqual([{ name: 'First', uri: 'a:1', inUse: false, fromStore: false }]);
});

test('an answer that is not what the server documents gives no entries and never throws', () => {
  for (const answer of [undefined, null, 'schemas', 7, {}, { uri: 'a:1' }]) {
    expect(yamlSchemaChoices(answer)).toEqual([]);
    expect(yamlSchemaChoices([], answer)).toEqual([]);
    expect(yamlSchemaLine(answer)).toBe(yamlNoSchemaLabel);
  }
  const odd = [null, 3, 'x', [], {}, { uri: 5 }, { uri: '' }, { uri: 'x'.repeat(5000) }, { name: 'No address' },
    { uri: 'a:1', name: 9, description: {}, versions: ['a:2'], usedForCurrentFile: 'yes', fromStore: 1 },
    { uri: 'a:2', name: 'n'.repeat(9000), versions: { '': 'a:3', one: 4, two: 'a:4' } }];
  expect(yamlSchemaChoices(odd)).toEqual([
    { name: 'a:1', uri: 'a:1', inUse: false, fromStore: false },
    { name: 'n'.repeat(4096), uri: 'a:2', inUse: false, fromStore: false, versions: [{ version: 'two', uri: 'a:4', current: false }] },
  ]);
  expect(yamlSchemaChoices(Array.from({ length: 6000 }, (_, index) => ({ uri: `a:${index}` })))).toHaveLength(4096);
  expect(yamlSchemaLine(Array.from({ length: 300 }, (_, index) => ({ uri: `a:${index}`, name: 'n'.repeat(4000) }))).length).toBeLessThanOrEqual(4096);
});

test('the line for the document panel names the schema in use and its version', () => {
  expect(statusBar).toContain(`const noSchemaLabel = '${yamlNoSchemaLabel}';`);
  expect(statusBar).toContain('if (!schema || schema.length === 0) {\n      statusBarItem.text = noSchemaLabel;');
  expect(statusBar).toContain('statusBarItem.text = schema[0].name ?? schema[0].uri;');
  expect(statusBar).toContain('if (version && !statusBarItem.text.includes(version)) {');
  expect(statusBar).toContain('version = findUsedVersion(schema[0].versions, schema[0].uri);');
  expect(statusBar).toContain('const schemaStoreItem = findSchemaStoreItem(schemas, schema[0].uri);');

  expect(yamlSchemaLine([])).toBe('No JSON Schema');
  expect(yamlSchemaLine([{ uri: workflow, name: 'GitHub Workflow' }])).toBe('GitHub Workflow');
  expect(yamlSchemaLine([{ uri: workflow }])).toBe(workflow);
  // The schema states its versions: the one whose address it has, or `latest`.
  const versions = { '1.29': 'https://example.com/k8s-1.29.json', '1.30': 'https://example.com/k8s-1.30.json' };
  expect(yamlSchemaLine([{ uri: 'https://example.com/k8s-1.30.json', name: 'Kubernetes', versions }])).toBe('Kubernetes (1.30)');
  expect(yamlSchemaLine([{ uri: 'https://example.com/k8s.json', name: 'Kubernetes', versions }])).toBe('Kubernetes (latest)');
  // It does not: the catalogue entry that has its address as a version names it.
  const catalogue = [{ uri: 'https://example.com/k8s.json', name: 'Kubernetes', versions, usedForCurrentFile: false, fromStore: true }];
  expect(yamlSchemaLine([{ uri: 'https://example.com/k8s-1.29.json', name: 'Kubernetes' }], catalogue)).toBe('Kubernetes (1.29)');
  expect(yamlSchemaLine([{ uri: 'https://example.com/other.json', name: 'Other' }], catalogue)).toBe('Other');
  // A version the name already says is not said twice.
  expect(yamlSchemaLine([{ uri: 'https://example.com/k8s-1.29.json', name: 'Kubernetes 1.29' }], catalogue)).toBe('Kubernetes 1.29');
  // Several: how many, and which.
  expect(statusBar).toContain("statusBarItem.text = 'Multiple JSON Schemas';");
  expect(yamlSchemaLine([{ uri: 'a:1', name: 'One' }, { uri: 'a:2' }])).toBe('2 JSON schemas: One, a:2');
  expect(yamlSchemaLine(Array.from({ length: 10 }, (_, index) => ({ uri: `a:${index}` })))).toBe('10 JSON schemas: a:0, a:1, a:2, a:3, a:4, a:5, a:6, a:7, …');
});

test('a choice is written to yaml.schemas as the extension writes it', () => {
  // The values the extension's own tests expect.
  expect(upstreamTest).toContain("{ [schemaUri]: 'file:///workspace/test.yaml' },");
  expect(yamlSchemasAfterPick({}, file, [workflow])).toEqual({ [workflow]: 'file:///workspace/test.yaml' });
  expect(upstreamTest).toContain("expect(update).calledOnceWith('schemas', {}, vscode.ConfigurationTarget.Workspace);");
  expect(yamlSchemasAfterPick({ 'https://foo.com/bar.json': 'file:///foo.yaml' }, { uri: 'file:///foo.yaml' }, [], ['https://foo.com/bar.json'])).toEqual({});
  expect(upstreamTest).toContain("[schemaUri]: ['*.yaml', '!file:///workspace/test.yaml'],");
  expect(yamlSchemasAfterPick({ [workflow]: '*.yaml' }, file, [], [workflow])).toEqual({ [workflow]: ['*.yaml', '!file:///workspace/test.yaml'] });
  // The rules themselves.
  expect(statusBar).toContain("filtered.push('!' + Uri.parse(fileUri));");
  expect(statusBar).toContain("if (filtered.some((p) => !p.startsWith('!'))) {");
  expect(statusBar).toContain('settings[schemaUri] = filtered.length === 1 ? filtered[0] : filtered;');
  expect(statusBar).toContain('settings[resolveSettingsKey(schemaUrl)] = fileUri;');
  expect(statusBar).toContain('const deselectedUris = previouslyUsedUris.filter((uri) => !schemaUrls.includes(uri));');

  // Chosen again: the `!` pattern goes, and a single pattern is written as one.
  expect(yamlSchemasAfterPick({ [workflow]: ['*.yaml', '!file:///workspace/test.yaml'] }, file, [workflow])).toEqual({ [workflow]: '*.yaml' });
  expect(yamlSchemasAfterPick({ [workflow]: ['a/*.yaml', '*.yml', '!test.yaml'] }, file, [workflow])).toEqual({ [workflow]: ['a/*.yaml', '*.yml'] });
  // Still chosen and in use: nothing changes, and the value given is not the one returned.
  const current = { [workflow]: '*.yaml', 'https://example.com/other.json': ['other.yaml'] };
  const same = yamlSchemasAfterPick(current, file, [workflow], [workflow]);
  expect(same).toEqual(current);
  expect(same).not.toBe(current);
  // Several chosen, one of them new; an entry nobody chose stays.
  expect(yamlSchemasAfterPick(current, file, [workflow, 'https://example.com/new.json'], [workflow]))
    .toEqual({ ...current, 'https://example.com/new.json': 'file:///workspace/test.yaml' });
  // No longer chosen: every spelling of the file goes; the entry stays for other files, or goes when none are left.
  expect(yamlFileSpellings(file)).toEqual(['file:///workspace/test.yaml', '/workspace/test.yaml', 'test.yaml']);
  expect(statusBar).toContain('candidates.add(uri.fsPath);\n      candidates.add(workspace.asRelativePath(uri, false));');
  expect(yamlSchemasAfterPick({ [workflow]: ['test.yaml', '/workspace/test.yaml', 'ci/*.yaml'] }, file, [], [workflow])).toEqual({ [workflow]: ['ci/*.yaml', '!file:///workspace/test.yaml'] });
  expect(yamlSchemasAfterPick({ [workflow]: ['test.yaml', '!other.yaml'] }, file, [], [workflow])).toEqual({});
  expect(yamlSchemasAfterPick({ [workflow]: ['*.yaml', '!file:///workspace/test.yaml'] }, file, [], [workflow])).toEqual({ [workflow]: ['*.yaml', '!file:///workspace/test.yaml'] });
  // One chosen in place of another.
  expect(yamlSchemasAfterPick({ [workflow]: 'file:///workspace/test.yaml' }, file, ['https://example.com/new.json'], [workflow])).toEqual({ 'https://example.com/new.json': 'file:///workspace/test.yaml' });
  // A schema the catalogue alone applies has no entry: taking it off the list writes nothing.
  expect(yamlSchemasAfterPick({}, file, [], [workflow])).toEqual({});
});

test('a schema that is a file is found under the spelling its entry was written in', () => {
  expect(statusBar).toContain('for (const candidate of getFilePatternCandidates(schemaUri)) {');
  const local = 'file:///workspace/schemas/app.json';
  for (const written of [local, '/workspace/schemas/app.json', 'schemas/app.json', './schemas/app.json']) {
    expect(yamlSchemasAfterPick({ [written]: 'config/*.yaml' }, file, [], [local]), written).toEqual({ [written]: ['config/*.yaml', '!file:///workspace/test.yaml'] });
    expect(yamlSchemasAfterPick({ [written]: ['*.yaml', '!test.yaml'] }, file, [local]), written).toEqual({ [written]: '*.yaml' });
  }
  // Outside the project folder there is no spelling relative to it.
  expect(yamlFileSpellings({ uri: 'file:///elsewhere/a.yaml', folder: '/workspace' })).toEqual(['file:///elsewhere/a.yaml', '/elsewhere/a.yaml']);
  expect(yamlFileSpellings({ uri: 'untitled:Untitled-1', folder: '/workspace' })).toEqual(['untitled:Untitled-1']);
  expect(yamlFileSpellings({ uri: 'file:///workspace/test.yaml' })).toEqual(['file:///workspace/test.yaml', '/workspace/test.yaml']);
});

test('where the extension would leave the file without the chosen schema, the file is added', () => {
  // The schema has an entry, for other files only. The extension counts it as handled and writes nothing.
  expect(statusBar).toContain('selectedHandled.add(schemaUri);');
  expect(yamlSchemasAfterPick({ [workflow]: 'other.yaml' }, file, [workflow])).toEqual({ [workflow]: ['other.yaml', 'file:///workspace/test.yaml'] });
  expect(yamlSchemasAfterPick({ [workflow]: ['a.yaml', 'b.yaml'] }, file, [workflow])).toEqual({ [workflow]: ['a.yaml', 'b.yaml', 'file:///workspace/test.yaml'] });
  // The entry held nothing but the `!` pattern.
  expect(yamlSchemasAfterPick({ [workflow]: '!test.yaml' }, file, [workflow])).toEqual({ [workflow]: 'file:///workspace/test.yaml' });
  // It names the file already, or was in use: left as it is.
  expect(yamlSchemasAfterPick({ [workflow]: ['other.yaml', 'test.yaml'] }, file, [workflow])).toEqual({ [workflow]: ['other.yaml', 'test.yaml'] });
  expect(yamlSchemasAfterPick({ [workflow]: 'ci/**' }, file, [workflow], [workflow])).toEqual({ [workflow]: 'ci/**' });
});

test('a setting that is not what the extension writes is read without throwing', () => {
  for (const current of [undefined, null, 'schemas', 4, [], ['a']]) {
    expect(yamlSchemasAfterPick(current, file, [workflow])).toEqual({ [workflow]: file.uri });
    expect(yamlSchemasAfterPick(current, file, [], [workflow])).toEqual({});
  }
  // Patterns that are not text are passed over; an entry nobody chose is not touched, whatever it holds.
  expect(yamlSchemasAfterPick({ [workflow]: [1, '*.yaml', null], other: { odd: true } }, file, [], [workflow])).toEqual({ [workflow]: ['*.yaml', '!file:///workspace/test.yaml'], other: { odd: true } });
  expect(yamlSchemasAfterPick({ [workflow]: 7 }, file, [workflow])).toEqual({ [workflow]: file.uri });
  // What is chosen is a list of addresses.
  const chosen = ['', '__proto__', 5, null, 'x'.repeat(5000), workflow] as unknown as string[];
  const result = yamlSchemasAfterPick({}, file, chosen);
  expect(result).toEqual({ [workflow]: file.uri });
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  expect(Object.keys(yamlSchemasAfterPick({}, file, Array.from({ length: 200 }, (_, index) => `a:${index}`)))).toHaveLength(64);
});

test('a version of a schema takes the place of the version chosen before', () => {
  expect(statusBar).toContain('(schemaUri) => schemaUri !== schema.uri && !schemaVersionUris.has(schemaUri)');
  expect(statusBar).toContain('const updatedSchemaUris = Array.from(new Set([...remainingSchemaUris, items[0].url]));');
  const [kubernetes] = yamlSchemaChoices([{ uri: 'https://example.com/k8s-1.30.json', name: 'Kubernetes', usedForCurrentFile: true,
    versions: { '1.29': 'https://example.com/k8s-1.29.json', '1.30': 'https://example.com/k8s-1.30.json' } }]);
  const selected = yamlVersionSelection([workflow, 'https://example.com/k8s-1.30.json'], kubernetes, 'https://example.com/k8s-1.29.json');
  expect(selected).toEqual([workflow, 'https://example.com/k8s-1.29.json']);
  expect(yamlVersionSelection([workflow], kubernetes, 'https://example.com/k8s-1.29.json')).toEqual([workflow, 'https://example.com/k8s-1.29.json']);
  expect(yamlVersionSelection(selected, kubernetes, 'https://example.com/k8s-1.29.json')).toEqual(selected);
  expect(yamlVersionSelection([workflow], { uri: 'a:1' }, 'a:2')).toEqual([workflow, 'a:2']);
  // Written with what was in use, the entry of the version before goes; without it, as the extension does, it stays.
  const current = { [workflow]: 'file:///workspace/test.yaml', 'https://example.com/k8s-1.30.json': 'file:///workspace/test.yaml' };
  expect(yamlSchemasAfterPick(current, file, selected, [workflow, 'https://example.com/k8s-1.30.json']))
    .toEqual({ [workflow]: 'file:///workspace/test.yaml', 'https://example.com/k8s-1.29.json': 'file:///workspace/test.yaml' });
  expect(statusBar).toContain('await writeSchemaUriMappings(updatedSchemaUris, fileUri);');
  expect(yamlSchemasAfterPick(current, file, selected)).toEqual({ ...current, 'https://example.com/k8s-1.29.json': 'file:///workspace/test.yaml' });
});

test('choosing a schema takes the file out of yaml.disableSchemaDetection, and nothing puts it in', () => {
  const foo = { uri: 'file:///foo.yaml' };
  expect(upstreamTest).toContain("expect(update).calledWith('disableSchemaDetection', ['file:///other.yaml']);");
  expect(yamlDetectionAfterPick(['file:///foo.yaml', 'file:///other.yaml'], foo, ['https://foo.com/bar.json'])).toEqual(['file:///other.yaml']);
  expect(statusBar).toContain('if (schemaUrls.length > 0) {');
  expect(statusBar).toContain("if (typeof setting === 'string' && filePatterns.includes(setting)) {\n    return [];");
  expect(yamlDetectionAfterPick('/foo.yaml', foo, ['a:1'])).toEqual([]);
  expect(yamlDetectionAfterPick(['foo.yaml', 3, '*.yml'], { uri: 'file:///workspace/foo.yaml', folder: '/workspace' }, ['a:1'])).toEqual(['*.yml']);
  // Left as it is: nothing chosen, the file not named, the setting not set or not a list of patterns.
  expect(upstreamTest).toContain("expect(update).not.calledWith('disableSchemaDetection');");
  expect(statusBar.match(/'disableSchemaDetection',\n\s+removeFilePatternFromSetting\(/g)).toHaveLength(3);
  expect(statusBar).not.toMatch(/update\(\s*'disableSchemaDetection',\s*(?!\s|removeFilePatternFromSetting)/);
  expect(yamlDetectionAfterPick(['file:///foo.yaml'], foo, [])).toBeUndefined();
  expect(yamlDetectionAfterPick(['*.yaml', 'file:///other.yaml'], foo, ['a:1'])).toBeUndefined();
  for (const current of [undefined, null, true, {}, 9]) expect(yamlDetectionAfterPick(current, foo, ['a:1'])).toBeUndefined();

  // The picker opens with "No JSON Schema" chosen for such a file.
  expect(statusBar).toContain('selectedSchemaItems.length > 0 && !isSchemaDetectionDisabled(fileUri) ? selectedSchemaItems : [noSchemaItem];');
  expect(yamlDetectionDisabled(['file:///foo.yaml'], foo)).toBe(true);
  expect(yamlDetectionDisabled('/foo.yaml', foo)).toBe(true);
  expect(yamlDetectionDisabled(['*.yaml'], foo)).toBe(false);
  for (const current of [undefined, null, true, {}, [4]]) expect(yamlDetectionDisabled(current, foo)).toBe(false);
});

test('a cut outline is a notice with the extension\'s sentence', () => {
  expect(extension).toContain("`${message}\\nUse setting '${SettingIds.maxItemsComputed}' to configure the limit.`,");
  expect(extension).toContain(`export const maxItemsComputed = '${yamlMaxItemsSetting}';`);
  const rules = yamlRules({ name: 'YAML', root: '/workspace', settings: {} });
  const limit = rules.notifications?.[yamlResultLimitReachedMethod];
  const sentence = 'big.yaml: For performance reasons, document symbols have been limited to 5000 items.';
  const notice = { notices: { 'yaml/resultLimitReached': { severity: 'info', message: `${sentence}\nUse setting 'yaml.maxItemsComputed' to configure the limit.` } } };
  // The sentence is the one parameter: it arrives in a list, or bare from a connection that unwraps it.
  expect(limit?.([sentence])).toEqual(notice);
  expect(limit?.(sentence)).toEqual(notice);
  for (const params of [undefined, null, [], [''], '', 5, {}, [sentence, sentence], [{ message: sentence }]]) expect(limit?.(params)).toBeUndefined();
  expect(limit?.(['x'.repeat(10_000)])?.notices?.['yaml/resultLimitReached']?.message).toHaveLength(4096);
  // Nothing here answers a request of the server: none of the notifications that oblige one is sent.
  expect(rules.requests).toBeUndefined();
});
