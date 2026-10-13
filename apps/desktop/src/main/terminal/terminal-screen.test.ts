import { afterEach, expect, test } from 'vitest';
import { createRequire } from 'node:module';
import type { Terminal as TerminalType } from '@xterm/headless';
import { TerminalScreen } from './terminal-screen';
const { Terminal } = createRequire(import.meta.url)('@xterm/headless') as typeof import('@xterm/headless');
const disposables: { dispose(): void }[] = [];
afterEach(() => { for (const item of disposables.splice(0)) item.dispose(); });
const write = (term: TerminalType, data: string) => new Promise<void>(resolve => term.write(data, resolve));
const vt = (term: TerminalType) => (term as unknown as { _core: {
  coreService: { isCursorHidden: boolean }; coreMouseService: { activeEncoding: string };
  _bufferService: { buffer: { scrollTop: number; scrollBottom: number } }
} })._core;
const state = (term: TerminalType) => ({ hidden: vt(term).coreService.isCursorHidden,
  mouseEncoding: vt(term).coreMouseService.activeEncoding,
  margins: [vt(term)._bufferService.buffer.scrollTop, vt(term)._bufferService.buffer.scrollBottom],
  active: term.buffer.active.type, x: term.buffer.active.cursorX, y: term.buffer.active.cursorY,
  modes: term.modes, buffers: [term.buffer.normal, term.buffer.alternate].map(buffer => Array.from({ length: buffer.length }, (_, y) => {
    const line = buffer.getLine(y)!;
    return { wrap: line.isWrapped, cells: Array.from({ length: term.cols }, (_, x) => {
      const cell = line.getCell(x)!;
      return [cell.getChars(), cell.getWidth(), cell.getFgColor(), cell.getBgColor(), cell.isBold(), cell.isInverse()];
    }) };
  })) });
async function fixture(data: string, cols = 12, rows = 5) {
  const screen = new TerminalScreen({ cols, rows }), source = new Terminal({ cols, rows, allowProposedApi: true }),
    restored = new Terminal({ cols, rows, allowProposedApi: true });
  disposables.push(screen, source, restored);
  screen.write(data); await write(source, data);
  await write(restored, (await screen.snapshot()).data);
  return { screen, source, restored };
}

test('normal and alternate screens retain cells, colors, cursor and application input modes', async () => {
  const f = await fixture('normal\r\n\x1b[31mred\x1b[0m\x1b[?1049h\x1b[2J\x1b[2;3H\x1b[1;38;2;21;45;89m한글\x1b[4;7HXY\x1b[?1h\x1b[?2004h\x1b[?1002h\x1b[?1006h');
  expect(state(f.restored)).toEqual(state(f.source));
  const input = '\x1b[?1049l\r\nback';
  await write(f.source, input); await write(f.restored, input);
  expect(state(f.restored)).toEqual(state(f.source));
});
test('scroll margins and saved cursor survive continued full-screen output', async () => {
  const f = await fixture('\x1b[?1049h\x1b[2;4r\x1b[3;2H\x1b[32m\x1b7\x1b[4;5H\x1b[31mcurrent\x1b[?25l');
  expect(state(f.restored)).toEqual(state(f.source));
  const input = '\x1b8restored\r\nscroll\r\nscroll';
  await write(f.source, input); await write(f.restored, input);
  expect(state(f.restored)).toEqual(state(f.source));
});
test.each(['abcdefghijkl', 'abcdefghij한'])('pending right-margin wrap retains the next character (%s)', async text => {
  const f = await fixture(text);
  expect(state(f.restored)).toEqual(state(f.source));
  await write(f.source, 'Z'); await write(f.restored, 'Z');
  expect(state(f.restored)).toEqual(state(f.source));
});
test('a snapshot includes parsed data while retaining subsequent sequence ownership', async () => {
  const screen = new TerminalScreen({ cols: 12, rows: 5 }); disposables.push(screen);
  const first = screen.write('before'), pending = screen.snapshot(), next = screen.write('after');
  expect((await pending).sequence).toBe(first);
  expect(next).toBeGreaterThan(first);
});
test('origin mode preserves relative cursor coordinates inside scrolling margins', async () => {
  const f = await fixture('\x1b[?1049h\x1b[2;4r\x1b[?6h\x1b[2;3Htext');
  expect(state(f.restored)).toEqual(state(f.source));
  await write(f.source, '\r\nnext'); await write(f.restored, '\r\nnext');
  expect(state(f.restored)).toEqual(state(f.source));
});
test('pending wrap restores the last cell color separately from the next output color', async () => {
  const f = await fixture('\x1b[31mabcdefghijkl\x1b[32m');
  expect(state(f.restored)).toEqual(state(f.source));
  await write(f.source, 'Z'); await write(f.restored, 'Z');
  expect(state(f.restored)).toEqual(state(f.source));
});
test('closing a screen rejects an unfinished handoff instead of leaving it pending', async () => {
  const screen = new TerminalScreen({ cols: 12, rows: 5 });
  const snapshot = screen.snapshot(); screen.dispose();
  await expect(snapshot).rejects.toThrow('closed');
});
