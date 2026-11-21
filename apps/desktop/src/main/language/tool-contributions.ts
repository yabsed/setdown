// A tool can need something of another tool of the same project. The Vue tool leaves every
// question about types to TypeScript's server: that server must load Vue's plugin, and answer
// for `.vue` files too. In VS Code an extension says so in its manifest
// (`contributes.typescriptServerPlugins`). A Zed extension says so when it is asked what it adds
// to a server by name (`language_server_additional_initialization_options` and
// `language_server_additional_workspace_configuration`), and Zed lays the answers into that
// server's options before it starts it (`vendor/zed/crates/project/src/lsp_store.rs`).
//
// Setdown asks the Zed extensions the same question (`tooling/language-host`, `contributions`)
// for the tools it starts itself. This file is what is done with the answers. Nothing in it
// knows a tool by name.

type Settings = Record<string, unknown>;
/** What the extension of one tool adds to another tool. `server`: Zed's name of the tool that adds it. */
export type Contribution = { server: string; initializationOptions?: Settings | null; settings?: Settings | null };

const isObject = (value: unknown): value is Settings => !!value && typeof value === 'object' && !Array.isArray(value);
const same = (a: unknown, b: unknown) => (isObject(a) && isObject(b) && typeof a.name === 'string' ? a.name === b.name : JSON.stringify(a) === JSON.stringify(b));

/** `over` laid on `under`. Objects are merged key by key and a plain value of `over` wins, as
 * everywhere else. Lists are joined: two extensions may each bring an entry of the same list
 * (one tsserver plugin each), and neither may remove the other's. An entry `over` has under the
 * same `name` takes the place of the one in `under`. */
export function joinSettings(under: Settings | null | undefined, over: Settings | null | undefined): Settings {
  const result: Settings = { ...under };
  for (const [key, value] of Object.entries(over ?? {})) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    const below = result[key];
    result[key] = Array.isArray(value) && Array.isArray(below) ? [...below.filter(item => !value.some(other => same(item, other))), ...value]
      : isObject(value) && isObject(below) ? joinSettings(below, value) : value;
  }
  return result;
}

/** Everything the other tools add to one tool, the later answer over the earlier. */
export function contributed(contributions: readonly Contribution[]): { initializationOptions: Settings; settings: Settings } {
  return { initializationOptions: contributions.reduce<Settings>((all, item) => joinSettings(all, item.initializationOptions), {}),
    settings: contributions.reduce<Settings>((all, item) => joinSettings(all, item.settings), {}) };
}

/** A tool's options with what the other tools add laid under them: what the tool's own profile
 * or the person wrote wins, and their lists keep their entries. */
export function withContributions<T extends { initializationOptions?: Settings; configuration: Settings }>(profile: T, contributions: readonly Contribution[]): T {
  if (!contributions.length) return profile;
  const added = contributed(contributions);
  return { ...profile, initializationOptions: joinSettings(added.initializationOptions, profile.initializationOptions), configuration: joinSettings(added.settings, profile.configuration) };
}

/** Whether a contribution still describes what is on this computer. An extension names the
 * folder its plugin was installed in; before its own tool has been set up there is no such
 * folder, and a server told to load from it would only report a failure. Where the entry also
 * has a `name`, it is a package to be found from that folder, and `found` says whether it is. */
export function usable(contribution: Contribution, found: (location: string, name?: string) => boolean): boolean {
  const entries: { location: string; name?: string }[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (isObject(value)) {
      if (typeof value.location === 'string') entries.push({ location: value.location, ...(typeof value.name === 'string' ? { name: value.name } : {}) });
      for (const [key, item] of Object.entries(value)) if (key !== 'location') walk(item);
    }
  };
  walk(contribution.initializationOptions); walk(contribution.settings);
  return entries.every(entry => found(entry.location, entry.name));
}

/** What the other tools added, as one line a person can read in the tool's own page: the
 * packages they named (a tsserver plugin), or else the options they set, each with the tool
 * that added it. The words come from an extension, so they are shortened. */
export function describeContributions(contributions: readonly Contribution[]): string {
  const packages = (value: unknown, found: string[] = []): string[] => {
    if (Array.isArray(value)) value.forEach(item => packages(item, found));
    else if (isObject(value)) { if (typeof value.name === 'string' && typeof value.location === 'string') found.push(value.name); else Object.values(value).forEach(item => packages(item, found)); }
    return found;
  };
  const clean = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 80);
  return contributions.map(item => {
    const named = [...new Set([...packages(item.initializationOptions), ...packages(item.settings)])];
    const what = named.length ? named : [...new Set([...Object.keys(item.initializationOptions ?? {}), ...Object.keys(item.settings ?? {})])];
    return what.length ? `${what.map(clean).join(', ')} (${clean(item.server)})` : '';
  }).filter(Boolean).join('; ').slice(0, 600);
}
