/** IPython input that is not Python and that the analyzer does not read as IPython,
 * rewritten for analysis only. Each rule replaces one character with one character,
 * so every position in a cell stays valid for diagnostics, hover and completion.
 *
 * The rules are those of JupyterLab's LSP integration
 * (vendor/jupyterlab-lsp/packages/jupyterlab-lsp/src/transclusions/ipython/overrides.ts):
 * - `%%time` and `%%capture` run their cell body as ordinary Python in the notebook
 *   namespace. Pyright reads every cell magic as opaque to the end of the cell
 *   (vendor/pyright/packages/pyright-internal/src/parser/tokenizer.ts), so names
 *   defined there were reported as undefined in later cells. The magic line becomes
 *   a comment. Other cell magics keep the analyzer's treatment: their body may not
 *   be Python.
 * - `name?`, `name??`, `?name` and `??name` show help and were reported as syntax
 *   errors. The line becomes a comment. */
const pythonBody = /^%%(?=(?:time|capture)(?:[ \t][^\r\n]*)?(?:\r?\n|$))/;
const help = /^([ \t]*)(?:\?{1,2}[A-Za-z_*%][^\r\n]*|[A-Za-z_][\w.]*(?:\[[^\]\r\n]*\])?\?{1,2}[ \t]*)(?=\r?$)/gm;

/** The hidden first cell of every analysed notebook. Notebook mode supplies display();
 * this binds IPython's runtime get_ipython() with its installed types. */
export const notebookPrelude = 'from IPython import get_ipython as get_ipython';

export function notebookAnalysisSource(text: string): string {
  if (text.startsWith('%%') && !pythonBody.test(text)) return text;
  return text.replace(pythonBody, '#%').replace(help, (line, indent: string) => `${indent}#${line.slice(indent.length + 1)}`);
}
