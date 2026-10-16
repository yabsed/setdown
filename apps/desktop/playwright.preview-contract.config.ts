import { defineConfig } from '@playwright/test';
import base from './playwright.config';
import { e2eFiles } from './scripts/test-suites.mjs';

export default defineConfig(base, { retries: 0, testMatch: e2eFiles(true).map(file => `**/${file}`) });
