type Send = (message: Record<string, unknown>) => void;

type PreviewHeading = {
  id: string;
  text: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  sourceLine?: number;
};

type HighlightRegistry = {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
};

type HighlightConstructor = new (...ranges: Range[]) => unknown;
type DisclosureState = { open: boolean; authored: boolean };

export function createReaderTools(send: Send, revision: () => number, rootSelector: string) {
  let headingElements = new Map<string, HTMLElement>();
  let headingSignature = '';
  let activeHeadingId: string | null = null;
  let headingTimer: number | null = null;
  let searchQuery = '';
  let searchRanges: Range[] = [];
  let activeSearchIndex = -1;
  let restoringDisclosures = false;
  const disclosures = new Map<string, DisclosureState>();

  function readHeadings(): PreviewHeading[] {
    const elements = new Map<string, HTMLElement>();
    const headings: PreviewHeading[] = [];
    document.querySelector(rootSelector)
      ?.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')
      .forEach((heading, index) => {
        const text = (heading.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!text) return;
        const id = heading.id ? `id:${heading.id}` : `index:${index}`;
        const source = Number(heading.getAttribute('data-source-line')
          ?? heading.closest('[data-source-line]')?.getAttribute('data-source-line'));
        elements.set(id, heading);
        headings.push({
          id,
          text,
          level: Number(heading.tagName.slice(1)) as PreviewHeading['level'],
          sourceLine: Number.isFinite(source) && source > 0 ? source : undefined,
        });
      });
    headingElements = elements;
    return headings;
  }

  function publishActiveHeading() {
    if (!headingElements.size) readHeadings();
    const threshold = Math.min(120, Math.max(36, window.innerHeight * 0.16));
    let active: string | null = null;
    for (const [id, heading] of headingElements) {
      if (heading.getBoundingClientRect().top <= threshold) active = id;
      else if (active === null) active = id;
      else break;
    }
    if (active === activeHeadingId) return;
    activeHeadingId = active;
    send({ type: 'marktex:active-heading', revision: revision(), id: active });
  }

  function publishHeadings(force = false) {
    const headings = readHeadings();
    const signature = JSON.stringify(headings);
    if (force || signature !== headingSignature) {
      headingSignature = signature;
      send({ type: 'marktex:headings', revision: revision(), headings });
    }
    publishActiveHeading();
  }

  function scheduleHeadings() {
    if (headingTimer !== null) window.clearTimeout(headingTimer);
    headingTimer = window.setTimeout(() => {
      headingTimer = null;
      publishHeadings();
    }, 60);
  }

  const registry = () =>
    (CSS as unknown as { highlights?: HighlightRegistry }).highlights ?? null;

  function publishSearchResult() {
    send({
      type: 'marktex:find-result',
      revision: revision(),
      activeMatch: activeSearchIndex >= 0 ? activeSearchIndex + 1 : 0,
      matches: searchRanges.length,
    });
  }

  function clearSearch() {
    registry()?.delete('setdown-search-results');
    registry()?.delete('setdown-search-active');
    searchQuery = '';
    searchRanges = [];
    activeSearchIndex = -1;
    publishSearchResult();
  }

  function buildSearchRanges(query: string): Range[] {
    const root = document.querySelector(rootSelector);
    if (!root || !query) return [];
    const nodes: Array<{ node: Text; start: number; end: number }> = [];
    let text = '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        return !parent || parent.closest('script, style, noscript, [hidden]')
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let current = walker.nextNode(); current; current = walker.nextNode()) {
      const node = current as Text;
      const start = text.length;
      text += node.data;
      nodes.push({ node, start, end: text.length });
    }
    const haystack = text.toLocaleLowerCase();
    const needle = query.toLocaleLowerCase();
    const ranges: Range[] = [];
    for (let offset = 0; needle && ranges.length < 10_000;) {
      const found = haystack.indexOf(needle, offset);
      if (found < 0) break;
      const end = found + needle.length;
      const first = nodes.find((entry) => entry.start <= found && entry.end > found);
      const last = nodes.find((entry) => entry.start < end && entry.end >= end);
      if (first && last) {
        const range = document.createRange();
        range.setStart(first.node, found - first.start);
        range.setEnd(last.node, end - last.start);
        ranges.push(range);
      }
      offset = Math.max(end, found + 1);
    }
    return ranges;
  }

  function paintSearch() {
    const highlights = registry();
    const Highlight = (window as unknown as { Highlight?: HighlightConstructor }).Highlight;
    if (!highlights || !Highlight) return;
    highlights.delete('setdown-search-results');
    highlights.delete('setdown-search-active');
    if (!searchRanges.length) return;
    highlights.set('setdown-search-results', new Highlight(...searchRanges));
    if (activeSearchIndex >= 0) {
      highlights.set('setdown-search-active', new Highlight(searchRanges[activeSearchIndex]));
    }
  }

  function search(query: string, direction: 'forward' | 'backward', findNext: boolean) {
    if (!query) return clearSearch();
    if (query !== searchQuery || !findNext) {
      searchQuery = query;
      searchRanges = buildSearchRanges(query);
      activeSearchIndex = !searchRanges.length ? -1
        : direction === 'backward' ? searchRanges.length - 1 : 0;
    } else if (searchRanges.length) {
      const step = direction === 'backward' ? -1 : 1;
      activeSearchIndex = (activeSearchIndex + step + searchRanges.length) % searchRanges.length;
    }
    paintSearch();
    const active = searchRanges[activeSearchIndex];
    if (active) {
      const rect = active.getBoundingClientRect();
      if (rect.top < 48 || rect.bottom > window.innerHeight - 24) {
        active.startContainer.parentElement?.scrollIntoView({ block: 'center' });
      }
    }
    publishSearchResult();
  }

  function eachDisclosure(visit: (element: HTMLDetailsElement, key: string) => void) {
    const seen = new Map<string, number>();
    for (const element of document.querySelectorAll('details')) {
      const details = element as HTMLDetailsElement;
      const label = (details.querySelector('summary')?.textContent ?? '')
        .trim().replace(/\s+/g, ' ').slice(0, 200);
      const nth = (seen.get(label) ?? 0) + 1;
      seen.set(label, nth);
      visit(details, `${label}\u0000${nth}`);
    }
  }

  function applyDisclosures(inserted: Element[] | null) {
    restoringDisclosures = true;
    try {
      eachDisclosure((element, key) => {
        if (inserted && !inserted.some((node) => node === element || node.contains(element))) return;
        const known = disclosures.get(key);
        if (!known || element.open !== known.authored) {
          disclosures.set(key, { open: element.open, authored: element.open });
        } else if (element.open !== known.open) element.open = known.open;
      });
    } finally {
      restoringDisclosures = false;
    }
  }

  function scrollToHeading(id: string, hydrate: () => void, afterScroll: () => void) {
    let target = headingElements.get(id);
    if (!target) {
      hydrate();
      readHeadings();
      target = headingElements.get(id);
    }
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    window.setTimeout(() => {
      publishActiveHeading();
      afterScroll();
    }, 180);
  }

  document.addEventListener('toggle', (event) => {
    if (restoringDisclosures || !(event.target instanceof HTMLDetailsElement)) return;
    eachDisclosure((element, key) => {
      if (element !== event.target) return;
      const known = disclosures.get(key);
      if (known) known.open = element.open;
      else disclosures.set(key, { open: element.open, authored: !element.open });
    });
  }, true);
  const style = document.createElement('style');
  style.textContent = `
    ::highlight(setdown-search-results) { background: rgba(255, 210, 64, .58); color: inherit; }
    ::highlight(setdown-search-active) { background: #ff9f1c; color: #17130b; }
  `;
  document.head.append(style);

  return {
    applyDisclosures,
    clearSearch,
    publishActiveHeading,
    publishHeadings,
    scheduleHeadings,
    scrollToHeading,
    search,
  };
}
