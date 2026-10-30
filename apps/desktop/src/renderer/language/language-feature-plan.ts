import type { LanguageCapabilities } from '../../protocol/language';
import type { LanguageRoute } from '../../core/document/language-support';

/** The same negotiated plan drives provider registration and the document UI.
 * Diagnostics and quick fixes keep their independent origin/command handles. */
export function languageFeaturePlan(server: string, primary: boolean, routes: LanguageRoute[], original: LanguageCapabilities): LanguageCapabilities {
  const capabilities = { ...original }, own = routes.find(route => route.server === server);
  const formatter = routes.find(route => route.formatting === true)?.server;
  if ((formatter ? server !== formatter : !primary) || own?.formatting === false) {
    delete capabilities.documentFormattingProvider; delete capabilities.documentRangeFormattingProvider; delete capabilities.documentOnTypeFormattingProvider;
  }
  if (!primary) { delete capabilities.renameProvider; delete capabilities.semanticTokensProvider; }
  return capabilities;
}
