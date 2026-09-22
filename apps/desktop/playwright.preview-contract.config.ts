import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig(base, {
  retries: 0,
  testMatch: [
    'document-preparation.spec.ts',
    'editor-groups.spec.ts',
    'git-review-first-open.spec.ts',
    'git-history.spec.ts',
    'reading-positions.spec.ts',
    'image-reader.spec.ts',
    'image-terminal-layout.spec.ts',
    'media-tabs.spec.ts',
    'workspace-zoom.spec.ts',
    'review-document-styles.spec.ts',
    'git-review-ime.spec.ts',
    'review-preparation-layout.spec.ts',
    'verified-review-position.spec.ts',
    'source-atlas-review.spec.ts',
    'tab-detach.spec.ts',
    'zero-latency-architecture.spec.ts',
  ],
});
