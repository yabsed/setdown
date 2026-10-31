/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See upstream/VSCODE-LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/

// Transient-property portion of VS Code's AbstractCodeEditorService and
// ModelTransientSettingWatcher, omitted from the standalone Monaco build.
import type * as Monaco from 'monaco-editor';

export class TransientModelProperties {
  private readonly _transientWatchers = new Map<string, ModelTransientSettingWatcher>();
  private readonly _onDidChangeTransientModelProperty: Monaco.Emitter<Monaco.editor.ITextModel>;
  readonly onDidChangeTransientModelProperty: Monaco.IEvent<Monaco.editor.ITextModel>;

  constructor(api: typeof Monaco) {
    this._onDidChangeTransientModelProperty = new api.Emitter<Monaco.editor.ITextModel>();
    this.onDidChangeTransientModelProperty = this._onDidChangeTransientModelProperty.event;
  }

  setTransientModelProperty(model: Monaco.editor.ITextModel, key: string, value: unknown): void {
    const uri = model.uri.toString();
    let w = this._transientWatchers.get(uri);
    if (!w) {
      w = new ModelTransientSettingWatcher(uri, model, this);
      this._transientWatchers.set(uri, w);
    }
    const previousValue = w.get(key);
    if (previousValue !== value) {
      w.set(key, value);
      this._onDidChangeTransientModelProperty.fire(model);
    }
  }

  getTransientModelProperty(model: Monaco.editor.ITextModel, key: string): unknown {
    const uri = model.uri.toString();
    const w = this._transientWatchers.get(uri);
    if (!w) return undefined;
    return w.get(key);
  }

  _removeWatcher(w: ModelTransientSettingWatcher): void {
    this._transientWatchers.delete(w.uri);
    w.dispose();
  }
}

class ModelTransientSettingWatcher implements Monaco.IDisposable {
  private readonly _values: { [key: string]: unknown } = {};
  private readonly _listener: Monaco.IDisposable;

  constructor(readonly uri: string, model: Monaco.editor.ITextModel, owner: TransientModelProperties) {
    this._listener = model.onWillDispose(() => owner._removeWatcher(this));
  }

  set(key: string, value: unknown): void { this._values[key] = value; }
  get(key: string): unknown { return this._values[key]; }
  dispose(): void { this._listener.dispose(); }
}
