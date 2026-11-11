/** Folder-tab and picker data shared by core rules, the protocol and both processes. */
/** One row of a folder tab. Metadata is lstat-based; links report their own type. */
export type FolderEntry = {
  path: string;
  name: string;
  kind: 'directory' | 'document' | 'file';
  size: number;
  modified: number;
  hidden: boolean;
  /** Present for symbolic links. `broken` links have no reachable target. */
  link?: { target: string; broken: boolean };
};

export type FolderListing = { path: string; entries: FolderEntry[]; truncated: boolean; writable: boolean };

/** `volume` is an unmounted filesystem (`path` is empty until mounted); `device` enables Unmount. */
export type FolderPlace = { id: string; name: string; path: string; kind: 'home' | 'user' | 'bookmark' | 'project' | 'mount' | 'volume' | 'trash' | 'root';
  removable?: boolean; device?: string };

export type FolderLocation = { kind: 'folder'; path: string } | { kind: 'file'; path: string } | { kind: 'missing'; path: string; parent: string | null };

/**
 * Electron-compatible picker request. The open/save, files/folders and multiple
 * flags are the portal FileChooser's OpenFile/SaveFile options (Nautilus derives
 * its NautilusMode from the same three values). Main validates every reply.
 */
export type PathPickerFilter = { name: string; extensions: string[] };
export type PathPickerRequest = {
  id: string;
  kind: 'open' | 'save';
  files: boolean;
  folders: boolean;
  multiple: boolean;
  title: string;
  buttonLabel?: string;
  /** Existing folder to start in. Main resolves missing paths to an existing ancestor. */
  folder: string;
  /** Save name or a file to preselect. */
  name?: string;
  filters: PathPickerFilter[];
  showHidden: boolean;
  /** Remembers the last folder for the same purpose. */
  purpose: string;
};


export type FileApplication = { id: string; name: string; isDefault: boolean };
export type FolderVolume = { device: string; name: string; mountPath: string | null };
export type FileProperties = {
  path: string; name: string; directory: boolean; type: string;
  /** Bytes; for folders the recursive total, `partial` when the walk was cut short. */
  size: number; items?: number; partial: boolean;
  modified: number; created: number; accessed: number;
  permissions: string; owner: string; link?: string;
  free?: number; capacity?: number;
};
/** Main asks a window to show a folder (launch argument, second instance, D-Bus FileManager1). */
export type FolderOpenRequest = { path: string; selection?: string[]; properties?: boolean };
