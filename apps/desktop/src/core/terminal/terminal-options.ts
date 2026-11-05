// Renderer and headless snapshots must retain the same history, including
// output moved off screen by ED2. Explicit scrollback erase (ED3) still clears it.
export const TERMINAL_BUFFER_OPTIONS = { scrollback: 50_000, scrollOnEraseInDisplay: true } as const;
