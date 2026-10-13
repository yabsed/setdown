import type { Terminal as HeadlessTerminal, IBufferCell } from '@xterm/headless';
import type { SerializeAddon } from '@xterm/addon-serialize';
import type { TerminalSize } from '../../protocol/terminal';

type Attributes = Pick<IBufferCell, 'getFgColor' | 'getBgColor' | 'isFgRGB' | 'isBgRGB' | 'isFgPalette' | 'isBgPalette'
  | 'isBold' | 'isDim' | 'isItalic' | 'isUnderline' | 'isBlink' | 'isInverse' | 'isInvisible' | 'isStrikethrough' | 'isOverline'>;
// xterm 6's serialize addon omits scroll margins, cursor visibility, saved
// cursor and mouse encoding. Keep its pinned internal adapter in this module.
type VTCore = { coreService: { isCursorHidden: boolean }; coreMouseService: { activeEncoding: string };
  _bufferService: { buffers: { normal: { savedCurAttrData: Attributes } }; buffer: { scrollTop: number; scrollBottom: number; savedX: number; savedY: number; ybase: number; savedCurAttrData: Attributes } };
  _inputHandler: { _curAttrData: Attributes } };
function sgr(cell: Attributes): string {
  const values: number[] = [0];
  for (const [method, code] of [['isBold', 1], ['isDim', 2], ['isItalic', 3], ['isUnderline', 4], ['isBlink', 5],
    ['isInverse', 7], ['isInvisible', 8], ['isStrikethrough', 9], ['isOverline', 53]] as const) if (cell[method]()) values.push(code);
  for (const [rgb, palette, color, code] of [['isFgRGB', 'isFgPalette', 'getFgColor', 38], ['isBgRGB', 'isBgPalette', 'getBgColor', 48]] as const) {
    const value = cell[color]();
    if (cell[rgb]()) values.push(code, 2, (value >> 16) & 255, (value >> 8) & 255, value & 255);
    else if (cell[palette]()) values.push(code, 5, value);
  }
  return `\x1b[${values.join(';')}m`;
}

/** The live VT state, independent of a renderer's lifetime. No raw-log replay. */
export class TerminalScreen {
  private readonly terminal: HeadlessTerminal;
  private readonly serializer: SerializeAddon;
  private sequence = 0;
  private cursorStyle = 1;
  private readonly pending = new Set<(error: Error) => void>();
  private disposed = false;
  constructor(size: TerminalSize) {
    // Keep terminal dependencies off document/browser startup paths.
    const { Terminal } = require('@xterm/headless') as typeof import('@xterm/headless');
    const { SerializeAddon } = require('@xterm/addon-serialize') as typeof import('@xterm/addon-serialize');
    this.terminal = new Terminal({ ...size, scrollback: 5000, cursorBlink: true, allowProposedApi: true });
    this.serializer = new SerializeAddon();
    this.terminal.loadAddon(this.serializer as unknown as Parameters<HeadlessTerminal['loadAddon']>[0]);
    // Headless xterm does not render or retain DECSCUSR's cursor presentation.
    this.terminal.parser.registerEscHandler({ final: 'c' }, () => { this.cursorStyle = 1; return false; });
    this.terminal.parser.registerCsiHandler({ intermediates: '!', final: 'p' }, () => { this.cursorStyle = 1; return false; });
    this.terminal.parser.registerCsiHandler({ intermediates: ' ', final: 'q' }, params => {
      const value = Number(params[0]) || 1;
      if (value >= 1 && value <= 6) this.cursorStyle = value;
      return false;
    });
  }
  write(data: string): number { this.terminal.write(data); return ++this.sequence; }
  resize(size: TerminalSize): void { this.terminal.resize(size.cols, size.rows); }
  snapshot(): Promise<{ data: string; sequence: number }> {
    const sequence = this.sequence;
    // This parser barrier includes data queued immediately before a handoff.
    return new Promise((resolve, reject) => {
      if (this.disposed) { reject(new Error('Terminal screen was closed.')); return; }
      this.pending.add(reject);
      this.terminal.write('', () => {
        if (!this.pending.delete(reject)) return;
        resolve({ data: this.serialize(), sequence });
      });
    });
  }
  private serialize(): string {
    const term = this.terminal, active = term.buffer.active;
    const core = (term as unknown as { _core: VTCore })._core;
    const buffer = core._bufferService.buffer;
    const origin = term.modes.originMode;
    const at = (x: number, y: number) => `\x1b[${y + 1 - (origin ? buffer.scrollTop : 0)};${Math.min(term.cols - 1, x) + 1}H`;
    let state = this.serializer.serialize();
    if (active.type === 'alternate') {
      const normalLength = this.serializer.serialize({ excludeAltBuffer: true, excludeModes: true }).length;
      state = state.slice(0, normalLength) + sgr(core._bufferService.buffers.normal.savedCurAttrData) + state.slice(normalLength);
    }
    // Setting scroll margins/origin moves the cursor. Restore its saved slot
    // first, then its live position and current rendition.
    state += `\x1b[?6l\x1b[${buffer.scrollTop + 1};${buffer.scrollBottom + 1}r`;
    if (origin) state += '\x1b[?6h';
    state += at(buffer.savedX, Math.max(0, buffer.savedY - buffer.ybase)) + sgr(buffer.savedCurAttrData) + '\x1b7';
    state += at(active.cursorX, active.cursorY);
    // A full-row write leaves x == cols (pending wrap), which CSI positioning
    // alone cannot express. Rewrite the final grapheme with its own attributes.
    if (active.cursorX === term.cols && term.modes.wraparoundMode) {
      const line = active.getLine(active.baseY + active.cursorY);
      let column = term.cols - 1, cell = line?.getCell(column);
      if (cell?.getWidth() === 0) cell = line?.getCell(--column);
      if (cell) state += at(column, active.cursorY) + sgr(cell) + (cell.getChars() || ' ');
    }
    state += sgr(core._inputHandler._curAttrData);
    state += `\x1b[?25${core.coreService.isCursorHidden ? 'l' : 'h'}\x1b[${this.cursorStyle} q`;
    if (core.coreMouseService.activeEncoding === 'SGR') state += '\x1b[?1006h';
    if (core.coreMouseService.activeEncoding === 'SGR_PIXELS') state += '\x1b[?1016h';
    return state;
  }
  dispose(): void {
    this.disposed = true;
    for (const reject of this.pending) reject(new Error('Terminal screen was closed.'));
    this.pending.clear(); this.terminal.dispose();
  }
}
