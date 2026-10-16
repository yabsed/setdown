/** Text changes shared by ordinary editors and Working Tree reviews. */
export type WorkingTreeEdit = {
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  text: string;
};
