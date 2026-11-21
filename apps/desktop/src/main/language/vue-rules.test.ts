import { expect, test, vi } from 'vitest';
import { tsserverRequestCommand, vueQuestions, vueRules, vueTsserverRequest, vueTsserverResponse } from './vue-rules';
import { toolRules } from './tool-rules';
import { builtinLanguageServers } from './catalog/profiles';

const context = { name: 'vue-language-server', root: '/project', settings: {} };
const relay = () => vueRules(context)!.relays![vueTsserverRequest];

test('one question arrives as it is and several as a list', () => {
  expect(vueQuestions([7, '_vue:projectInfo', { file: '/a.vue' }])).toEqual([[7, '_vue:projectInfo', { file: '/a.vue' }]]);
  expect(vueQuestions([[1, 'a', null], [2, 'b', {}], 'noise', [3]])).toEqual([[1, 'a', null], [2, 'b', {}]]);
  expect(vueQuestions(undefined)).toEqual([]);
});

test("a question of Vue's server is run by TypeScript's server and its body goes back under the same number", async () => {
  const ask = vi.fn(async () => ({ body: { configFileName: '/project/tsconfig.json' }, success: true }));
  expect(await relay()([[4, '_vue:projectInfo', { file: '/project/a.vue', needFileNameList: false }]], ask)).toEqual([
    { method: vueTsserverResponse, params: [4, { configFileName: '/project/tsconfig.json' }] }]);
  expect(ask).toHaveBeenCalledWith('typescript', 'workspace/executeCommand', { command: tsserverRequestCommand, arguments: ['_vue:projectInfo', { file: '/project/a.vue', needFileNameList: false }] });
});

test("without a TypeScript server, or when the command fails, Vue's server is told so instead of waiting for good", async () => {
  expect(await relay()([[9, '_vue:quickinfo', {}]], async () => { throw Error('No typescript tool is running for this project.'); })).toEqual([{ method: vueTsserverResponse, params: [9, null] }]);
  expect(await relay()([[10, '_vue:quickinfo', {}]], async () => undefined)).toEqual([{ method: vueTsserverResponse, params: [10, null] }]);
  expect(await relay()([[11, '_vue:quickinfo', {}]], async () => ({ success: false }))).toEqual([{ method: vueTsserverResponse, params: [11, null] }]);
});

test("Vue's tool gets these rules by what it is, under whichever catalog names it", () => {
  const vue = builtinLanguageServers.find(profile => profile.id === 'vue-language-server')!;
  expect(Object.keys(toolRules(vue, context, {})?.relays ?? {})).toEqual([vueTsserverRequest]);
  const typescript = builtinLanguageServers.find(profile => profile.id === 'typescript-language-server')!;
  expect(toolRules(typescript, context, {})?.relays).toBeUndefined();
});
