import type { DocumentSnapshot } from '../../core/document/document';
import type { DocumentContent as DocumentTab } from '../../core/workspace/document-store';

/** An existing serialized document owner, independent of its mounted surface.
 * File I/O and close approval remain workspace responsibilities.
 */
export interface DocumentContentOwner {
  accepts(tab: DocumentTab): boolean;
  text(tab: DocumentTab): string;
  dirty(tab: DocumentTab): boolean;
  saved(tab: DocumentTab): void;
  replace(tab: DocumentTab, snapshot: DocumentSnapshot): void;
  save?(tab: DocumentTab, saveAs?: boolean): Promise<import('../../protocol/desktop-api').SaveResult>;
  retarget?(tab: DocumentTab): void;
  release(id: string): void;
  releaseAll(): void;
}
