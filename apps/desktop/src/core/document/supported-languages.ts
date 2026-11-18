/** The languages Setdown answers for. Each names the one tool that serves it by default.
 * `apps/lsp-benchmark` opens an example file of each language with the real tool and
 * records what it answers. Every other tool in the imported catalogs works the same way
 * once a person asks for it, but is downloaded only after they say so. */
export const supportedLanguages: readonly { name: string; languages: readonly string[]; tool: string }[] = [
  { name: 'Python', languages: ['python'], tool: 'pyright' },
  { name: 'JavaScript and TypeScript', languages: ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'], tool: 'typescript-language-server' },
  { name: 'Svelte', languages: ['svelte'], tool: 'svelte-language-server' },
  { name: 'C and C++', languages: ['c', 'cpp'], tool: 'clangd' },
  { name: 'Rust', languages: ['rust'], tool: 'rust-analyzer' },
  { name: 'Go', languages: ['go', 'gomod', 'gowork'], tool: 'gopls' },
  { name: 'PHP', languages: ['php'], tool: 'intelephense' },
  { name: 'Kotlin', languages: ['kotlin'], tool: 'kotlin-lsp' },
  { name: 'JSON', languages: ['json', 'jsonc'], tool: 'json-lsp' },
  { name: 'YAML', languages: ['yaml'], tool: 'yaml-language-server' },
  { name: 'Dockerfile', languages: ['dockerfile'], tool: 'dockerfile-language-server' },
  { name: 'Docker Compose', languages: ['dockercompose'], tool: 'yaml-language-server' },
  { name: 'CSS', languages: ['css', 'scss', 'less'], tool: 'css-lsp' },
  { name: 'HTML', languages: ['html'], tool: 'html-lsp' },
];
const tools = new Map(supportedLanguages.flatMap(entry => entry.languages.map(language => [language, entry.tool])));
const supported = new Set(supportedLanguages.map(entry => entry.tool));

/** The tool Setdown starts for this language unless a person chose another. */
export const supportedTool = (language: string): string | undefined => tools.get(language);
export const isSupportedTool = (id: string): boolean => supported.has(id);
