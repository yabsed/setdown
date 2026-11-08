import seti from './seti-icons.json';

const names: Record<string, string> = seti.names;
const extensions: Record<string, string> = seti.extensions;
const icons: Record<string, { character: string; dark: string; light: string }> = seti.icons;
const lookup = (map: Record<string, string>, key: string) => Object.hasOwn(map, key) ? map[key] : undefined;

/** Filename first, longest compound extension next, then the generic Seti file. */
export function fileIcon(filePath: string) {
  const name = (filePath.split(/[\\/]/).at(-1) ?? '').toLowerCase();
  let id = lookup(names, name);
  for (let dot = name.indexOf('.'); !id && dot >= 0; dot = name.indexOf('.', dot + 1)) {
    id = lookup(extensions, name.slice(dot + 1));
  }
  id ??= seti.file;
  return { id, ...icons[id] };
}
