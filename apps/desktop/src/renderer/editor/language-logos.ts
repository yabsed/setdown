import type { SimpleIcon } from 'simple-icons';
import {
  siPython, siCplusplus, siC, siCsharp, siRust, siGo, siTypescript, siJavascript, siFortran,
  siLua, siGnubash, siR, siOcaml, siSvelte, siKotlin, siSwift, siPhp, siRuby, siDart,
  siHaskell, siElixir, siErlang, siClojure, siFsharp, siScala, siJulia, siPerl, siNim,
  siNixos, siZig, siV, siCrystal, siCmake, siDocker, siHtml5, siCss3, siSass, siVuedotjs,
  siReact, siJson, siYaml, siToml, siMarkdown, siLatex, siGraphql, siTerraform, siAngular,
  siAstro, siAnsible, siPowershell, siGnuemacs, siVim, siSolidity, siCoffeescript,
  siPurescript, siRescript, siD, siOpenjdk, siApachegroovy, siPostgresql, siWebassembly,
  siGodotengine, siHaxe, siElm,
} from 'simple-icons';

// Real upstream logo paths. Only these named imports enter the lazy sidebar chunk.
const logos: Record<string, SimpleIcon> = {
  python: siPython, c: siC, 'c++': siCplusplus, cpp: siCplusplus, 'c#': siCsharp, csharp: siCsharp,
  rust: siRust, go: siGo, typescript: siTypescript, javascript: siJavascript, fortran: siFortran,
  lua: siLua, luau: siLua, bash: siGnubash, sh: siGnubash, shellscript: siGnubash,
  r: siR, rmd: siR, 'r markdown': siR, ocaml: siOcaml, svelte: siSvelte, kotlin: siKotlin,
  swift: siSwift, php: siPhp, ruby: siRuby, dart: siDart, haskell: siHaskell, elixir: siElixir,
  erlang: siErlang, clojure: siClojure, clojurescript: siClojure, 'f#': siFsharp, fsharp: siFsharp,
  scala: siScala, julia: siJulia, perl: siPerl, nim: siNim, nix: siNixos, zig: siZig, v: siV,
  crystal: siCrystal, cmake: siCmake, docker: siDocker, dockerfile: siDocker, html: siHtml5,
  css: siCss3, scss: siSass, sass: siSass, vue: siVuedotjs, jsx: siReact, tsx: siReact,
  javascriptreact: siReact, typescriptreact: siReact, json: siJson, jsonc: siJson, yaml: siYaml,
  toml: siToml, markdown: siMarkdown, mdx: siMarkdown, latex: siLatex, tex: siLatex,
  graphql: siGraphql, terraform: siTerraform, hcl: siTerraform, angular: siAngular, astro: siAstro,
  ansible: siAnsible, powershell: siPowershell, elisp: siGnuemacs, vim: siVim, vimscript: siVim,
  solidity: siSolidity, coffeescript: siCoffeescript, purescript: siPurescript, rescript: siRescript,
  d: siD, java: siOpenjdk, groovy: siApachegroovy, postgres: siPostgresql, sql: siPostgresql,
  webassembly: siWebassembly, godot: siGodotengine, gdscript: siGodotengine, haxe: siHaxe, elm: siElm,
};

export function languageLogo(languages: string[]): SimpleIcon | undefined {
  const names = languages.map(language => language.trim().toLowerCase());
  // C/C++ and JS/TS servers should show their more specific language mark.
  const preferred = ['c++', 'cpp', 'typescript'].find(language => names.includes(language));
  return preferred ? logos[preferred] : names.map(name => logos[name]).find(Boolean);
}

/** Preserve the brand hue while keeping dark logos visible on dark sidebars. */
export function logoColors(hex: string): { light: string; dark: string } {
  const rgb = hex.match(/../g)!.map(channel => parseInt(channel, 16));
  const brightness = (rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722) / 255;
  const blend = (target: number, amount: number) => '#' + rgb.map(channel =>
    Math.round(channel + (target - channel) * amount).toString(16).padStart(2, '0')).join('');
  return { light: brightness > .65 ? blend(0, .35) : '#' + hex,
    dark: brightness < .45 ? blend(255, .45) : '#' + hex };
}
