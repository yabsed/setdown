import seti from './seti-icons.json';
import { DRAWN_ICONS, officeFileIcon } from './office-file-icons';

const names: Record<string, string> = seti.names;
const extensions: Record<string, string> = seti.extensions;
const icons: Record<string, { character: string; dark: string; light: string }> = seti.icons;
const lookup = (map: Record<string, string>, key: string) => Object.hasOwn(map, key) ? map[key] : undefined;

/** A Seti glyph (`character`), or one of Setdown's own drawings (`path`, in a 16×16 box, even-odd) where Seti has none. */
export type FileIcon = { id: string; character: string; dark: string; light: string; path?: string };

/** Filename first, longest compound extension next, then the document formats Seti lacks, then the generic Seti file. */
export function fileIcon(filePath: string): FileIcon {
  const name = (filePath.split(/[\\/]/).at(-1) ?? '').toLowerCase();
  let id = lookup(names, name);
  for (let dot = name.indexOf('.'); !id && dot >= 0; dot = name.indexOf('.', dot + 1)) {
    id = lookup(extensions, name.slice(dot + 1));
  }
  id ??= officeFileIcon(name) ?? seti.file;
  return Object.hasOwn(DRAWN_ICONS, id) ? { id, character: '', ...DRAWN_ICONS[id] } : { id, ...icons[id] };
}
