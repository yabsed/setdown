export type DiskVersion = {
  mtimeMs: number;
  size: number;
};

export type DocumentSnapshot = {
  path: string;
  name: string;
  text: string;
  /** 마지막으로 확인한 디스크 내용. dirty 여부의 기준이다. */
  savedText: string;
  revision: number;
  savedRevision: number;
  diskVersion: DiskVersion;
  isUntitled: boolean;
};
