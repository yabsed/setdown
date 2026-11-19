import { afterEach, beforeEach, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonSchemaContent, SchemaContentError, defaultTrustedDomains, isTrustedSchema, localhostAuthorities, matchesUrlPattern, schemaContentErrors, schemaDownloadDefault,
  schemaDownloadSetting, schemaDownloadSettings, schemaRefusals, schemastoreAddress, schemastoreFreshHours, type JsonSchemaContentOptions, type SchemaDownloadSettings } from './json-schema-content';

// The cache folder does not exist when a test starts, and it is the only thing in its parent.
let directory = '', clock = 0;
beforeEach(async () => { directory = path.join(await mkdtemp(path.join(os.tmpdir(), 'setdown-schema-test-')), 'json-schema-cache'); clock = Date.UTC(2026, 10, 19); });
afterEach(async () => { await rm(path.dirname(directory), { recursive: true, force: true }); });

type Call = { url: string; etag: string | null; agent: string | null };
/** A site in the place of the network: it records what it is asked and answers as the test says. */
function site(answer: (call: Call, signal?: AbortSignal | null) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    const headers = new Headers(init?.headers), call = { url: String(input), etag: headers.get('if-none-match'), agent: headers.get('user-agent') };
    calls.push(call);
    return answer(call, init?.signal);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}
/** A server that keeps one version of a schema and answers "not modified" to whoever names it. */
const versioned = (state: { text: string; etag?: string }) => (call: Call) =>
  state.etag && call.etag === state.etag ? new Response(null, { status: 304 }) : new Response(state.text, state.etag ? { headers: { etag: state.etag } } : {});
const cache = (fetch: typeof globalThis.fetch, more: Partial<JsonSchemaContentOptions> = {}) => new JsonSchemaContent({ directory, fetch, now: () => clock, ...more });
/** Settings with these trusted domains and nothing else, not even the defaults. */
const only = (trustedDomains: Record<string, boolean>, associated: string[] = []): SchemaDownloadSettings => ({ enable: true, trustedDomains, associated });
const anywhere = only({ '*': true });
const refusal = (answer: Promise<string>) => answer.then(() => undefined, (error: SchemaContentError) => [error.code, error.message]);
const stored = (address: string) => path.join(directory, `${createHash('sha256').update(address).digest('hex')}.schema.json`);
const listed = async () => JSON.parse(await readFile(path.join(directory, 'index.json'), 'utf8')) as Record<string, { etag: string; updateTime: number }>;
const hour = 60 * 60 * 1000;

// The cases of the extension's own test, client/src/test/schemaRequests.test.ts.
test('an entry of the trusted domains covers a domain, a port and a path, and the first that covers an address decides', () => {
  const domains = { 'https://*.trusted.example/private/': false, 'https://*.trusted.example/schemas/': true, 'https://api.trusted.example:8443/schemas/': true };
  expect([
    matchesUrlPattern('https://trusted.example/schemas/schema.json', domains),
    matchesUrlPattern('https://api.trusted.example/schemas/schema.json', domains),
    matchesUrlPattern('https://api.trusted.example:8443/schemas/schema.json', domains),
    matchesUrlPattern('https://api.trusted.example:8444/schemas/schema.json', domains),
    matchesUrlPattern('http://api.trusted.example/schemas/schema.json', domains),
    matchesUrlPattern('https://api.trusted.example/schemas-other/schema.json', domains),
    matchesUrlPattern('https://api.trusted.example/private/schema.json', domains),
    matchesUrlPattern('https://api.trusted.example/schema.json', { 'https://*.trusted.example': false, '*': true }),
    matchesUrlPattern('https://api.trusted.example/schema.json', { '*': false }),
    matchesUrlPattern('https://api.trusted.example:443/schemas/schema.json', { 'https://api.trusted.example:443/schemas/': true }),
    matchesUrlPattern('file:///schemas/schema.json', { 'file:///schemas/': true }),
  ]).toEqual([true, true, true, false, false, false, false, false, false, true, true]);
  // One schema and nothing beside or below its name's look-alikes; an entry that is no address covers nothing.
  const one = { '': true, '  ': true, 'https://': true, 'https://www.test.com/schemas/mySchema.json': true };
  expect(['https://www.test.com/schemas/mySchema.json', 'https://www.test.com/schemas/mySchema.json/v2', 'https://www.test.com/schemas/mySchema.json2', 'https://www.test.com/schemas/other.json']
    .map(address => matchesUrlPattern(address, one))).toEqual([true, true, false, false]);
  expect(matchesUrlPattern('https://example.com/a.json', {})).toBe(false);
});

test('an address is checked in the form it is requested in', () => {
  const disguised = 'https://attacker.example%5Cfake.trusted.example/schema.json';
  // A backslash that appears once the escapes are undone ends the host, as it does for the request.
  expect(matchesUrlPattern(disguised, { 'https://*.trusted.example': true })).toBe(false);
  expect(matchesUrlPattern(disguised, { 'https://attacker.example': false, '*': true })).toBe(false);
  expect(matchesUrlPattern('https://attacker.example%5Cfake.localhost/schema.json', {})).toBe(false);
  // `..` is resolved before the path is compared.
  expect(matchesUrlPattern('https://api.trusted.example/schemas/../private/schema.json', { 'https://*.trusted.example/schemas/': true })).toBe(false);
  expect(matchesUrlPattern('https://api.trusted.example/schemas/../private/schema.json', { 'https://*.trusted.example/private/': false, 'https://*.trusted.example': true })).toBe(false);
  // An escaped slash is undone once and no further.
  for (const separator of ['%252F', '%252f']) {
    expect(matchesUrlPattern(`https://api.trusted.example/schemas${separator}..${separator}private/schema.json`, { 'https://api.trusted.example/schemas/': true })).toBe(false);
  }
  expect([
    matchesUrlPattern('https://api.trusted.example/schema%20files/main.json', { 'https://api.trusted.example/schema%20files/': true }),
    matchesUrlPattern('https://api.trusted.example/schemas%252Fdata/main.json', { 'https://api.trusted.example/schemas%252Fdata/': true }),
    matchesUrlPattern('https://api.trusted.example/schemas%252F..%252Fprivate/schema.json', { 'https://api.trusted.example/schemas%252F..%252Fprivate/': false, 'https://api.trusted.example': true }),
    matchesUrlPattern('https://api.trusted.example/schemas/../private/schema.json', { 'https://api.trusted.example/schemas/': true }),
    matchesUrlPattern('https://api.trusted.example/schemas%255C..%255Cprivate/schema.json', { 'https://api.trusted.example/schemas/': true }),
  ]).toEqual([true, true, false, false, false]);
});

test("the person's settings are laid over the defaults", () => {
  expect(schemaDownloadSettings(undefined)).toEqual({ enable: true, trustedDomains: defaultTrustedDomains, associated: [] });
  expect(schemaDownloadSettings({}).trustedDomains).not.toBe(defaultTrustedDomains);
  // A default keeps its place when the person changes it, and their own entries follow.
  const own = schemaDownloadSettings({ json: { schemaDownload: { enable: false, trustedDomains: { 'https://example.com': true, 'https://json.schemastore.org/': false } } } });
  expect(own.enable).toBe(false);
  expect(Object.entries(own.trustedDomains)).toEqual([...Object.entries(defaultTrustedDomains).map(([pattern, trusted]) => [pattern, pattern === 'https://json.schemastore.org/' ? false : trusted]), ['https://example.com', true]]);
  // Both settings are taken by their truth, and a list of domains that is not an object trusts nothing.
  expect([0, '', null, 'false', 1].map(enable => schemaDownloadSettings({ json: { schemaDownload: { enable } } }).enable)).toEqual([false, false, false, true, true]);
  expect(schemaDownloadSettings({ json: { schemaDownload: { trustedDomains: { 'https://a.example': 'yes', 'https://b.example': 0 } } } }).trustedDomains).toMatchObject({ 'https://a.example': true, 'https://b.example': false });
  expect(['*', null, ['https://example.com']].map(trustedDomains => schemaDownloadSettings({ json: { schemaDownload: { trustedDomains } } }).trustedDomains)).toEqual([{}, {}, {}]);
  // The addresses `json.schemas` names: a `url`, or the `id` of a schema written out in place.
  const named = schemaDownloadSettings({ json: { schemas: [{ fileMatch: ['*.app.json'], url: 'https://internal.example/app.json' }, { fileMatch: ['/local.json'], url: './local.schema.json' },
    { fileMatch: ['inline.json'], schema: { id: 'https://internal.example/inline.json', type: 'object' } }, { fileMatch: ['anonymous.json'], schema: { type: 'object' } }, 'text', null] } });
  expect(named.associated).toEqual(['https://internal.example/app.json', './local.schema.json', 'https://internal.example/inline.json']);
});

test('a schema is trusted by its domain, by being named in the settings, or by being on this computer', () => {
  const defaults = schemaDownloadSettings({});
  expect(['https://json.schemastore.org/package.json', 'https://www.schemastore.org/tsconfig', 'https://raw.githubusercontent.com/microsoft/vscode/main/extensions/x.json',
    'https://json-schema.org/draft/2020-12/schema', 'https://developer.microsoft.com/json-schemas/teams/v1.16/MicrosoftTeams.schema.json'].map(address => isTrustedSchema(address, defaults))).toEqual([true, true, true, true, true]);
  // Another repository of a trusted site, plain http, a look-alike host, another path, an unknown domain.
  expect(['https://raw.githubusercontent.com/someone/else/main/x.json', 'http://json.schemastore.org/package.json', 'https://json.schemastore.org.example.com/package.json',
    'https://developer.microsoft.com/other/x.json', 'https://example.com/schema.json'].map(address => isTrustedSchema(address, defaults))).toEqual([false, false, false, false, false]);

  const own = schemaDownloadSettings({ json: { schemaDownload: { trustedDomains: { 'https://json.schemastore.org/': false, 'https://*.example.com': true, 'https://example.org/schemas/one.json': true } } } });
  expect(['https://json.schemastore.org/package.json', 'https://www.schemastore.org/tsconfig', 'https://example.com/a.json', 'https://api.example.com/a.json', 'https://example.org/schemas/one.json',
    'https://example.org/schemas/two.json'].map(address => isTrustedSchema(address, own))).toEqual([false, true, true, true, true, false]);

  // An address the settings assign to files is trusted in whatever way it is written, and only that one address.
  const named = schemaDownloadSettings({ json: { schemas: [{ fileMatch: ['*.app.json'], url: 'https://internal.example:443/schemas/../schemas/app.json' }, { fileMatch: ['x.json'], url: './local.schema.json' }] } });
  expect(['https://internal.example/schemas/app.json', 'https://INTERNAL.example/schemas/./app.json', 'https://internal.example/schemas/other.json', 'https://internal.example/schemas/app.json?v=2']
    .map(address => isTrustedSchema(address, named))).toEqual([true, true, false, false]);

  // This computer, whatever the trusted domains say.
  const nothing = only({ '*': false });
  expect(['http://localhost:8080/s.json', 'https://API.localhost/s.json', 'http://127.0.0.1:3000/s.json', 'http://[::1]/s.json'].map(address => isTrustedSchema(address, nothing))).toEqual([true, true, true, true]);
  expect(['http://localhost.example.com/s.json', 'http://notlocalhost/s.json', 'http://127.0.0.2/s.json'].map(address => isTrustedSchema(address, nothing))).toEqual([false, false, false]);
  // Only an http(s) address is ever downloaded.
  expect(['file:///schemas/s.json', 'file://localhost/schemas/s.json', 'untitled:Untitled-1', 'https://', ''].map(address => isTrustedSchema(address, anywhere))).toEqual([false, false, false, false, false]);
});

test('a refused download says what VS Code says and asks nothing of the network', async () => {
  const { fetch, calls } = site(() => new Response('{}')), schemas = cache(fetch);
  const disguised = 'https://attacker.example%5Cfake.trusted.example/schema.json';
  const off = schemaDownloadSettings({ json: { schemaDownload: { enable: false, trustedDomains: { '*': true } } } });
  expect(await refusal(schemas.content('https://json.schemastore.org/package.json', off))).toEqual([4, "Downloading schemas is disabled through setting 'json.schemaDownload.enable'"]);
  // Downloads being off is said before the address is looked at.
  expect(await refusal(schemas.content(disguised, off))).toEqual([4, "Downloading schemas is disabled through setting 'json.schemaDownload.enable'"]);
  // The address is named in the form it would have been requested in.
  expect(await refusal(schemas.content(disguised, only({ 'https://*.trusted.example': true })))).toEqual([2, 'Location https://attacker.example/fake.trusted.example/schema.json is untrusted']);
  expect(await refusal(schemas.content('https://example.com:443/schemas/../a.json', schemaDownloadSettings({})))).toEqual([2, 'Location https://example.com/a.json is untrusted']);
  expect(await refusal(schemas.content('https://api.trusted.example/private/schema.json', only({ 'https://*.trusted.example/private/': false, '*': true }))))
    .toEqual([2, 'Location https://api.trusted.example/private/schema.json is untrusted']);
  for (const separator of ['%252F', '%252f']) {
    expect((await refusal(schemas.content(`https://api.trusted.example/schemas${separator}..${separator}private/schema.json`, only({ 'https://api.trusted.example/schemas/': true }))))?.[0]).toBe(2);
  }
  const refused = await schemas.content('https://example.com/a.json', schemaDownloadSettings({})).catch(error => error);
  expect(refused).toBeInstanceOf(SchemaContentError);
  expect(refused).toBeInstanceOf(Error);
  // An address that cannot be requested, and one of a kind that is never downloaded.
  expect(await refusal(schemas.content('https://', anywhere))).toEqual([5, 'TypeError: Invalid URL']);
  for (const other of ['file:///schemas/a.json', 'untitled:Untitled-1', 'vscode://schemas/settings/user', 'schemas/a.json', 'HTTPS://example.com/a.json']) {
    const error = await schemas.content(other, anywhere).catch(error => error);
    expect(error).not.toBeInstanceOf(SchemaContentError);
    expect(error.message).toBe(`Only an http or https schema is downloaded, and ${other} is neither`);
  }
  await expect(schemas.content('https:////example.com/a.json', anywhere)).rejects.toThrow('is not an address');
  expect(calls).toEqual([]);
  expect(existsSync(directory)).toBe(false);
});

test('the address that was checked is the one that is requested', async () => {
  const { fetch, calls } = site(() => new Response('{"type":"object"}')), schemas = cache(fetch);
  const configured = 'https://configured.example:443/schemas/../schemas/schema name.json';
  expect(await schemas.content('https://api.trusted.example/schemas/../schemas/schema%20name.json', only({ 'https://*.trusted.example/schemas/': true }))).toBe('{"type":"object"}');
  await schemas.content(configured, only({}, [configured]));
  await schemas.content('https://api.trusted.example:8443/schemas/schema.json', only({ 'https://api.trusted.example:8443/schemas/': true }));
  await schemas.content('https:///example.com/a.json?x=%23#part', anywhere);
  expect(calls.map(call => call.url)).toEqual(['https://api.trusted.example/schemas/schema%20name.json', 'https://configured.example/schemas/schema%20name.json',
    'https://api.trusted.example:8443/schemas/schema.json', 'https://example.com/a.json?x=%23#part']);
  expect(calls[0].agent).toBe('Setdown (desktop)');
});

test('a schema is stored with its version, asked for by it, and answered from disk when it is unchanged', async () => {
  const address = 'https://example.com/schemas/app.json', state: { text: string; etag?: string } = { text: '{"title":"one"}', etag: '"v1"' };
  const { fetch, calls } = site(versioned(state)), schemas = cache(fetch, { userAgent: 'Other (test)' });
  expect(await schemas.content(address, anywhere)).toBe('{"title":"one"}');
  expect(calls).toEqual([{ url: address, etag: null, agent: 'Other (test)' }]);
  expect(await readFile(stored(address), 'utf8')).toBe('{"title":"one"}');
  expect(await listed()).toEqual({ [address]: { etag: '"v1"', updateTime: clock } });
  // The second request names the version. "Not modified" is answered with what is on disk.
  await writeFile(stored(address), '{"title":"on disk"}');
  clock += hour;
  expect(await schemas.content(address, anywhere)).toBe('{"title":"on disk"}');
  expect(calls[1]).toEqual({ url: address, etag: '"v1"', agent: 'Other (test)' });
  expect(await listed()).toEqual({ [address]: { etag: '"v1"', updateTime: clock } });
  // The cache outlives the program, and a new version replaces the old one.
  state.text = '{"title":"two"}'; state.etag = '"v2"';
  const restarted = cache(fetch);
  expect(await restarted.content(address, anywhere)).toBe('{"title":"two"}');
  expect(calls[2].etag).toBe('"v1"');
  expect(await readFile(stored(address), 'utf8')).toBe('{"title":"two"}');
  expect((await listed())[address].etag).toBe('"v2"');
  // A schema the server names no version of is answered and not kept; the stored one stays as it is.
  state.text = '﻿{"title":"three"}'; state.etag = undefined;
  expect(await restarted.content(address, anywhere)).toBe('﻿{"title":"three"}');
  expect(await readFile(stored(address), 'utf8')).toBe('{"title":"two"}');
  const unversioned = 'https://example.com/schemas/plain.json';
  await restarted.content(unversioned, anywhere); await restarted.content(unversioned, anywhere);
  expect(calls.slice(-2)).toMatchObject([{ url: unversioned, etag: null }, { url: unversioned, etag: null }]);
  expect(Object.keys(await listed())).toEqual([address]);
  expect((await readdir(directory)).sort()).toEqual([path.basename(stored(address)), 'index.json'].sort());
});

test('a schemastore.org schema is answered from disk for two days', async () => {
  const address = 'https://json.schemastore.org/package.json', state = { text: '{"title":"one"}', etag: '"v1"' };
  const { fetch, calls } = site(versioned(state)), schemas = cache(fetch);
  expect(schemastoreFreshHours).toBe(48);
  expect(await schemas.content('https://json.schemastore.org:443/package.json', anywhere)).toBe('{"title":"one"}');
  // Other ways of writing the address are the same schema.
  state.text = '{"title":"two"}'; state.etag = '"v2"';
  expect(await schemas.content('https://json.schemastore.org/folder/../package.json', anywhere)).toBe('{"title":"one"}');
  clock += 48 * hour - 1;
  expect(await schemas.content(address, anywhere)).toBe('{"title":"one"}');
  expect(calls).toEqual([{ url: address, etag: null, agent: 'Setdown (desktop)' }]);
  // At two days the server is asked again, by the version on disk.
  clock += 1;
  expect(await schemas.content(address, anywhere)).toBe('{"title":"two"}');
  expect(calls.slice(1)).toMatchObject([{ url: address, etag: '"v1"' }]);
  // An answer from disk does not start the two days again; "not modified" does.
  clock += 47 * hour; await schemas.content(address, anywhere);
  expect(calls).toHaveLength(2);
  clock += 2 * hour;
  expect(await schemas.content(address, anywhere)).toBe('{"title":"two"}');
  expect(calls.slice(2)).toMatchObject([{ url: address, etag: '"v2"' }]);
  clock += 47 * hour; await schemas.content(address, anywhere);
  expect(calls).toHaveLength(3);
  // The rule is for json. and www.schemastore.org over http(s). Any other site is asked every time.
  expect(['https://www.schemastore.org/tsconfig', 'http://json.schemastore.org/x', 'https://schemastore.org/x', 'https://json.schemastore.org.example.com/x', 'https://raw.githubusercontent.com/microsoft/vscode/x']
    .map(other => schemastoreAddress.test(other))).toEqual([true, true, false, false, false]);
  const other = 'https://example.com/package.json';
  await schemas.content(other, anywhere); await schemas.content(other, anywhere);
  expect(calls.slice(3)).toMatchObject([{ url: other, etag: null }, { url: other, etag: '"v2"' }]);
  // A copy that is listed and no longer on disk is fetched again.
  await rm(stored(address));
  expect(await schemas.content(address, anywhere)).toBe('{"title":"two"}');
  expect(calls.slice(5)).toMatchObject([{ url: address, etag: null }]);
});

test('a request that fails is worded as VS Code words it, with or without a copy on disk', async () => {
  const address = 'https://example.com/a.json', state = { text: '{"title":"one"}', etag: '"v1"' };
  let down: Response | Error | undefined = Object.assign(new TypeError('fetch failed'), { cause: new Error('getaddrinfo ENOTFOUND example.com') });
  const { fetch, calls } = site(call => { if (down instanceof Error) throw down; return down ?? versioned(state)(call); }), schemas = cache(fetch);
  const unreachable = [5, `Not Found. The requested location could not be found.\nUnable to connect to ${address}. Error: getaddrinfo ENOTFOUND example.com`];
  expect(await refusal(schemas.content(address, anywhere))).toEqual(unreachable);
  // The extension does not fall back to the copy on disk. The copy stays for when the site is back.
  down = undefined; await schemas.content(address, anywhere);
  down = Object.assign(new TypeError('fetch failed'), { cause: new Error('getaddrinfo ENOTFOUND example.com') });
  expect(await refusal(schemas.content(address, anywhere))).toEqual(unreachable);
  expect(calls.at(-1)?.etag).toBe('"v1"');
  expect(await readFile(stored(address), 'utf8')).toBe('{"title":"one"}');
  // Within its two days a schemastore.org schema needs no network at all.
  const store = 'https://www.schemastore.org/tsconfig';
  down = undefined; await schemas.content(store, anywhere);
  down = new TypeError('offline'); clock += hour;
  expect(await schemas.content(store, anywhere)).toBe('{"title":"one"}');
  clock += 48 * hour;
  expect(await refusal(schemas.content(store, anywhere))).toEqual([5, `Not Found. The requested location could not be found.\nUnable to connect to ${store}. Error: offline`]);
  // The sentence for the status, then the first 200 characters the server sent.
  down = new Response('x'.repeat(300), { status: 404 });
  expect(await refusal(schemas.content(address, anywhere))).toEqual([5, `Not Found. The requested location could not be found.\n${'x'.repeat(200)}`]);
  down = new Response('maintenance', { status: 503 });
  expect(await refusal(schemas.content(address, anywhere))).toEqual([5, 'Service Unavailable. The server is currently unavailable (overloaded or down).\nmaintenance']);
  down = new Response(null, { status: 500 });
  expect(await refusal(schemas.content(address, anywhere))).toEqual([5, 'Internal Server Error.']);
  down = new Response('tea', { status: 418 });
  expect(await refusal(schemas.content(address, anywhere))).toEqual([5, 'HTTP status code 418\ntea']);
  // "Not modified" to a request that named no version is not an answer.
  down = new Response(null, { status: 304 });
  expect(await refusal(schemas.content('https://example.com/never-stored.json', anywhere))).toEqual([5, 'HTTP status code 304']);
  // A body that breaks off.
  down = new Response(new ReadableStream({ start(controller) { controller.error(new Error('socket hang up')); } }));
  expect(await refusal(schemas.content(address, anywhere))).toEqual([5, `Internal Server Error.\nUnable to access ${address}. Error: socket hang up`]);
  expect(await readFile(stored(address), 'utf8')).toBe('{"title":"one"}');
});

test('a cache that is missing, unreadable or pointing elsewhere is started again', async () => {
  const address = 'https://example.com/a.json', state = { text: '{"title":"one"}', etag: '"v1"' };
  // A list that is not JSON, and one whose entries are not entries.
  for (const list of ['not json {', '[]', JSON.stringify({ [address]: { etag: 5, updateTime: 'x' }, other: 'text', none: null })]) {
    await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, 'index.json'), list);
    const { fetch, calls } = site(versioned(state));
    expect(await cache(fetch).content(address, anywhere)).toBe('{"title":"one"}');
    expect(calls).toMatchObject([{ etag: null }]);
    expect(await listed()).toEqual({ [address]: { etag: '"v1"', updateTime: clock } });
  }
  // A listed schema whose file is gone: "not modified" cannot be answered, so it is asked for again without the version.
  await rm(stored(address));
  const { fetch, calls } = site(versioned(state));
  expect(await cache(fetch).content(address, anywhere)).toBe('{"title":"one"}');
  expect(calls).toMatchObject([{ etag: '"v1"' }, { etag: null }]);
  expect(await readFile(stored(address), 'utf8')).toBe('{"title":"one"}');
  // A list written by something else cannot point a read or a write outside the folder.
  const outside = path.join(path.dirname(directory), 'outside.json');
  await writeFile(outside, '{"title":"outside"}'); await rm(stored(address));
  await writeFile(path.join(directory, 'index.json'), JSON.stringify({ [address]: { etag: '"v1"', fileName: '../outside.json', updateTime: clock } }));
  expect(await cache(site(versioned(state)).fetch).content(address, anywhere)).toBe('{"title":"one"}');
  const awkward = 'https://example.com/..%2F..%2Foutside.json?name=../../outside.json';
  expect(await cache(site(versioned(state)).fetch).content(awkward, anywhere)).toBe('{"title":"one"}');
  expect(await readFile(outside, 'utf8')).toBe('{"title":"outside"}');
  expect((await readdir(path.dirname(directory))).sort()).toEqual(['json-schema-cache', 'outside.json']);
  expect((await readdir(directory)).every(name => name === 'index.json' || /^[0-9a-f]{64}\.schema\.json$/.test(name))).toBe(true);
  expect(await readdir(directory)).toHaveLength(3);
  // A folder that cannot be made: the schema is answered and simply not kept.
  await rm(directory, { recursive: true }); await writeFile(directory, 'a file where the folder should be');
  const blocked = site(versioned(state)), unkept = cache(blocked.fetch);
  expect(await unkept.content(address, anywhere)).toBe('{"title":"one"}');
  expect(await unkept.content(address, anywhere)).toBe('{"title":"one"}');
  expect(blocked.calls).toMatchObject([{ etag: null }, { etag: null }]);
  expect(await readFile(directory, 'utf8')).toBe('a file where the folder should be');
});

test('requests for one address at the same moment share one download', async () => {
  let release = (): void => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  const { fetch, calls } = site(async call => { await held; return new Response(`{"from":"${call.url}"}`, { headers: { etag: '"v1"' } }); }), schemas = cache(fetch);
  const one = 'https://example.com/one.json', two = 'https://example.com/two.json';
  const answers = Promise.all([schemas.content(one, anywhere), schemas.content('https://example.com:443/./one.json', anywhere), schemas.content(one, anywhere), schemas.content(two, anywhere),
    refusal(schemas.content(one, schemaDownloadSettings({})))]);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(calls.map(call => call.url).sort()).toEqual([one, two]);
  release();
  // Whoever may not download is refused even while the download of another is under way.
  expect(await answers).toEqual([`{"from":"${one}"}`, `{"from":"${one}"}`, `{"from":"${one}"}`, `{"from":"${two}"}`, [2, `Location ${one} is untrusted`]]);
  expect(calls.map(call => call.url).sort()).toEqual([one, two]);
  // Both are on the list, though they were stored at the same time.
  expect(Object.keys(await listed()).sort()).toEqual([one, two]);
  expect((await readdir(directory)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  // The next request is a request again.
  await schemas.content(one, anywhere);
  expect(calls.slice(2)).toMatchObject([{ url: one, etag: '"v1"' }]);
});

test('a schema that is too large or too slow is refused', async () => {
  const address = 'https://example.com/a.json';
  const large = site(() => new Response('123456789', { headers: { etag: '"v1"' } }));
  expect(await refusal(cache(large.fetch, { maxBytes: 8 }).content(address, anywhere))).toEqual([5, 'The schema is larger than 8 bytes']);
  expect(await cache(large.fetch, { maxBytes: 9 }).content(address, anywhere)).toBe('123456789');
  await rm(directory, { recursive: true });
  // A server that states the length is not read at all.
  const stated = site(() => new Response('{}', { headers: { etag: '"v1"', 'content-length': String(16 * 1024 * 1024 + 1) } }));
  expect(await refusal(cache(stated.fetch).content(address, anywhere))).toEqual([5, 'The schema is larger than 16 MiB']);
  expect(existsSync(directory)).toBe(false);
  // Of an error page the beginning is enough.
  const page = site(() => new Response(new ReadableStream({ start(controller) { for (const part of ['12345', '67890', 'abcde']) controller.enqueue(new TextEncoder().encode(part)); controller.close(); } }), { status: 404 }));
  expect(await refusal(cache(page.fetch, { maxBytes: 12 }).content(address, anywhere))).toEqual([5, 'Not Found. The requested location could not be found.\n1234567890']);

  // A server that never answers, asked through a `fetch` that gives up when told to and one that does not.
  const patient = site((_call, signal) => new Promise<Response>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason))));
  expect(await refusal(cache(patient.fetch, { timeoutMs: 20 }).content(address, anywhere))).toEqual([5, 'The schema did not arrive within 0.02 seconds']);
  const deaf = site(() => new Promise<Response>(() => {})), schemas = cache(deaf.fetch, { timeoutMs: 20 });
  expect(await refusal(schemas.content(address, anywhere))).toEqual([5, 'The schema did not arrive within 0.02 seconds']);
  // The address is not held by the request that was given up on.
  expect(await refusal(schemas.content(address, anywhere))).toEqual([5, 'The schema did not arrive within 0.02 seconds']);
  expect(deaf.calls).toHaveLength(2);
});

// What was copied from the VS Code JSON extension is compared with the copy in `vendor`, so a
// newer submodule that changes it fails here and not in someone's project.
const upstream = fileURLToPath(new URL('../../../../../vendor/vscode/extensions/json-language-features', import.meta.url));
test.skipIf(!existsSync(path.join(upstream, 'package.json')))('the copied defaults, limits and texts are the ones vendor/vscode states', () => {
  const read = (file: string) => readFileSync(path.join(upstream, file), 'utf8');
  const contributed = JSON.parse(read('package.json')).contributes.configuration as unknown;
  const property = (name: string) => (Array.isArray(contributed) ? contributed : [contributed]).map(category => category?.properties?.[name]).find(Boolean);
  expect(property(schemaDownloadSetting).default).toBe(schemaDownloadDefault);
  expect(Object.entries(property('json.schemaDownload.trustedDomains').default)).toEqual(Object.entries(defaultTrustedDomains));

  const client = read('client/src/jsonClient.ts'), main = read('client/src/node/jsonClientMain.ts'), disk = read('client/src/node/schemaCache.ts'), match = read('client/src/utils/urlMatch.ts');
  expect(client).toContain(`export const enableSchemaDownload = '${schemaDownloadSetting}';`);
  expect(client).toContain("export const trustedDomains = 'json.schemaDownload.trustedDomains';");
  // The server is told to load only files itself, which is why every http(s) schema arrives here.
  expect(client).toContain("handledSchemaProtocols: ['file']");
  const said = (text: string) => `l10n.t('${text.replaceAll("'", "\\'")}', `;
  expect(client).toContain(`${said(schemaRefusals.disabled)}SettingIds.enableSchemaDownload)`);
  expect(client).toContain(`${said(schemaRefusals.untrusted)}requestUrl.href)`);
  const code = (name: string) => Number(new RegExp(`\\b${name} = (\\d+),`).exec(client)?.[1]);
  expect({ untrustedSchema: code('UntrustedSchemaError'), httpDisabled: code('HTTPDisabledError'), http: code('HTTPError') }).toEqual(schemaContentErrors);

  const hours = /const retryTimeoutInHours = (\d+) \* (\d+);/.exec(main);
  expect(Number(hours?.[1]) * Number(hours?.[2])).toBe(schemastoreFreshHours);
  expect(main).toContain(`if (cache && ${schemastoreAddress}.test(uri))`);
  expect(main).toContain('cache.getSchemaIfUpdatedSince(uri, retryTimeoutInHours)');
  expect(disk).toContain('lastUpdatedInHours < expirationDurationInHours');
  expect(disk).toContain("return `${createHash('sha256').update(uri).digest('hex')}.schema.json`;");
  expect(['rLocalhost', 'r127', 'rIPv6Localhost'].map(name => new RegExp(`const ${name} = (.+);`).exec(match)?.[1])).toEqual(localhostAuthorities.map(String));
  // The sentences for a failed request are request-light's, which is not in `vendor`. They were
  // read from this version; when the extension locks another, they are to be read again.
  expect(JSON.parse(read('package-lock.json')).packages['node_modules/request-light'].version).toBe('0.8.0');
});
