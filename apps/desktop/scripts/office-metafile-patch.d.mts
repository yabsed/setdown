/** The worker scripts that carry File Viewer's EMF converter; the application loads each by URL. */
export const METAFILE_WORKERS: { readonly pptx: string; readonly ppt: string };
/** The modules that carry it and are bundled into the application's own chunks: package name, path inside the package. */
export const METAFILE_MODULES: ReadonlyArray<readonly [name: string, file: string]>;
/** Whether a resolved file is one of those modules. */
export function isMetafileModule(file: string): boolean;
/** The converter with EMF outlines built as GDI builds them. Throws when the source is not one this was written for. */
export function patchMetafileOutlines(source: string): string;
