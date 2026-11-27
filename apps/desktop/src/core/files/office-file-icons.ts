import { officeFamily, type OfficeFamily } from '../document/document-profile';

/**
 * Icons for the document formats the Seti set has no glyph for: PowerPoint, Hancom Hangul, OpenDocument, RTF and the
 * macro and template variants of Word and Excel. Seti is a glyph font, so the two icons it lacks are Setdown's own
 * drawings: one path in a 16×16 box, filled with the even-odd rule, in the proportions and palette of Seti's Word and
 * Excel glyphs (a slanted cover carrying the letter, a page beside it).
 */
const COVER = 'M.5 2 9.3.66V15.34L.5 14Z';
const PAGE = 'M9.3 2H15a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5H9.3ZM9.3 2.6v10.8h5.6V2.6Z';
const line = (y: number) => `M10.4 ${y}h3.5v.8h-3.5Z`;
const LETTER_P = 'M3 4.7H5.3a2.05 2.05 0 0 1 0 4.1H4.2v2.5H3ZM4.2 5.8v1.9h1a.95.95 0 0 0 0-1.9Z';
const PIE_CHART = 'M12 6.3V4.35A1.95 1.95 0 1 0 13.95 6.3ZM12.6 5.7V3.75A1.95 1.95 0 0 1 14.55 5.7Z';
const LETTER_HIEUT = 'M4.3 4.3h1.2v.9H4.3ZM2.7 6h4.4v.9H2.7ZM2.9 9.7a2 2 0 1 0 4 0 2 2 0 1 0-4 0ZM3.85 9.7a1.05 1.05 0 1 0 2.1 0 1.05 1.05 0 1 0-2.1 0Z';

export type DrawnIcon = { readonly path: string; readonly dark: string; readonly light: string };
/** Ids follow Seti's naming, so one attribute tells every icon apart whichever way it is drawn. */
export const DRAWN_ICONS: Readonly<Record<string, DrawnIcon>> = {
  // Seti's orange and blue, in their dark- and light-theme values.
  _powerpoint: { path: COVER + LETTER_P + PAGE + PIE_CHART + line(9.6) + line(11.4), dark: '#e37933', light: '#cc6d2e' },
  _hwp: { path: COVER + LETTER_HIEUT + PAGE + [4.2, 6.4, 8.6, 10.8].map(line).join(''), dark: '#519aba', light: '#498ba7' },
};
const FAMILY_ICONS: Record<OfficeFamily, string> = { word: '_word', spreadsheet: '_xls', presentation: '_powerpoint', hangul: '_hwp' };
/** Formats no Office surface opens, which still read as a text document, a spreadsheet or a presentation in a file list. */
const OTHER_DOCUMENTS: Record<string, string> = {
  rtf: '_word', odt: '_word', ott: '_word', fodt: '_word',
  ods: '_xls', ots: '_xls', fods: '_xls',
  pps: '_powerpoint', odp: '_powerpoint', otp: '_powerpoint', fodp: '_powerpoint',
  hwt: '_hwp', hml: '_hwp',
};
/** The icon of a document Seti does not know by name or extension: a Seti id or one of `DRAWN_ICONS`. */
export function officeFileIcon(name: string): string | undefined {
  const family = officeFamily(name);
  if (family) return FAMILY_ICONS[family];
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() ?? '';
  return Object.hasOwn(OTHER_DOCUMENTS, extension) ? OTHER_DOCUMENTS[extension] : undefined;
}
