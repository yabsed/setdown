import type { MarkTexApi } from '../protocol/desktop-api';

declare global {
  interface Window {
    marktex: MarkTexApi;
    MonacoEnvironment: {
      getWorker(): Worker;
    };
  }
}

export {};
