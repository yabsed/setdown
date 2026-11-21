import { expect, test } from 'vitest';
import { contributed, describeContributions, joinSettings, usable, withContributions, type Contribution } from './tool-contributions';

// What the Vue, Marko and Astro extensions answered for typescript-language-server on 2026-11-22
// (`reports/framework-tools-2026-11-22`), with the folders shortened.
const vue: Contribution = { server: 'vue-language-server', initializationOptions: { plugins: [{ name: '@vue/typescript-plugin', location: '/work/vue', languages: ['typescript', 'vue.js'] }] }, settings: null };
const marko: Contribution = { server: 'marko', initializationOptions: { plugins: [{ name: '@marko/ts-plugin', location: '/work/marko' }] }, settings: null };

test('two extensions each bring an entry of the same list and neither removes the other', () => {
  expect(contributed([vue, marko]).initializationOptions).toEqual({ plugins: [
    { name: '@vue/typescript-plugin', location: '/work/vue', languages: ['typescript', 'vue.js'] },
    { name: '@marko/ts-plugin', location: '/work/marko' }] });
});

test("the tool's own options win, and its own entry of a list replaces the contributed one of the same name", () => {
  const profile = { configuration: { typescript: { format: { semicolons: 'remove' } } },
    initializationOptions: { maxTsServerMemory: 3072, plugins: [{ name: '@vue/typescript-plugin', location: '/project' }] } };
  const joined = withContributions(profile, [vue, marko, { server: 'other', initializationOptions: { maxTsServerMemory: 1 }, settings: { typescript: { format: { semicolons: 'insert', enable: true } } } }]);
  expect(joined.initializationOptions).toEqual({ maxTsServerMemory: 3072, plugins: [
    { name: '@marko/ts-plugin', location: '/work/marko' }, { name: '@vue/typescript-plugin', location: '/project' }] });
  expect(joined.configuration).toEqual({ typescript: { format: { semicolons: 'remove', enable: true } } });
});

test('a tool nobody adds anything to keeps the very same options', () => {
  const profile = { configuration: {}, initializationOptions: { a: 1 } };
  expect(withContributions(profile, [])).toBe(profile);
});

test('lists are joined, objects merged, and a key that could reach the prototype is dropped', () => {
  expect(joinSettings({ list: [1, 2], nested: { a: 1, b: 1 } }, { list: [2, 3], nested: { b: 2 }, plain: 'x' })).toEqual({ list: [1, 2, 3], nested: { a: 1, b: 2 }, plain: 'x' });
  const joined = joinSettings({}, JSON.parse('{"__proto__":{"polluted":true},"kept":1}'));
  expect(joined).toEqual({ kept: 1 }); expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
});

test('an answer that names a folder or a package that is not there is not used', () => {
  const found = (location: string, name?: string) => location === '/work/vue' && (!name || name === '@vue/typescript-plugin');
  expect(usable(vue, found)).toBe(true);
  // The Marko tool was never set up: its folder does not exist.
  expect(usable(marko, found)).toBe(false);
  // The folder is there but the package is not in it.
  expect(usable({ server: 'x', initializationOptions: { plugins: [{ name: 'missing-plugin', location: '/work/vue' }] } }, found)).toBe(false);
  // vtsls takes the same entry in its settings.
  expect(usable({ server: 'x', settings: { vtsls: { tsserver: { globalPlugins: [{ name: '@vue/typescript-plugin', location: '/elsewhere' }] } } } }, found)).toBe(false);
  expect(usable({ server: 'x', initializationOptions: { anything: true } }, () => false)).toBe(true);
});

test("the tool's page names what was added and by which tool", () => {
  expect(describeContributions([vue, marko])).toBe('@vue/typescript-plugin (vue-language-server); @marko/ts-plugin (marko)');
  // Without a named package, the options that were set.
  expect(describeContributions([{ server: 'x', settings: { vtsls: { tsserver: {} } }, initializationOptions: { hostInfo: 'zed' } }])).toBe('hostInfo, vtsls (x)');
  expect(describeContributions([{ server: 'silent' }])).toBe('');
  expect(describeContributions([{ server: 'a\nb'.repeat(60), initializationOptions: { ['k'.repeat(200)]: 1 } }]).length).toBeLessThanOrEqual(600);
});
