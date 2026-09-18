import type { MarkTexApi } from '../shared/contracts';

declare global {
  interface Window {
    marktex: MarkTexApi;
    MonacoEnvironment: {
      getWorker(): Worker;
    };
  }
}

export {};
