import { koreanFontClass, koreanLineBox } from '../../core/fonts/korean-fonts';
import type { DocxEditApi, DocxFontRequest } from '../../protocol/docx-edit';

/**
 * Turns the fonts installed on this machine into what the Word engine takes from a font origin.
 * The engine's own types stay in `docx-runtime.ts`; this module only knows their shape, so it is
 * tested without loading the engine.
 *
 * The document keeps naming its own families. A family that is installed is drawn by its own
 * faces under that name; a missing Korean family is drawn by a stand-in, declared to the engine
 * as a substitution that keeps the missing family's line box.
 */
export type FontWish = {
  readonly families: readonly string[];
  readonly defaultFamily: string;
  /** The faces the text uses. Absent before the engine has read the text. */
  readonly faces?: readonly DocxFontRequest[];
  /** Faces an earlier answer already supplied. */
  readonly resolvedFaces?: readonly DocxFontRequest[];
  readonly signal?: AbortSignal;
};
export type FontLineBox = { heightEm: number; baselineEm: number };
export type FontSubstitution = { from: DocxFontRequest; to: DocxFontRequest; lineMetrics?: FontLineBox };
export type FontFragment<Source> = { sources: Source[]; substitutions: FontSubstitution[] };
/** What any font origin answers: faces, mappings onto faces, and what arrives after the first paint. */
export type FontAnswer<Source> = { readonly sources?: readonly Source[]; readonly substitutions?: readonly FontSubstitution[];
  readonly deferred?: Promise<FontAnswer<Source> | undefined> };
/** Admits font bytes as an engine font source, or says why it cannot. */
export type FontSourceMaker<Source> = (bytes: Uint8Array, face: DocxFontRequest & { faceIndex: number }) =>
  { readonly source: Source } | { readonly failure: { readonly reason: string; readonly diagnostic?: string } };
export type FontSupplyOptions = {
  /** How many bytes of installed font files one document may take. */
  budget?: number;
  /** Font files already handed over by main, shared between documents while something still holds the bytes. */
  files?: Map<string, WeakRef<Uint8Array>>;
  warn?: (message: string) => void;
};

/** The engine admits 128 MiB of faces for one document; this leaves room for the packaged ones. */
export const INSTALLED_FONT_BUDGET = 96 * 1024 * 1024;
const STYLES = [{ weight: 400, style: 'normal' }, { weight: 700, style: 'normal' }, { weight: 400, style: 'italic' }, { weight: 700, style: 'italic' }] as const;
const key = (face: DocxFontRequest) => `${face.family.normalize('NFKC').trim().toLowerCase()}\0${face.weight}\0${face.style}`;
const sharedFiles = new Map<string, WeakRef<Uint8Array>>();

export function installedFontSupply<Source>(supply: DocxEditApi['fonts'], makeSource: FontSourceMaker<Source>, options: FontSupplyOptions = {}) {
  const budget = options.budget ?? INSTALLED_FONT_BUDGET, files = options.files ?? sharedFiles, warn = options.warn ?? (message => console.warn(message));
  // Per document: the sources already made and the font files they took.
  const made = new Map<string, Source>(), taken = new Map<string, Uint8Array>();
  let spent = 0;

  return async (wish: FontWish): Promise<FontFragment<Source> | undefined> => {
    // Before its first layout the engine knows the families only. A family then gets its regular and bold faces,
    // upright and slanted: text set in a face that arrives later would be laid out twice.
    const wished: DocxFontRequest[] = wish.faces?.length ? wish.faces.map(face => ({ family: face.family, weight: face.weight, style: face.style }))
      : [...new Set([wish.defaultFamily, ...wish.families])].filter(Boolean).flatMap(family => STYLES.map(face => ({ family, ...face })));
    // The engine lists what it can already draw, a substituted family included. Nothing else is remembered about
    // earlier calls: a document that is loaded again asks from the start and must be answered in full.
    const covered = new Set((wish.resolvedFaces ?? []).map(key));
    const requests = wished.filter(face => !covered.has(key(face)));
    if (!requests.length) return undefined;

    const held = new Map<string, Uint8Array>(taken);
    for (const [id, reference] of files) { const bytes = reference.deref(); if (bytes) held.set(id, bytes); else files.delete(id); }
    const answer = await supply(requests, [...held.keys()]);
    if (wish.signal?.aborted) throw wish.signal.reason;
    for (const file of answer.files) { held.set(file.id, file.bytes); files.set(file.id, new WeakRef(file.bytes)); }

    const sources = new Map<string, Source>(), substitutions: FontSubstitution[] = [];
    for (const face of answer.faces) {
      const bytes = held.get(face.file);
      if (!bytes) continue;
      const drawn: DocxFontRequest = { family: face.standIn ?? face.family, weight: face.weight, style: face.style };
      let source = made.get(key(drawn));
      if (!source) {
        if (!taken.has(face.file) && spent + bytes.length > budget) { warn(`DOCX font left out, the document already holds too many font bytes: ${face.family}`); continue; }
        const result = makeSource(bytes, { ...drawn, faceIndex: face.index });
        if (!('source' in result)) { warn(`DOCX font unusable: ${drawn.family} ${result.failure.reason} ${result.failure.diagnostic ?? ''}`.trimEnd()); continue; }
        if (!taken.has(face.file)) { taken.set(face.file, bytes); spent += bytes.length; }
        source = result.source; made.set(key(drawn), source);
      }
      // A stand-in the engine already holds needs no second copy; its substitution is enough.
      if (!covered.has(key(drawn))) sources.set(key(drawn), source);
      // The document keeps naming its own family; only what draws it changes.
      if (face.standIn) substitutions.push({ from: { family: face.family, weight: face.weight, style: face.style }, to: drawn,
        ...(face.lineBox ? { lineMetrics: face.lineBox } : {}) });
    }
    return sources.size || substitutions.length ? { sources: [...sources.values()], substitutions } : undefined;
  };
}

/**
 * The packaged pan-CJK face as the last resort for Korean text, on a machine where no installed
 * font can draw it. The engine's own origin maps four Korean families onto that face (맑은 고딕,
 * 바탕, 굴림, 돋움) on the face's own line box, and leaves every other Korean family to whatever
 * the browser picks, measured by estimate. Here every Korean family that nothing earlier draws is
 * mapped onto the face, and keeps the line box Word gives it, as an installed stand-in does.
 */
export function koreanLastResort<Source>(packaged: (wish: FontWish) => FontAnswer<Source> | undefined | Promise<FontAnswer<Source> | undefined>, face: DocxFontRequest) {
  return async (wish: FontWish): Promise<FontAnswer<Source> | undefined> => {
    const painted = new Set((wish.resolvedFaces ?? []).map(key));
    // As for the origin itself, a family is drawn when its regular face is.
    const korean = [...new Set(wish.families)].filter(family => koreanFontClass(family) && !painted.has(key({ family, weight: 400, style: 'normal' })));
    if (!korean.length) return packaged(wish);
    const boxed = (answer: FontAnswer<Source> | undefined): FontAnswer<Source> | undefined => {
      if (!answer) return answer;
      const own = (answer.substitutions ?? []).map(substitution => key(substitution.to) === key(face) && koreanFontClass(substitution.from.family)
        ? { ...substitution, lineMetrics: koreanLineBox(substitution.from.family) } : substitution);
      // A family is mapped onto the face only by an answer that brings the face or follows one that did:
      // while it is still loading, and when it could not be loaded, there is nothing to map onto.
      const held = painted.has(key(face)) || !!answer.sources?.length;
      const mapped = new Set(own.map(substitution => key(substitution.from)));
      const added = !held ? [] : korean.flatMap(family => STYLES.map(style => ({ family, ...style }))).filter(from => !mapped.has(key(from)))
        .map(from => ({ from, to: face, lineMetrics: koreanLineBox(from.family) }));
      return { ...answer, substitutions: [...own, ...added], ...(answer.deferred ? { deferred: answer.deferred.then(boxed) } : {}) };
    };
    // Naming the face makes the origin load it, also for a family it has no rule of its own for.
    return boxed(await packaged({ ...wish, families: [...wish.families, face.family] }));
  };
}
