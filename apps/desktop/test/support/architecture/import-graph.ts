import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

export type ImportReference = { specifier: string; typeOnly: boolean };
export type Dependency = ImportReference & { from: string; to?: string };
const posix = (value: string) => value.split(path.sep).join('/');
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));

export function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file)
      : /\.(?:ts|svelte|js)$/.test(file) && !/\.(?:test|d)\.ts$/.test(file) ? [file] : [];
  });
}

export function inspectSource(file: string, source: string) {
  const imports: ImportReference[] = [];
  let desktopGlobal = false;
  const script = file.endsWith('.svelte')
    ? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n') : source;
  const ast = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const add = (value: ts.Node | undefined, typeOnly: boolean) => {
    if (value && ts.isStringLiteralLike(value)) imports.push({ specifier: value.text, typeOnly });
  };
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause, bindings = clause?.namedBindings;
      const typeOnly = !!clause?.isTypeOnly || !!(clause && !clause.name && bindings && ts.isNamedImports(bindings)
        && bindings.elements.length && bindings.elements.every(item => item.isTypeOnly));
      add(node.moduleSpecifier, typeOnly);
    } else if (ts.isExportDeclaration(node)) {
      const clause = node.exportClause;
      add(node.moduleSpecifier, node.isTypeOnly || !!(clause && ts.isNamedExports(clause)
        && clause.elements.length && clause.elements.every(item => item.isTypeOnly)));
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal, true);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) add(node.arguments[0], false);
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      && ts.isIdentifier(node.expression) && ['window', 'globalThis'].includes(node.expression.text)) {
      desktopGlobal ||= ts.isPropertyAccessExpression(node) ? node.name.text === 'marktex'
        : ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'marktex';
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { imports, desktopGlobal };
}

export function resolveSource(specifier: string, file: string, options: ts.CompilerOptions): string | undefined {
  const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule?.resolvedFileName;
  if (resolved) return resolved;
  // TypeScript does not resolve Svelte components, but their imports are real dependencies.
  if (specifier.startsWith('.')) {
    const base = path.resolve(path.dirname(file), specifier.split('?')[0]);
    return [base, `${base}.ts`, `${base}.svelte`, path.join(base, 'index.ts')].find(file => existsSync(file));
  }
  return undefined;
}

export function importGraph(root: string) {
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const source = path.join(root, 'src');
  return sourceFiles(source).flatMap(file => inspectSource(file, readFileSync(file, 'utf8')).imports.map(reference => {
    const target = resolveSource(reference.specifier, file, options);
    return { ...reference, from: posix(path.relative(source, file)),
      to: target?.startsWith(source + path.sep) ? posix(path.relative(source, target)) : undefined };
  }));
}

/** Process rules apply to type imports too; diagnostics keep their kind visible. */
export function boundaryViolations(dependencies: Dependency[]): string[] {
  const languagePublic = new Set(['language-client.ts', 'language-conversion.ts', 'language-feature-context.ts', 'LanguageSupport.svelte']);
  const notebookPublic = new Set(['document-content.ts', 'NotebookSurface.svelte']);
  return dependencies.flatMap(edge => {
    const { from, to, specifier } = edge;
    const node = builtins.has(specifier.replace(/^node:/, '')) || specifier === 'electron' || specifier.startsWith('electron/');
    let forbidden = false;
    if (from.startsWith('core/')) forbidden = node || !!to && !to.startsWith('core/');
    if (from.startsWith('protocol/')) forbidden = !!to && !/^(core|protocol)\//.test(to);
    if (from.startsWith('renderer/')) forbidden = node || !!to && /^(main|preload|preview-runtime|browser-runtime|image-export-runtime|hwp-runtime)\//.test(to);
    if (from.startsWith('main/')) forbidden = !!to && /^(renderer|preload|preview-runtime|browser-runtime|image-export-runtime|hwp-runtime)\//.test(to);
    if (/^(preview-runtime|browser-runtime|image-export-runtime|hwp-runtime)\//.test(from)) forbidden = !!to && /^(renderer|main)\//.test(to);
    if (from.startsWith('image-runtime/')) forbidden = node || !!to && !/^(core|image-runtime)\//.test(to);
    if (to?.startsWith('renderer/app/') && from !== 'renderer/main.ts' && !from.startsWith('renderer/app/')) forbidden = true;
    for (const [feature, publicFiles] of [['language', languagePublic], ['notebook', notebookPublic]] as const) {
      const prefix = `renderer/${feature}/`;
      if (to?.startsWith(prefix) && !from.startsWith(prefix) && !publicFiles.has(to.slice(prefix.length))) forbidden = true;
    }
    return forbidden ? [`${from} -> ${to ?? specifier}${edge.typeOnly ? ' (type)' : ''}`] : [];
  });
}
