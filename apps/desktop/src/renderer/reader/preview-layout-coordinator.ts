import type { PreviewBounds, PreviewLayoutGuide } from '../../protocol/desktop-api';
import type { DesktopPort } from '../ports/desktop-port';

type Entry = { tabId: string; bounds: PreviewBounds };
type Contribution = { primary: Entry | null; backgrounds: Entry[]; guide?: PreviewLayoutGuide };

/** Each reader owns a contribution, never the visibility of another group. */
export class PreviewLayoutCoordinator {
  private readonly contributions = new Map<string, Contribution>();
  private focused = 'documents';
  constructor(private readonly desktop: DesktopPort) {}
  focus(owner: string): void { if (owner !== this.focused) { this.focused = owner; this.publish(); } }
  remove(owner: string): void { if (this.contributions.delete(owner)) this.publish(); }
  port(owner: string): DesktopPort {
    const update: DesktopPort['showPreview'] = (id, bounds, backgrounds = [], guide) => {
      this.contributions.set(owner, { primary: id && bounds ? { tabId: id, bounds } : null, backgrounds, guide });
      this.publish();
    };
    const background: DesktopPort['setBackgroundPreviews'] = entries => {
      const current = this.contributions.get(owner);
      this.contributions.set(owner, { primary: current?.primary ?? null, backgrounds: entries, guide: current?.guide });
      this.publish();
    };
    // Electron contextBridge freezes exported properties. A Proxy cannot
    // override their values without violating JavaScript proxy invariants.
    return { ...this.desktop, showPreview: update, setBackgroundPreviews: background };
  }
  private publish(): void {
    const values = [...this.contributions.values()];
    const primary = this.contributions.get(this.focused)?.primary ?? null;
    const entries = new Map<string, Entry>();
    for (const value of values) for (const entry of [...value.backgrounds, ...(value.primary ? [value.primary] : [])]) entries.set(entry.tabId, entry);
    if (primary) entries.delete(primary.tabId);
    const guides = values.flatMap(value => value.guide ? [value.guide] : []);
    const first = guides[0];
    let guide: PreviewLayoutGuide | undefined;
    if (first) {
      const x = Math.min(...guides.map(g => g.area.x)), y = Math.min(...guides.map(g => g.area.y));
      guide = { viewport: first.viewport, area: { x, y,
        width: Math.max(...guides.map(g => g.area.x + g.area.width)) - x,
        height: Math.max(...guides.map(g => g.area.y + g.area.height)) - y },
        previews: guides.flatMap(g => g.previews).filter(p => entries.has(p.tabId) || p.tabId === primary?.tabId) };
    }
    this.desktop.showPreview(primary?.tabId ?? null, primary?.bounds ?? null, [...entries.values()], guide);
  }
}
