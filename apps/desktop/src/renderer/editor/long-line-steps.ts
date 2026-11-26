import type * as Monaco from 'monaco-editor';

/** How much of a line is drawn before "Show more" is offered: the editor's own default. */
export const FIRST_LONG_LINE_STEP = 10_000;

type Editor = Pick<Monaco.editor.ICodeEditor, 'getModel' | 'updateOptions' | 'onMouseDown' | 'onDidChangeModel'>;

/** Draws ten times more of a document's long lines on each "Show more", instead of all of every
 * line at once.
 *
 * The editor's own helper answers the first click by drawing every line whole from then on, in
 * whichever document the editor shows next as well. A line of a few megabytes then stops the window
 * once it scrolls into view (2.5 MiB: 18.6 s and 2.2 GiB of renderer memory, measured on a real
 * 163 MiB transcript). A step is kept per document; another document starts at the first step. */
export function installLongLineSteps(contentText: Monaco.editor.MouseTargetType, editor: Editor): Monaco.IDisposable {
  let disposed = false;
  const steps = new WeakMap<object, number>();
  const step = () => { const model = editor.getModel(); return (model && steps.get(model)) ?? FIRST_LONG_LINE_STEP; };
  const apply = () => {
    if (!disposed) editor.updateOptions({ stopRenderingLineAfter: step() });
  };
  const listeners = [
    editor.onMouseDown(event => {
      const model = editor.getModel(), shown = step();
      if (!model || event.target.type !== contentText || !event.target.position || event.target.position.column < shown) return;
      steps.set(model, shown * 10);
      // The editor's helper sets "no limit" on this same click. This runs after it, whichever of
      // the two listeners is called first, and before the next frame is drawn.
      queueMicrotask(apply);
    }),
    editor.onDidChangeModel(apply),
  ];
  return { dispose() {
    disposed = true;
    for (const listener of listeners) listener.dispose();
  } };
}
