import type { DocumentSnapshot } from '../../core/document/document';
import type { DocumentTab } from '../../core/workspace/workspace-state';

/** An existing serialized document owner, independent of its mounted surface.
 * File I/O and close approval remain workspace responsibilities.
 */
export interface DocumentContentOwner {
  accepts(tab: DocumentTab): boolean;
  text(tab: DocumentTab): string;
  dirty(tab: DocumentTab): boolean;
  saved(tab: DocumentTab): void;
  replace(tab: DocumentTab, snapshot: DocumentSnapshot): void;
  release(id: string): void;
  releaseAll(): void;
}
