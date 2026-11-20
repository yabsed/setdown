import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { customDataAddresses, customDataChanged, customDataChangedMethod, customDataFiles, customDataOptions, customDataSetting, htmlCustomDataContentMethod,
  htmlCustomDataFile, htmlCustomDataRules, markupHandledSchemas } from './markup-custom-data';

const vendor = path.resolve(__dirname, '../../../../../vendor');
const source = (file: string) => readFileSync(path.join(vendor, file), 'utf8');
const extensions = 'vscode/extensions';
const temporary: string[] = [];
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const folder = () => { const directory = mkdtempSync(path.join(os.tmpdir(), 'setdown-custom-data-')); temporary.push(directory); return directory; };
const project = path.resolve('/work/site'), address = (...parts: string[]) => pathToFileURL(path.resolve(project, ...parts)).href;
const context = { name: 'html-lsp', root: project, settings: {} };

test('an entry of the setting is a path from the project folder', () => {
  for (const kind of ['html', 'css'] as const) {
    const name = customDataSetting[kind], [section, key] = name.split('.');
    expect(customDataAddresses(kind, { [section]: { [key]: ['./data/tags.json', 'more.json', '../shared/all.json', path.resolve('/opt/data.json')] } }, project), kind)
      .toEqual([address('data/tags.json'), address('more.json'), address('../shared/all.json'), pathToFileURL(path.resolve('/opt/data.json')).href]);
    // The dotted way of writing a setting.
    expect(customDataAddresses(kind, { [name]: ['a b.json'] }, project)).toEqual([address('a b.json')]);
    expect(customDataAddresses(kind, { [name]: ['a b.json'] }, project)[0]).toContain('a%20b.json');
    // What is not a path is passed over; what is not a list, and a file outside any folder, give nothing.
    expect(customDataAddresses(kind, { [name]: ['x.json', 7, null, { path: 'y.json' }, ['z.json']] }, project)).toEqual([address('x.json')]);
    for (const nothing of [undefined, {}, { [name]: 'x.json' }, { [name]: { 0: 'x.json' } }, { [section]: null }]) expect(customDataAddresses(kind, nothing, project)).toEqual([]);
    expect(customDataAddresses(kind, { [name]: ['x.json'] }, undefined)).toEqual([]);
    expect(customDataAddresses(kind, { [name]: Array.from({ length: 1000 }, (_, index) => `${index}.json`) }, project)).toHaveLength(256);
  }
});

test('HTML keeps an entry that is an address and tells each once; CSS takes every entry as a path', () => {
  const entries = ['https://example.com/tags.json', 'file:///opt/tags.json', 'tags.json', './tags.json'];
  expect(customDataAddresses('html', { html: { customData: entries } }, project)).toEqual(['https://example.com/tags.json', 'file:///opt/tags.json', address('tags.json')]);
  expect(customDataAddresses('css', { css: { customData: ['props.json', './props.json', 'file:///opt/props.json'] } }, project))
    .toEqual([address('props.json'), address('props.json'), address('file:/opt/props.json')]);
  // The other tool's setting is not read.
  expect(customDataAddresses('css', { html: { customData: ['tags.json'] } }, project)).toEqual([]);
});

test('the list of addresses is one parameter, written as a list inside the list of parameters', () => {
  const addresses = [address('a.json'), address('b.json')];
  expect(customDataChanged('html', addresses)).toEqual({ method: 'html/customDataChanged', params: [addresses] });
  expect(customDataChanged('css', addresses)).toEqual({ method: 'css/customDataChanged', params: [addresses] });
  // An empty list is still sent: it takes back what was told before.
  expect(customDataChanged('css', [])).toEqual({ method: 'css/customDataChanged', params: [[]] });
  expect(customDataChanged('css', addresses).params[0]).not.toBe(addresses);
});

test('the files to watch are the ones on this computer', () => {
  expect(customDataFiles([address('a.json'), 'https://example.com/tags.json', address('a.json'), address('b c.json'), 'file://%', 'untitled:x']))
    .toEqual([path.resolve(project, 'a.json'), path.resolve(project, 'b c.json')]);
  expect(customDataFiles([])).toEqual([]);
});

test('the HTML server is given the text of a file it asks for, and empty text for anything else', async () => {
  expect(htmlCustomDataFile(address('a.json'))).toBe(path.resolve(project, 'a.json'));
  expect(htmlCustomDataFile([address('a.json')])).toBe(path.resolve(project, 'a.json'));
  for (const nothing of [undefined, null, 7, {}, [], [address('a.json'), address('b.json')], [7], 'https://example.com/tags.json', 'tags.json', 'file://%']) expect(htmlCustomDataFile(nothing)).toBeUndefined();

  const directory = folder(), file = path.join(directory, 'tags.json'), text = '{ "version": 1.1, "tags": [{ "name": "my-button" }] }';
  writeFileSync(file, text);
  const rules = htmlCustomDataRules()(context);
  expect(rules.initializationOptions).toEqual({ handledSchemas: ['file'] });
  expect(customDataOptions).toEqual({ handledSchemas: [...markupHandledSchemas] });
  const answer = rules.requests![htmlCustomDataContentMethod];
  expect(await answer([pathToFileURL(file).href])).toEqual({ result: text });
  expect(await answer(pathToFileURL(file).href)).toEqual({ result: text });
  // A file that is not there: the server goes on without it, and the log says why.
  const missing = await answer([pathToFileURL(path.join(directory, 'none.json')).href]);
  expect(missing).toMatchObject({ result: '' });
  expect((missing.signal!.log![0])).toMatch(/^html\.customData: .*none\.json could not be read: /);
  for (const malformed of [undefined, null, 7, {}, ['https://example.com/tags.json'], [[]]])
    expect(await answer(malformed)).toEqual({ result: '', signal: { log: ['html.customData: the server asked for an address that is not a file on this computer.'] } });
  // A reader that fails with a long message does not flood the log.
  const failing = htmlCustomDataRules(async () => { throw new Error('x'.repeat(10_000)); })(context).requests![htmlCustomDataContentMethod];
  expect((await failing([pathToFileURL(file).href])).signal!.log![0]).toHaveLength(4096);
});

test('the settings, the messages and who reads a file are the HTML and CSS extensions\'', () => {
  const htmlClient = source(`${extensions}/html-language-features/client/src/htmlClient.ts`), htmlData = source(`${extensions}/html-language-features/client/src/customData.ts`);
  expect(htmlClient).toContain(`new NotificationType('${customDataChangedMethod.html}')`);
  expect(htmlClient).toContain(`new RequestType('${htmlCustomDataContentMethod}')`);
  expect(htmlClient).toContain("handledSchemas: ['file'],");
  // Sent once the server runs and on every change, always the whole list.
  expect(htmlClient).toMatch(/await client\.start\(\);[\s\S]*client\.sendNotification\(CustomDataChangedNotification\.type, customDataSource\.uris\);\s+customDataSource\.onDidChange\(\(\) => \{\s+client\.sendNotification\(CustomDataChangedNotification\.type, customDataSource\.uris\);/);
  expect(htmlData).toContain(`e.affectsConfiguration('${customDataSetting.html}')`);
  expect(htmlData).toContain('return /^(?<scheme>\\w[\\w\\d+.-]*):/.test(uriOrPath);');
  expect(htmlData).toContain('workspaceUris.add(Utils.resolvePath(rootFolder, uriOrPath).toString());');
  expect(htmlData).toContain('workspaceUris.add(uriOrPath);');
  expect(htmlData).toMatch(/workspace\.onDidChangeTextDocument\(e => \{\s+const path = e\.document\.uri\.toString\(\);\s+if \(externalExtensionUris\.has\(path\) \|\| workspaceUris\.has\(path\)\) \{\s+onChange\.fire\(\);/);

  const cssClient = source(`${extensions}/css-language-features/client/src/cssClient.ts`), cssData = source(`${extensions}/css-language-features/client/src/customData.ts`);
  expect(cssClient).toContain(`new NotificationType('${customDataChangedMethod.css}')`);
  expect(cssClient).toContain("handledSchemas: ['file'],");
  expect(cssClient).toMatch(/await client\.start\(\);\s+client\.sendNotification\(CustomDataChangedNotification\.type, customDataSource\.uris\);/);
  expect(cssData).toContain(`e.affectsConfiguration('${customDataSetting.css}')`);
  expect(cssData).toContain('dataPaths.push(Utils.resolvePath(rootFolder, path).toString());');
  expect(cssData).not.toContain('onDidChangeTextDocument');

  // The HTML server asks its editor for every address; the CSS server reads `file:` itself.
  const htmlServer = source(`${extensions}/html-language-features/server/src/htmlServer.ts`);
  expect(htmlServer).toMatch(/const customDataRequestService: CustomDataRequestService = \{\s+getContent\(uri: string\) \{\s+return connection\.sendRequest\(CustomDataContent\.type, uri\);/);
  expect(htmlServer).toMatch(/connection\.onNotification\(CustomDataChangedNotification\.type, dataPaths => \{\s+fetchHTMLDataProviders\(dataPaths, customDataRequestService\)/);
  expect(htmlServer).toContain("const handledSchemas = initializationOptions?.handledSchemas as string[] ?? ['file'];");
  expect(htmlServer).toContain('const dataPaths: string[] = initializationOptions?.dataPaths || [];');
  expect(source(`${extensions}/html-language-features/server/src/customData.ts`)).toMatch(/\} catch \(e\) \{\s+return newHTMLDataProvider\(p, \{ version: 1 \}\);/);
  const cssServer = source(`${extensions}/css-language-features/server/src/cssServer.ts`), cssRequests = source(`${extensions}/css-language-features/server/src/requests.ts`);
  expect(cssServer).toContain("requestService = getRequestService(initializationOptions?.handledSchemas || ['file'], connection, runtime);");
  expect(cssServer).toContain('connection.onNotification(CustomDataChangedNotification.type, updateDataProviders);');
  expect(cssServer).not.toContain('initializationOptions?.dataPaths');
  expect(cssRequests).toMatch(/const handler = builtInHandlers\[getScheme\(uri\)\];\s+if \(handler\) \{\s+return handler\.getContent\(uri, encoding\);\s+\}\s+return connection\.sendRequest\(FsContentRequest\.type, \{ uri: uri\.toString\(\), encoding \}\);/);
  expect(source(`${extensions}/css-language-features/server/src/node/cssServerMain.ts`)).toContain('file: getNodeFSRequestService()');

  // A parameter that is a list travels inside the list of parameters.
  const connection = source('vscode-languageserver-node/jsonrpc/src/common/connection.ts');
  expect(connection).toMatch(/function isNamedParam\(param: any\): boolean \{\s+return param !== undefined && param !== null && !Array\.isArray\(param\) && typeof param === 'object';/);
  expect(connection).toMatch(/case ParameterStructures\.auto:\s+if \(isNamedParam\(param\)\) \{\s+return nullToUndefined\(param\);\s+\} else \{\s+return \[undefinedToNull\(param\)\];/);
  expect(connection).toContain('await notificationHandler(...params);');

  for (const kind of ['html', 'css'] as const) {
    const sections = [JSON.parse(source(`${extensions}/${kind}-language-features/package.json`)).contributes.configuration].flat() as { properties: Record<string, { type: string; default: unknown }> }[];
    const declared = sections.map(section => section.properties[customDataSetting[kind]]).find(Boolean)!;
    expect([declared.type, declared.default]).toEqual(['array', []]);
  }
});
