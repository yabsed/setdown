// A measuring bridge: asks VS Code, with the real Java extension installed, the questions
// Setdown asks a language tool, and writes the answers as JSON lines.
const vscode = require('vscode');
const fs = require('fs');

exports.activate = async () => {
  const out = process.env.BRIDGE_OUT, file = process.env.BRIDGE_FILE;
  if (!out || !file) return;
  const began = Date.now();
  const log = entry => fs.appendFileSync(out, JSON.stringify({ t: +((Date.now() - began) / 1000).toFixed(1), ...entry }) + '\n');
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const uri = vscode.Uri.file(file);
  const shown = () => vscode.languages.getDiagnostics(uri).map(d => ({ line: d.range.start.line + 1, severity: d.severity, source: d.source, message: String(d.message).slice(0, 200) }));
  let last = '';
  const note = why => { const now = JSON.stringify(shown()); if (now !== last) { last = now; log({ event: 'diagnostics', why, items: JSON.parse(now) }); } };
  try {
    log({ event: 'start', vscode: vscode.version, app: vscode.env.appName, javaHome: process.env.JAVA_HOME ?? null });
    vscode.languages.onDidChangeDiagnostics(change => { if (change.uris.some(changed => changed.toString() === uri.toString())) note('changed'); });
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    log({ event: 'opened', languageId: document.languageId });
    const java = vscode.extensions.getExtension('redhat.java');
    log({ event: 'java-extension', found: !!java, version: java?.packageJSON.version });
    const api = java && await java.activate();
    log({ event: 'java-activated', mode: api?.serverMode, apiVersion: api?.apiVersion, keys: api && Object.keys(api) });
    api?.onDidServerModeChange?.(mode => log({ event: 'server-mode', mode }));
    if (api?.serverReady) { await api.serverReady(); log({ event: 'server-ready', mode: api.serverMode }); }
    const text = document.getText();
    const at = (needle, end) => document.positionAt(text.indexOf(needle) + (end ? needle.length : 0));
    const ask = async (label, command, ...args) => {
      try { const answer = await vscode.commands.executeCommand(command, ...args); return answer; }
      catch (error) { log({ event: 'ask-error', label, message: String(error) }); return undefined; }
    };
    // Wait until the project is imported: hover on a library type answers with its documentation.
    let hover = '';
    for (let round = 0; round < 40 && !/SpringApplication/.test(hover); round++) {
      await sleep(3000);
      const answer = await ask('hover', 'vscode.executeHoverProvider', uri, at('SpringApplication.run'));
      hover = (answer ?? []).flatMap(h => h.contents).map(c => typeof c === 'string' ? c : c.value).join(' | ');
    }
    log({ event: 'hover', needle: 'SpringApplication.run', text: hover.replace(/\s+/g, ' ').slice(0, 300) });
    const stringHover = await ask('hover', 'vscode.executeHoverProvider', uri, at('String[] args'));
    log({ event: 'hover', needle: 'String[] args', text: (stringHover ?? []).flatMap(h => h.contents).map(c => typeof c === 'string' ? c : c.value).join(' | ').replace(/\s+/g, ' ').slice(0, 200) });
    const completion = await ask('completion', 'vscode.executeCompletionItemProvider', uri, at('SpringApplication.', true));
    log({ event: 'completion', after: 'SpringApplication.', count: completion?.items.length, first: completion?.items.slice(0, 8).map(item => typeof item.label === 'string' ? item.label : item.label.label) });
    const definition = await ask('definition', 'vscode.executeDefinitionProvider', uri, at('SpringBootApplication\npublic'));
    log({ event: 'definition', needle: '@SpringBootApplication', targets: (definition ?? []).map(d => String(d.uri ?? d.targetUri).slice(0, 160)) });
    await sleep(3000); note('settled');
    log({ event: 'diagnostics-saved-file', items: shown() });
    // The text in the editor, not on disk: a mistake typed and not saved must be marked.
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, at('        SpringApplication.run'), '        int broken = "text";\n');
    log({ event: 'edit-applied', ok: await vscode.workspace.applyEdit(edit), dirty: document.isDirty });
    for (let round = 0; round < 20 && !shown().some(d => d.severity === 0); round++) await sleep(500);
    log({ event: 'diagnostics-unsaved-edit', items: shown() });
    const actions = await ask('codeAction', 'vscode.executeCodeActionProvider', uri, new vscode.Range(at('int broken'), at('"text";', true)));
    log({ event: 'code-actions', titles: (actions ?? []).slice(0, 6).map(action => action.title) });
    log({ event: 'ready-for-measurement' });
    await sleep(25000);
    await vscode.commands.executeCommand('workbench.action.files.revert');
    log({ event: 'done' });
    await vscode.commands.executeCommand('workbench.action.quit');
  } catch (error) { log({ event: 'error', message: String(error?.stack ?? error) }); }
};
