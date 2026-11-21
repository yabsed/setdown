import type { ToolRulesFactory } from './tool-signals';

// vendor/zed/crates/project/src/lsp_store/vue_language_server_ext.rs, and the same in Vue's own
// VS Code extension. Vue's server does not read TypeScript itself. What it needs to know about
// types it asks its editor, as the notification `tsserver/request`: a number, a tsserver command
// and its arguments. The editor has TypeScript's server run the command
// (`typescript.tsserverRequest`, a command of typescript-language-server and of vtsls) and sends
// the `body` of the answer back under the same number, as `tsserver/response`. Where the project
// has no TypeScript server, or the command fails, the body is null: Vue's server then goes on
// without that fact. It never waits for good.
//
// The TypeScript server must have loaded Vue's plugin to know the commands, and must have the
// `.vue` file open. Both follow from what the Vue extension adds to it (`tool-contributions.ts`).

export const vueTsserverRequest = 'tsserver/request', vueTsserverResponse = 'tsserver/response';
export const tsserverRequestCommand = 'typescript.tsserverRequest';

type Question = [number, string, unknown];
const isQuestion = (value: unknown): value is Question => Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'string';
/** The questions of one notification. A language client is handed one question as it is and several as a list. */
export function vueQuestions(params: unknown): Question[] {
  return isQuestion(params) ? [params] : Array.isArray(params) ? params.filter(isQuestion) : [];
}
export const vueRules: ToolRulesFactory = () => ({
  relays: { [vueTsserverRequest]: (params, ask) => Promise.all(vueQuestions(params).map(async ([id, command, args]) => {
    const answer = await ask('typescript', 'workspace/executeCommand', { command: tsserverRequestCommand, arguments: [command, args] }).catch(() => null);
    const body = answer && typeof answer === 'object' && !Array.isArray(answer) ? (answer as { body?: unknown }).body ?? null : null;
    return { method: vueTsserverResponse, params: [id, body] };
  })) },
});
