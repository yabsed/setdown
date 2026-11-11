export const APP_FONT_FAMILY = '"D2Coding", ui-monospace, monospace';

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
 * Widest reading column in CSS px at 100% content zoom (42 Hangul characters of
 * the Reader's 20px monospace body, 60 of Markdown's 14px). A wider pane centers the column
 * instead of stretching lines across the window. Content zoom changes only the
 * text: the column keeps this width on screen at every tab zoom.
 */
export const DOCUMENT_MEASURE_PX = 840;
/** Set on the Markdown preview's root by main: its tab zoom, which native zoom also applies to lengths. */
export const CONTENT_ZOOM_PROPERTY = '--setdown-content-zoom';
