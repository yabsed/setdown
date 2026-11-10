// apps/desktop/src/main/language/zed-project-settings.ts
import { readFileSync, statSync, watchFile, unwatchFile } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "jsonc-parser";

// apps/desktop/src/main/language/language-settings.ts
function mergeLanguageSettings(...values) {
  const result = {};
  for (const value of values) for (const [key, item] of Object.entries(value ?? {})) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    result[key] = item && typeof item === "object" && !Array.isArray(item) ? mergeLanguageSettings(result[key] && typeof result[key] === "object" && !Array.isArray(result[key]) ? result[key] : {}, item) : item;
  }
  return result;
}

// apps/desktop/src/main/language/zed-project-settings.ts
var object = (value) => !!value && typeof value === "object" && !Array.isArray(value);
var ZedProjectSettings = class {
  files = /* @__PURE__ */ new Map();
  resources = /* @__PURE__ */ new Map();
  resolved = /* @__PURE__ */ new Map();
  watchers = /* @__PURE__ */ new Map();
  globals;
  constructor(options = {}) {
    const home = options.home ?? os.homedir(), env = options.env ?? process.env;
    const config = (options.platform ?? process.platform) === "win32" ? path.join(env.APPDATA ?? path.join(home, "AppData", "Roaming"), "Zed") : path.join(env.FLATPAK_XDG_CONFIG_HOME ?? env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "zed");
    this.globals = [path.join(config, "settings.json"), path.join(home, ".zed", "settings.json")];
    this.changed = options.changed;
  }
  changed;
  load(file, previous = {}) {
    try {
      if (statSync(file).size > 1024 * 1024) throw Error("Settings exceed 1 MiB");
      const errors = [], value = parse(readFileSync(file, "utf8"), errors, { allowTrailingComma: true });
      if (errors.length || !object(value)) throw Error("Invalid JSONC");
      return object(value.lsp) ? mergeLanguageSettings(value.lsp) : {};
    } catch (error) {
      if (error.code === "ENOENT") return {};
      console.warn(`Could not read Zed language settings at ${file}; keeping the last valid settings.`, String(error));
      return previous;
    }
  }
  read(file) {
    if (!this.files.has(file)) {
      this.files.set(file, this.load(file));
      if (this.changed) {
        const update = () => {
          const previous = this.files.get(file), next = this.load(file, previous);
          if (JSON.stringify(previous) === JSON.stringify(next)) return;
          this.files.set(file, next);
          this.resources.clear();
          this.resolved.clear();
          this.changed?.([.../* @__PURE__ */ new Set([...Object.keys(previous), ...Object.keys(next)])].filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key])));
        };
        watchFile(file, { persistent: false, interval: 750 }, update);
        this.watchers.set(file, update);
      }
    }
    return this.files.get(file);
  }
  configuration(resource) {
    const directory = resource ? path.dirname(resource) : "";
    let result = this.resources.get(directory);
    if (!result) {
      const ancestors = [];
      if (directory) for (let current = directory; ; current = path.dirname(current)) {
        ancestors.unshift(path.join(current, ".zed", "settings.json"));
        if (path.dirname(current) === current) break;
      }
      result = mergeLanguageSettings(...[.../* @__PURE__ */ new Set([...this.globals, ...ancestors])].map((file) => this.read(file)));
      this.resources.set(directory, result);
    }
    return result;
  }
  options(definition, resource, adapter) {
    const key = JSON.stringify([definition.id, resource && path.dirname(resource), adapter]);
    const cached = this.resolved.get(key);
    if (cached) return cached;
    const lsp = this.configuration(resource);
    const names = [...new Set([
      definition.id,
      definition.provenance?.profile,
      definition.launch.kind === "native" ? definition.launch.command : void 0,
      adapter
    ].filter((name) => !!name))];
    const entry = mergeLanguageSettings(...names.map((name) => object(lsp[name]) ? lsp[name] : void 0));
    const result = {
      ...object(entry.settings) ? { settings: entry.settings } : {},
      ...object(entry.initialization_options) ? { initializationOptions: entry.initialization_options } : {}
    };
    this.resolved.set(key, result);
    return result;
  }
  dispose() {
    for (const [file, callback] of this.watchers) unwatchFile(file, callback);
    this.watchers.clear();
    this.files.clear();
    this.resources.clear();
    this.resolved.clear();
  }
};
export {
  ZedProjectSettings
};
