import { defineConfig } from '@playwright/test';
import base from '../playwright.config';
export default defineConfig(base, { testDir: '.', retries: 0, timeout: 420_000 });
