import type { DesktopPort } from '../../ports/desktop-port';
import type { PreviewBounds, PreviewMessage } from '../../../protocol/desktop-api';

type Batch = { id: string; bounds: PreviewBounds; position: Record<string, unknown> | null;
  observation: Record<string, unknown> | null };

/** Scope the transaction transport to Git only. syncPreview's synchronous
 * show/position/observe calls become one immutable message before the next paint.
 * Ordinary Markdown and all editor/model operations use the original port.
 */
export function reviewPresentationPort(desktop: DesktopPort): { desktop: DesktopPort; receive(payload: PreviewMessage): void } {
  let batch: Batch | null = null;
  let queued = false;
  let inFlight: (Batch & { sequence: number }) | null = null;
  let sequence = 0;
  const flush = () => {
    queued = false;
    const current = batch;
    batch = null;
    if (!current) return;
    inFlight = { ...current, sequence: ++sequence };
    desktop.sendPreviewCommand(current.id, {
      command: 'marktex:present-review', presentationId: sequence,
      bounds: current.bounds, position: current.position, observation: current.observation,
    });
  };
  const showPreview: DesktopPort['showPreview'] = (id, bounds) => {
    if (!id || !bounds || !/^git-diff:.*:[ab]$/.test(id)) {
      batch = null;
      inFlight = null;
      desktop.showPreview(id, bounds); // Hiding cancels the native pending ticket.
      return;
    }
    // A repeated layout in the same task must not discard the final navigation.
    batch = batch?.id === id ? { ...batch, bounds: { ...bounds } }
      : inFlight?.id === id ? { ...inFlight, bounds: { ...bounds } }
      : { id, bounds: { ...bounds }, position: null, observation: null };
    if (!queued) { queued = true; queueMicrotask(flush); }
  };
  const sendPreviewCommand: DesktopPort['sendPreviewCommand'] = (id, message) => {
    if (batch?.id === id && message.command === 'marktex:position-preview') {
      batch.position = { ...message, band: Array.isArray(message.band)
        ? message.band.map((sample) => ({ ...sample })) : [] };
    } else if (batch?.id === id && message.command === 'marktex:observe-viewport') {
      batch.observation = { ...message };
    } else desktop.sendPreviewCommand(id, message);
  };
  const port = new Proxy(desktop, {
    get(target, key) {
      if (key === 'showPreview') return showPreview;
      if (key === 'sendPreviewCommand') return sendPreviewCommand;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { desktop: port, receive(payload) {
    if (payload.tabId === inFlight?.id &&
      ((payload.message.type === 'marktex:review-presented' && payload.message.presentationId === inFlight.sequence)
        || payload.message.type === 'marktex:review-presentation-error')) inFlight = null;
  } };
}
