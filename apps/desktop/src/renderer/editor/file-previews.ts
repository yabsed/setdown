// The text of a file that is not open, for the places where the editor shows a line of another
// file: beside a name while Ctrl is held, and in the list of references with its preview.
//
// The editor asks for such a file as a model, and it only has models for open documents. Without
// an answer a reference in another file was listed as "job_spec.lua:137:12" where its line of
// code belongs, the preview stayed on the file it started in, and the name under the pointer got
// no link while Ctrl was held. A file is read once for everyone who looks at it now, and its model
// goes when the last of them stops looking.

/** The scheme of a model that only shows a file. It is not a document: nothing checks it, and the
 * file's own address stays free for the document a person may open next. */
export const previewScheme = 'setdown-preview';

export class FilePreviews<M extends { dispose(): void }> {
  private readonly held = new Map<string, { model: Promise<M>; uses: number }>();
  constructor(private readonly read: (path: string) => Promise<string>, private readonly create: (text: string, path: string) => M) {}
  async reference(path: string): Promise<{ model: M; dispose(): void }> {
    let entry = this.held.get(path);
    if (!entry) { entry = { uses: 0, model: this.read(path).then(text => this.create(text, path)) }; this.held.set(path, entry); }
    const current = entry; current.uses++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (--current.uses) return;
      if (this.held.get(path) === current) this.held.delete(path);
      void current.model.then(model => model.dispose(), () => {});
    };
    try { return { model: await current.model, dispose: release }; }
    catch (error) { release(); throw error; }
  }
}
