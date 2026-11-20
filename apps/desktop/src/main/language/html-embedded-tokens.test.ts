import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { htmlSemanticLegend, htmlSemanticLegendRequest, htmlSemanticTokenData, htmlSemanticTokenLegendMethod, htmlSemanticTokensMethod, htmlSemanticTokensParams, htmlSemanticTokensProvider } from './html-embedded-tokens';

const html = path.resolve(__dirname, '../../../../../vendor/vscode/extensions/html-language-features');
const source = (file: string) => readFileSync(path.join(html, file), 'utf8');

/** The legend of the server's JavaScript mode, read from its source: `tokenTypes[TokenType.class] = 'class'` under `const enum TokenType { class = 0, … }`. */
function vendorLegend(): { types: string[]; modifiers: string[] } {
  const text = source('server/src/modes/javascriptSemanticTokens.ts');
  const list = (table: string, numbering: string) => {
    const numbers = Object.fromEntries([...new RegExp(`const enum ${numbering} \\{([^}]*)\\}`).exec(text)![1].matchAll(/(\w+) = (\d+)/g)].map(match => [match[1], Number(match[2])]));
    const result: string[] = [];
    for (const match of text.matchAll(new RegExp(`${table}\\[${numbering}\\.(\\w+)\\] = '(\\w+)';`, 'g'))) result[numbers[match[1]]] = match[2];
    return result;
  };
  return { types: list('tokenTypes', 'TokenType'), modifiers: list('tokenModifiers', 'TokenModifier') };
}

test('the server\'s legend becomes the protocol\'s legend, with every name in its place', () => {
  const answered = vendorLegend();
  expect(answered).toEqual({ types: ['class', 'enum', 'interface', 'namespace', 'typeParameter', 'type', 'parameter', 'variable', 'enumMember', 'property', 'function', 'method'],
    modifiers: ['declaration', 'static', 'async', 'readonly', 'defaultLibrary', 'local'] });
  const legend = htmlSemanticLegend(answered)!;
  expect(legend).toEqual({ tokenTypes: answered.types, tokenModifiers: answered.modifiers });
  expect(legend.tokenTypes).not.toBe(answered.types);
  // A legend without modifiers is a legend; one without types colours nothing.
  expect(htmlSemanticLegend({ types: ['variable'], modifiers: [] })).toEqual({ tokenTypes: ['variable'], tokenModifiers: [] });
  expect(htmlSemanticLegend({ types: [], modifiers: [] })).toBeUndefined();
  // `null` is the server's answer when it failed. A missing name would shift the meaning of every later number.
  for (const nothing of [null, undefined, 'legend', 7, [], {}, { types: ['variable'] }, { modifiers: [] }, { types: 'variable', modifiers: [] }, { types: ['class', null, 'enum'], modifiers: [] },
    { types: ['class', ''], modifiers: [] }, { types: ['class'], modifiers: [7] }, { types: ['class'], modifiers: Array.from({ length: 33 }, (_, index) => `m${index}`) },
    { types: Array.from({ length: 257 }, (_, index) => `t${index}`), modifiers: [] }, { types: ['x'.repeat(129)], modifiers: [] }]) expect(htmlSemanticLegend(nothing), JSON.stringify(nothing)).toBeUndefined();
});

test('Setdown states whole-document semantic tokens under that legend, without delta or range', () => {
  const legend = { tokenTypes: ['class', 'variable'], tokenModifiers: ['declaration'] };
  const provider = htmlSemanticTokensProvider(legend);
  expect(provider).toEqual({ legend, full: true });
  expect(provider.legend.tokenTypes).not.toBe(legend.tokenTypes);
});

test('the document is asked for as a whole, or for ranges', () => {
  const uri = 'file:///project/index.html', range = { start: { line: 3, character: 0 }, end: { line: 40, character: 0 } };
  expect(htmlSemanticTokensParams(uri)).toEqual({ textDocument: { uri } });
  expect(htmlSemanticTokensParams(uri, range)).toEqual({ textDocument: { uri }, ranges: [range] });
});

test('the answer is handed on as the protocol\'s data once it is known to be that encoding', () => {
  // <script> on line 2: `const a = 1` then `a` two lines below: variable+declaration+readonly, then variable+readonly.
  const data = [2, 8, 1, 7, 0b1001, 2, 2, 1, 7, 0b1000];
  expect(htmlSemanticTokenData(data)).toEqual(data);
  expect(htmlSemanticTokenData([])).toEqual([]);
  expect(htmlSemanticTokenData([0, 0, 1, 0, 0xffffffff])).toEqual([0, 0, 1, 0, 0xffffffff]);
  for (const nothing of [null, undefined, 'data', {}, { data }, [1, 2, 3], [0, 0, 1, 0], [0, 0, 1, 0, -1], [0, 0, 1.5, 0, 0], [0, 0, '1', 0, 0], [0, 0, 1, 0, 0x100000000], [0, 0, 1, 0, NaN], [0, 0, 1, null, 0]])
    expect(htmlSemanticTokenData(nothing), JSON.stringify(nothing)).toBeUndefined();
  expect(htmlSemanticTokenData(new Array(5_000_005).fill(0))).toBeUndefined();
});

test('the requests, their parameters and the encoding are the HTML extension\'s', () => {
  const client = source('client/src/htmlClient.ts'), server = source('server/src/htmlServer.ts');
  for (const text of [client, server]) {
    expect(text).toContain(`RequestType<SemanticTokenParams, number[] | null, any> = new RequestType('${htmlSemanticTokensMethod}')`);
    expect(text).toContain(`RequestType0<{ types: string[]; modifiers: string[] } | null, any> = new RequestType0('${htmlSemanticTokenLegendMethod}')`);
  }
  expect(client).toMatch(/interface SemanticTokenParams \{\s+textDocument: TextDocumentIdentifier;\s+ranges\?: LspRange\[\];\s+\}/);
  // The legend is asked once the client runs; a provider is registered only when there is one.
  expect(client).toMatch(/client\.sendRequest\(SemanticTokenLegendRequest\.type\)\.then\(legend => \{\s+if \(legend\) \{/);
  expect(client).toContain('new SemanticTokensLegend(legend.types, legend.modifiers)');
  // The legend handler's only argument is its cancellation token, read where nothing catches a failure:
  // the request is written with an empty list of parameters, never with `null` for them.
  expect(htmlSemanticLegendRequest).toEqual({ method: 'html/semanticTokenLegend', params: [] });
  expect(server).toMatch(/connection\.onRequest\(SemanticTokenLegendRequest\.type, token => \{\s+return runSafe\(runtime, async \(\) => \{\s+return getSemanticTokenProvider\(\)\.legend;\s+\}, null, `Error while computing semantic tokens legend`, token\);/);
  expect(source('server/src/utils/runner.ts')).toMatch(/runtime\.timer\.setImmediate\(\(\) => \{\s+if \(token\.isCancellationRequested\) \{/);
  const connection = readFileSync(path.resolve(html, '../../../vscode-languageserver-node/jsonrpc/src/common/connection.ts'), 'utf8');
  expect(connection).toContain('handlerResult = requestHandler(...requestMessage.params, cancellationSource.token);');
  expect(connection).toContain('handlerResult = requestHandler(requestMessage.params, cancellationSource.token);');
  // The numbers go to the editor unchanged.
  expect(client.match(/return data && new SemanticTokens\(new Uint32Array\(data\)\);/g)).toHaveLength(2);
  expect(client).toContain('ranges: [client.code2ProtocolConverter.asRange(range)]');
  // Only the provider for a whole document is registered, for the documents the extension serves.
  expect(client).toContain('languages.registerDocumentSemanticTokensProvider(documentSelector, provider,');
  expect(client).not.toContain('registerDocumentRangeSemanticTokensProvider');
  // The server: `null` without the document, the ranges handed to the encoder.
  expect(server).toMatch(/const document = documents\.get\(params\.textDocument\.uri\);\s+if \(document\) \{\s+return getSemanticTokenProvider\(\)\.getSemanticTokens\(document, params\.ranges\);\s+\}\s+return null;/);
  // The server does not state semantic tokens among its capabilities.
  const stated = server.slice(server.indexOf('const capabilities: ServerCapabilities = {'), server.indexOf('return { capabilities };'));
  expect(stated).toContain('linkedEditingRangeProvider: true');
  expect(stated).not.toMatch(/semanticTokens/i);
  // Five numbers a token, relative as the protocol has them.
  const encoder = source('server/src/modes/semanticTokens.ts').replace(/\s*\/\/[^\n]*/g, '');
  expect(encoder).toMatch(/if \(prefLine !== start\.line\) \{\s+prevChar = 0;\s+\}\s+encodedResult\.push\(start\.line - prefLine\);\s+encodedResult\.push\(start\.character - prevChar\);\s+encodedResult\.push\(curr\.length\);\s+encodedResult\.push\(curr\.typeIdx\);\s+encodedResult\.push\(curr\.modifierSet\);/);
  expect(encoder).toContain('beforeOrSame({ line: start.line, character: start.character + curr.length }, currRange.end)');
  // Tokens come from the script modes only: no other mode has a legend.
  expect(source('server/src/modes/javascriptMode.ts')).toContain('getSemanticTokenLegend(): { types: string[]; modifiers: string[] } {');
  for (const mode of ['htmlMode.ts', 'cssMode.ts']) expect(source(`server/src/modes/${mode}`)).not.toContain('getSemanticTokenLegend');
});
