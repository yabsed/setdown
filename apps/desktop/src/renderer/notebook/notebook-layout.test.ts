import { expect, test } from 'vitest';
import { notebookSourceHeight, notebookOutputHeight, notebookHorizontalWheel } from './notebook-layout';

test('offscreen cells reserve every line, including CRLF and the trailing editable line', () => {
  expect(notebookSourceHeight('a\r\nb\r\n', 1, false)).toBe(73);
  expect(notebookSourceHeight(Array(100).fill('code').join('\n'), 1, false)).toBe(1916);
  expect(notebookSourceHeight(Array(100).fill('code').join('\n'), 1.3, false)).toBe(2516);
});
test('saved stream and PNG output reserve geometry before decoding or mounting', () => {
  const png = Buffer.alloc(24); png.writeUInt32BE(0x89504e47); png.writeUInt32BE(800, 16); png.writeUInt32BE(400, 20);
  const output = { output_type: 'display_data', data: { 'image/png': png.toString('base64') } };
  expect(notebookOutputHeight([output], 416, 1)).toBe(216);
  expect(notebookOutputHeight([output], 1600, 1)).toBe(416);
  expect(notebookOutputHeight([{ output_type: 'stream', text: '\u001b[31mred\u001b[0m\nnext' }], 800, 1)).toBeCloseTo(55.2);
  expect(notebookOutputHeight([{ ...output, data: { ...output.data, 'text/html': '<table></table>' } }], 800, 1)).toBe(48);
  expect(notebookOutputHeight([{ data: { 'image/png': 'malformed!' } }], 800, 1)).toBe(48);
  expect(notebookOutputHeight(Array(101).fill(null), 800, 1)).toBe(4800);
});
test('vertical touchpad motion with horizontal noise stays with the notebook', () => {
  const event = { deltaX: 3, deltaY: 120, shiftKey: false, ctrlKey: false, metaKey: false };
  expect(notebookHorizontalWheel(event)).toBe(0);
  expect(notebookHorizontalWheel({ ...event, deltaX: 120, deltaY: 3 })).toBe(120);
  expect(notebookHorizontalWheel({ ...event, shiftKey: true, deltaX: 0 })).toBe(120);
  expect(notebookHorizontalWheel({ ...event, ctrlKey: true, deltaX: 120 })).toBe(0);
});
