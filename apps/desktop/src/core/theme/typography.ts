/**
 * One locally installed family for shell, editors, terminals and reading
 * surfaces. Monoplex KR (IBM Plex Mono + IBM Plex Sans KR) keeps Hangul at
 * exactly two Latin cells; D2Coding remains the fallback where it is absent.
 * `--app-font-family` in renderer/style.css must declare the same stack.
 */
export const APP_FONT_FAMILY = '"Monoplex KR", "D2Coding", ui-monospace, monospace';

/**
 * Screen body size of rendered Markdown, before application and tab zoom. It
 * stays in proportion with the 12px app chrome and the 14px source editor.
 */
export const MARKDOWN_FONT_SIZE = 14;
/**
 * Screen body size of the web Reader: the size of long-form news body text.
 * Reader is the Markdown theme scaled by READER_FONT_SIZE / MARKDOWN_FONT_SIZE,
 * so every theme length keeps its proportion to the text.
 */
export const READER_FONT_SIZE = 20;

/**
 * Widest reading column in CSS px at 100% content zoom (about 40 Hangul
 * characters of the Reader's 20px monospace body, 57 of Markdown's 14px: a
 * Monoplex KR syllable is 1.056em wide). A wider pane centers the column
 * instead of stretching lines across the window. Content zoom changes only the
 * text: the column keeps this width on screen at every tab zoom.
 */
export const DOCUMENT_MEASURE_PX = 840;
/** Set on the Markdown preview's root by main: its tab zoom, which native zoom also applies to lengths. */
export const CONTENT_ZOOM_PROPERTY = '--setdown-content-zoom';
