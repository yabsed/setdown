import type { PreviewBounds } from './preview-preparation';

export type NativeTabDrag = {
  transferId: string; type: 'dragenter' | 'dragover' | 'drop' | 'dragleave' | 'dragend';
  clientX: number; clientY: number; screenX: number; screenY: number;
  ctrlKey: boolean; altKey: boolean;
};
export type TabDragGuide = { bounds: PreviewBounds; color: string } | null;

