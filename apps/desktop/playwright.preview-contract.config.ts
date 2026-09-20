import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig(base, {
  retries: 0,
  testMatch: [
    'document-preparation.spec.ts',
    'review-document-styles.spec.ts',
    'git-review-ime.spec.ts',
    'review-preparation-layout.spec.ts',
    'verified-review-position.spec.ts',
    'source-atlas-review.spec.ts',
    'zero-latency-architecture.spec.ts',
  ],
});
