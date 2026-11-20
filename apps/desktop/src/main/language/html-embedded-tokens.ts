import type { Range, SemanticTokensLegend, SemanticTokensOptions } from 'vscode-languageserver-protocol';

// The HTML server colours the script inside a page by what each name means (a class, a
// parameter, a read-only variable). It does not announce this as the protocol's semantic tokens:
// its extension asks two requests of its own and registers the provider itself. The rules in
// this file are carried over from that extension. Below
// `vendor/vscode/extensions/html-language-features`:
//   client/src/htmlClient.ts                      the two requests, their parameters, and what is registered
//   server/src/htmlServer.ts                      the handlers: no legend or no tokens is `null`
//   server/src/modes/semanticTokens.ts            `encodeTokens`: the answer is the protocol's own encoding
//   server/src/modes/javascriptSemanticTokens.ts  the names in the legend
//   server/src/modes/languageModes.ts             only the JavaScript and TypeScript modes have tokens

/** Asked once, when the server has started. No parameter. The answer is `{ types: string[],
 * modifiers: string[] }`, or `null` when the server failed to make one. */
export const htmlSemanticTokenLegendMethod = 'html/semanticTokenLegend';
/** The legend request as Setdown writes it to the server: an empty list of parameters.
 *
 * The extension's message has no `params` member. Setdown's host writes `"params": null` when
 * it is given none, and the server's connection hands a `params` that is neither absent nor a
 * list to the handler as its first argument (vscode-jsonrpc `handleRequest`). This handler's
 * only argument is its cancellation token, which `runSafe` (server utils/runner.ts) reads in a
 * timer callback: with `null` there it throws where nothing catches it. An empty list reaches
 * the handler as no parameter at all. */
export const htmlSemanticLegendRequest: { method: string; params: [] } = { method: htmlSemanticTokenLegendMethod, params: [] };
/** Asked for a document the server has open. The answer is a list of numbers, or `null` when
 * the server does not have the document or failed. */
export const htmlSemanticTokensMethod = 'html/semanticTokens';

const legendLimit = { types: 256, modifiers: 32 } as const;
/** As the editor already bounds the protocol's own tokens (`renderer/language/language-semantic-features.ts`). */
const dataLimit = 5_000_000;
const names = (value: unknown, limit: number): string[] | undefined =>
  Array.isArray(value) && value.length <= limit && value.every(name => typeof name === 'string' && name.length > 0 && name.length <= 128) ? [...value as string[]] : undefined;

/** The legend the tokens are numbered by, in the protocol's form (htmlClient.ts
 * `new SemanticTokensLegend(legend.types, legend.modifiers)`). A token's type is an index into
 * `tokenTypes`, and bit n of its modifiers stands for `tokenModifiers[n]`, so both lists are
 * kept exactly as answered. Nothing when the server has no legend, when a name is missing (the
 * numbers after it would mean something else), or when it names no type at all: a server
 * started without `embeddedLanguages.javascript` has nothing to colour. */
export function htmlSemanticLegend(answer: unknown): SemanticTokensLegend | undefined {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return undefined;
  const { types, modifiers } = answer as { types?: unknown; modifiers?: unknown };
  const tokenTypes = names(types, legendLimit.types), tokenModifiers = names(modifiers, legendLimit.modifiers);
  return tokenTypes?.length && tokenModifiers ? { tokenTypes, tokenModifiers } : undefined;
}

/** What Setdown may state in place of the server, which does not state it: semantic tokens for
 * the whole document, under the legend the server answered. This is what the extension
 * registers (`languages.registerDocumentSemanticTokensProvider`, the provider for a whole
 * document). The server has no result ids, so there is no `delta`. The extension's provider
 * also has a method for a range, which it does not register; the server computes the whole
 * document either way and only leaves out what lies outside the ranges. */
export function htmlSemanticTokensProvider(legend: SemanticTokensLegend): SemanticTokensOptions {
  return { legend: { tokenTypes: [...legend.tokenTypes], tokenModifiers: [...legend.tokenModifiers] }, full: true };
}

/** The parameter of `html/semanticTokens` (htmlClient.ts `SemanticTokenParams`): the document,
 * and optionally the ranges to answer for. Without `ranges` the server answers for the whole
 * document. With them it answers only the tokens that lie wholly inside one of the ranges, in
 * the same encoding, counted from the start of the document. */
export function htmlSemanticTokensParams(uri: string, range?: Range): { textDocument: { uri: string }; ranges?: Range[] } {
  return range ? { textDocument: { uri }, ranges: [range] } : { textDocument: { uri } };
}

/** The `data` of the protocol's `SemanticTokens`, from the answer to `html/semanticTokens`.
 *
 * The answer already is that encoding (semanticTokens.ts `encodeTokens`): five numbers for each
 * token, in document order: the line, counted from the token before; the character, counted
 * from the token before when on the same line and from the line's start otherwise; the length;
 * the index of its type in the legend; its modifiers as bits. The extension hands the numbers
 * on unchanged (`new SemanticTokens(new Uint32Array(data))`), and so does this once they are
 * known to be such numbers. Nothing for `null` and for anything that is not this encoding. */
export function htmlSemanticTokenData(answer: unknown): number[] | undefined {
  if (!Array.isArray(answer) || answer.length % 5 !== 0 || answer.length > dataLimit) return undefined;
  for (const value of answer) if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) return undefined;
  return answer as number[];
}
