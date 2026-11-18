// Turns the places a case names into positions, and a tool's answers into the few
// words a person would recognize. Nothing here talks to a tool.

/** Line and character of an offset, as the protocol counts them. */
export function position(text, offset) {
  const before = text.slice(0, offset), line = before.split('\n').length - 1;
  return { line, character: offset - (before.lastIndexOf('\n') + 1) };
}
function offsetOf(text, needle, last = false) {
  const index = last ? text.lastIndexOf(needle) : text.indexOf(needle);
  if (index < 0) throw Error(`The file does not contain ${JSON.stringify(needle)}.`);
  return index;
}
/** Inside the first letter of the named text, or of the part of it that `on` names. */
export function at(text, needle, on) {
  const part = on === undefined ? 0 : needle.indexOf(on);
  if (part < 0) throw Error(`${JSON.stringify(needle)} does not contain ${JSON.stringify(on)}.`);
  return position(text, offsetOf(text, needle) + part);
}
/** Right behind the last occurrence of the named text. */
export const after = (text, needle) => position(text, offsetOf(text, needle, true) + needle.length);

const severities = ['', 'error', 'warning', 'information', 'hint'];
export function diagnosticSummary(diagnostic) {
  const message = String(diagnostic.message ?? '').split('\n')[0];
  return { line: diagnostic.range.start.line + 1, severity: severities[diagnostic.severity ?? 1] ?? 'error',
    message: message.length > 140 ? `${message.slice(0, 139)}…` : message, source: diagnostic.source };
}
export const marksLine = (diagnostics, line) => diagnostics.some(d => d.range.start.line <= line && line <= d.range.end.line);
/** Diagnostics a person reads as "this code is wrong", above the given line. */
export const errorsAbove = (diagnostics, line) => diagnostics.filter(d => (d.severity ?? 1) === 1 && d.range.start.line < line);
/** The file with one more line at its end, and the number of that line. */
export function withMistake(text, mistake) {
  const base = text.endsWith('\n') ? text : `${text}\n`;
  return { text: `${base}${mistake}\n`, line: base.split('\n').length - 1 };
}

/** The text of a hover, whichever of the protocol's three shapes the tool used. */
export function hoverText(result) {
  const part = value => typeof value === 'string' ? value : value && typeof value === 'object' && 'value' in value ? String(value.value) : '';
  const contents = result?.contents;
  return (Array.isArray(contents) ? contents.map(part).join('\n') : part(contents)).trim();
}
export function completionLabels(result) {
  const items = Array.isArray(result) ? result : result?.items ?? [];
  return items.map(item => typeof item.label === 'string' ? item.label : item.label?.label ?? '').filter(Boolean);
}
/** Whether a name is among the offers. Tools decorate labels (clangd writes " area(int width, int height)"),
 * so the name may be followed by its signature, and the text an offer filters by counts as well. */
export function offers(result, name) {
  const items = Array.isArray(result) ? result : result?.items ?? [];
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const label = new RegExp(`^[^\\w$@]*${escaped}(?![\\w$-])`);
  return items.some(item => item.filterText === name || label.test(typeof item.label === 'string' ? item.label : item.label?.label ?? ''));
}
/** Where a definition leads: file and line, for plain locations and for links. */
export function definitionTargets(result) {
  const items = !result ? [] : Array.isArray(result) ? result : [result];
  return items.map(item => ({ uri: item.targetUri ?? item.uri, line: (item.targetSelectionRange ?? item.targetRange ?? item.range).start.line }));
}
/** Whether a definition leads into the named file: the end of its path, or a pattern. */
export function leadsTo(targets, to) {
  return targets.some(target => { const file = decodeURIComponent(target.uri); return typeof to === 'string' ? file.endsWith(to) : to.test(file); });
}
export const shorten = (text, length = 160) => { const line = text.replace(/\s+/g, ' ').trim(); return line.length > length ? `${line.slice(0, length - 1)}…` : line; };
