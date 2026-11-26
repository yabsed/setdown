import text from '../../../../vendor/darkreader/src/config/dynamic-theme-fixes.config';
import own from './site-theme-fixes.config';
import { getDynamicThemeFixesFor, parseDynamicThemeFixes } from '../../../../vendor/darkreader/src/generators/dynamic-theme';
import { indexSitesFixesConfig } from '../../../../vendor/darkreader/src/generators/utils/parse';
import { combineFixes, findRelevantFix } from '../../../../vendor/darkreader/src/inject/dynamic-theme/fixes';
import { isURLInList } from '../../../../vendor/darkreader/src/utils/url';
const index = indexSitesFixesConfig(text);
// Fixes of our own for what the engine cannot tell from a stylesheet, in the pinned
// list's format (site-theme-fixes.config). They follow the list's fix for the page.
const ownFixes = parseDynamicThemeFixes(own);
// Same selection as the pinned extension; public API expects one combined fix.
export function siteFix(url: string) {
  const fixes = getDynamicThemeFixesFor(url, text, index, false);
  if (!fixes?.length || fixes[0].url[0] !== '*') return null;
  const relevant = findRelevantFix(url, fixes);
  const ours = ownFixes.filter(fix => isURLInList(url, fix.url));
  return relevant || ours.length ? combineFixes([fixes[0], ...(relevant ? [fixes[relevant]] : []), ...ours]) : fixes[0];
}
