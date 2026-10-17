import type { MarkTexApi } from '../protocol/desktop-api';

declare global {
  interface Window {
    marktex: MarkTexApi;
    MonacoEnvironment: {
      getWorker(workerId: string, label: string): Worker | Promise<Worker>;
    };
  }
}

export {};
