import type { ReadingPosition } from '../reading/reading-position';

export type WebHistory = { index: number; entries: { url: string; title: string; pageState?: string }[] };
export type TabVisit = { kind: 'file'; url: string; position?: ReadingPosition }
  | { kind: 'web'; url: string; history?: WebHistory };
export type TabNavigation = { entries: TabVisit[]; index: number };
const MAX_RESOURCE_VISITS = 64;

export function recordVisit(navigation: TabNavigation, visit: TabVisit): void {
  const current = navigation.entries[navigation.index];
  if (current?.kind === visit.kind && current.url === visit.url) {
    navigation.entries[navigation.index] = visit;
    return;
  }
  navigation.entries.splice(navigation.index + 1);
  navigation.entries.push(visit);
  if (navigation.entries.length > MAX_RESOURCE_VISITS) navigation.entries.shift();
  navigation.index = navigation.entries.length - 1;
}
