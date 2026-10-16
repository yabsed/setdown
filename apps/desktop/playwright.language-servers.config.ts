import { validateSuites } from './scripts/test-suites.mjs';
validateSuites();
import { defineConfig } from '@playwright/test';
import base from './playwright.config';
// Explicit integration gate: requires the named native server and toolchain.
// Missing tools fail; these checks never silently skip.
export default defineConfig(base, { testDir: './test/language-servers', retries: 0, timeout: 90_000 });
