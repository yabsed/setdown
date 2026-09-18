import { describe, expect, test } from 'vitest';
import { clampPanelWidth } from './panel-resize';

describe('panel resize', () => {
  test('keeps a dragged panel inside its usable range', () => {
    expect(clampPanelWidth(80, 180, 500)).toBe(180);
    expect(clampPanelWidth(333.4, 180, 500)).toBe(333);
    expect(clampPanelWidth(900, 180, 500)).toBe(500);
  });

  test('uses the minimum when the window is narrower than it', () => {
    expect(clampPanelWidth(100, 180, 120)).toBe(180);
  });
});
