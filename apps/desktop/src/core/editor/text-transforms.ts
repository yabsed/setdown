export type IntegerChange = { start: number; end: number; text: string };
/** Decimal or explicitly prefixed integer only; no octal inference or date arithmetic. */
export function changeInteger(text: string, offset: number, amount: number): IntegerChange | null {
  if (!Number.isSafeInteger(amount)) throw Error('Use a whole-number increment.');
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const lineEnd = text.indexOf('\n', offset); const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
  for (const match of line.matchAll(/(?<![\p{L}\p{N}_])[-+]?(?:0[xX][\da-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+)(?![\p{L}\p{N}_])/gu)) {
    const start = lineStart + match.index!, end = start + match[0].length;
    if (end < offset) continue;
    const input = match[0], sign = /^[+-]/.test(input) ? input[0] : '', unsigned = sign ? input.slice(1) : input;
    const prefix = /^0[xXbBoO]/.exec(unsigned)?.[0] ?? '';
    const radix = /^0x/i.test(prefix) ? 16 : /^0b/i.test(prefix) ? 2 : /^0o/i.test(prefix) ? 8 : 10;
    const digits = unsigned.slice(prefix.length);
    const value = BigInt(prefix ? unsigned : digits) * (sign === '-' ? -1n : 1n) + BigInt(amount);
    let output = (value < 0 ? -value : value).toString(radix).padStart(digits.length, '0');
    if (/[A-F]/.test(digits) || prefix === '0X') output = output.toUpperCase();
    return { start, end, text: `${value < 0 ? '-' : sign === '+' ? '+' : ''}${prefix}${output}` };
  }
  return null;
}
export function sortLines(text: string, mode: 'numeric' | 'unique' | 'stable-unique', eol = '\n'): string {
  const trailing = text.endsWith(eol), lines = text.split(eol); if (trailing) lines.pop();
  const sorted = mode === 'stable-unique' ? lines : [...lines].sort(mode === 'numeric'
    ? (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'variant' }) : (a, b) => a.localeCompare(b));
  const result = mode === 'numeric' ? sorted : [...new Set(sorted)];
  return result.join(eol) + (trailing ? eol : '');
}
/** Reflow prose only. Block syntax and Markdown hard breaks are never rewritten. */
export function reflowParagraph(text: string, width = 80, eol = '\n'): string {
  if (!Number.isInteger(width) || width < 20 || width > 500) throw Error('Choose a width between 20 and 500 columns.');
  const lines = text.split(/\r?\n/);
  if (lines.some(line => /^\s*(?:#{1,6}\s|>|[-+*]\s|\d+[.)]\s|`{3,}|~{3,}|\|)| {2,}$|\\$/.test(line)))
    throw Error('Reflow plain prose paragraphs; headings, lists, tables, code and hard line breaks keep their structure.');
  const indent = /^\s*/.exec(lines[0])![0];
  const paragraphs = text.trimEnd().split(/\r?\n\s*\r?\n/).map(paragraph => {
    const words = paragraph.trim().split(/\s+/u), output: string[] = []; let current = indent;
    for (const word of words) {
      const candidate = current.trim() ? `${current} ${word}` : indent + word;
      if ([...candidate].length > width && current.trim()) { output.push(current); current = indent + word; } else current = candidate;
    }
    if (current.trim()) output.push(current); return output.join(eol);
  });
  return paragraphs.join(eol + eol) + (text.endsWith(eol) ? eol : '');
}
