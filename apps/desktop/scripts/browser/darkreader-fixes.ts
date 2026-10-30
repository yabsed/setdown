import text from '../../../../vendor/darkreader/src/config/dynamic-theme-fixes.config';
import { getDynamicThemeFixesFor } from '../../../../vendor/darkreader/src/generators/dynamic-theme';
import { indexSitesFixesConfig } from '../../../../vendor/darkreader/src/generators/utils/parse';
import { combineFixes, findRelevantFix } from '../../../../vendor/darkreader/src/inject/dynamic-theme/fixes';
const index = indexSitesFixesConfig(text);
// Same selection as the pinned extension; public API expects one combined fix.
export function siteFix(url: string) {
  const fixes = getDynamicThemeFixesFor(url, text, index, false);
  if (!fixes?.length || fixes[0].url[0] !== '*') return null;
  const relevant = findRelevantFix(url, fixes);
  return relevant ? combineFixes([fixes[0], fixes[relevant]]) : fixes[0];
}
