import { imageSessions } from '../../image/image-edit-sessions';
import { officeEditSession } from '../../office-edit/office-editors';
import { draggedPaths, PROJECT_FILES } from '../../project/explorer/explorer-selection';
import { fileDrag, FILE_DRAG_END } from '../../files/file-drag';
import type { ClaimedTabTransfer, TransferableTab } from '../../../protocol/desktop-api';
import { splitDirection, type EditorGroupPlacement, type EditorGroups } from '../../../core/workspace/editor-groups';
import { stripDrop, tabClusterOf, type StripPiece } from '../../../core/workspace/tab-clusters';
import { view } from '../workspace-view.svelte';
import type { WorkspaceTab } from '../../../core/workspace/workspace-state';
import type { DesktopPort } from '../../ports/desktop-port';

type Options = {
  desktop: DesktopPort; shell: HTMLElement; tabs: WorkspaceTab[]; groups: EditorGroups;
  activeId(): string | null; activate(id: string): void;
  serialize(tab: WorkspaceTab): TransferableTab; render(): void;
  install(transfer: ClaimedTabTransfer, placement: EditorGroupPlacement): Promise<void>;
  openFile(path: string, placement: EditorGroupPlacement): Promise<void>;
  dragging(active: boolean): void;
  copy?(id: string, target: EditorGroupPlacement): void;
  move?(id: string, target: EditorGroupPlacement): void;
};
type Target = EditorGroupPlacement;
/** How long a tab is held over another before releasing it there makes a tab group of the two
 * (Firefox `browser.tabs.dragDrop.createGroup.delayMS`). */
const PAIR_DELAY = 240;
const MIME = 'application/x-setdown-tab';
const FILE = 'application/x-setdown-project-file';

export function createTabDrag(options: Options) {
  let tabId: string | null = null, transferId: string | null = null;
  let canceled = false, leftWindow = false, sourceDrag = false;
  let dragging = false;
  let fileGuide = false;
  let sharedDragId: string | null = null;
  let localOnly = false;
  const copying = (event: DragEvent) => /Mac/.test(navigator.platform) ? event.altKey : event.ctrlKey;
  const setDragging = (active: boolean) => {
    if (dragging === active) return;
    dragging = active;
    options.dragging(active);
  };
  const overlay = document.createElement('div');
  overlay.className = 'group-drop-overlay'; overlay.hidden = true;
  const indicator = document.createElement('div');
  indicator.className = 'tab-drop-indicator'; indicator.hidden = true;
  options.shell.append(overlay, indicator);
  let activeStrip: HTMLElement | null = null;
  // The painted guide and the committed placement must describe the same move.
  let guidedTarget: Target | null = null;
  let retainedTarget: Target | null = null;
  let detachTarget: { x: number; y: number } | null = null;
  let scrollFrame = 0;
  let scrollList: HTMLElement | null = null;
  let scrollPointer = 0;
  // The tab a dragged tab is held over, since when, and where the pointer was last; the tab is
  // marked once the hold is long enough to make a tab group of the two.
  let pairing: { id: string; since: number; timer: number; x: number } | null = null;
  let pairedTab: HTMLElement | null = null;
  const clearPair = () => {
    if (pairing) clearTimeout(pairing.timer);
    pairing = null; pairedTab?.classList.remove('is-group-target'); pairedTab = null;
  };
  const clearStrip = () => {
    clearPair();
    indicator.hidden = true;
    activeStrip?.classList.remove('is-drop-target'); activeStrip = null;
    cancelAnimationFrame(scrollFrame); scrollFrame = 0; scrollList = null;
  };
  const clearTarget = () => {
    options.desktop.setNativeTabDragGuide(null);
    guidedTarget = retainedTarget = null;
    detachTarget = null;
    overlay.hidden = true;
    clearStrip();
  };
  function leaveTarget(terminal: boolean) {
    const retained = terminal ? guidedTarget ?? retainedTarget : null;
    leftWindow = true; clearTarget(); retainedTarget = retained;
    const id = sharedDragId ?? transferId;
    if (id) options.desktop.updateTabDragTarget(id, false, false, terminal && !!retained);
  }
  function leave(event: { clientX: number; clientY: number; screenX: number; screenY: number }) {
    const terminal = event.clientX === 0 && event.clientY === 0 && event.screenX === 0 && event.screenY === 0;
    // A native child boundary can report a null relatedTarget while still
    // inside this window. Keep the painted placement until an actual receiver
    // replaces it, or completion proves an outside release.
    if (!terminal && event.clientX >= 0 && event.clientY >= 0
      && event.clientX < innerWidth && event.clientY < innerHeight) return;
    leaveTarget(terminal);
  }
  /** What scrolls a strip's tabs: the row they share with the strip's buttons. */
  const tabScroller = (strip: HTMLElement) => strip.querySelector<HTMLElement>('.tab-row')!;
  function stripTarget(strip: HTMLElement, x: number): Target {
    detachTarget = null; retainedTarget = null;
    if (activeStrip !== strip) activeStrip?.classList.remove('is-drop-target');
    activeStrip = strip; strip.classList.add('is-drop-target');
    const list = strip.querySelector<HTMLElement>('.tab-list')!;
    // What the strip draws, in order: tabs, and the labels and counts of its tab groups. A folded
    // tab group draws fewer tabs than it holds, so the place is read from the strip's own order.
    const pieces: StripPiece[] = Array.from(list.querySelectorAll<HTMLElement>('[data-tab-id], [data-cluster-label], [data-cluster-more]'), piece => {
      const rect = piece.getBoundingClientRect(), data = piece.dataset;
      return { kind: data.tabId ? 'tab' : data.clusterLabel ? 'label' : 'more', id: data.tabId ?? data.clusterLabel ?? data.clusterMore!, left: rect.left, right: rect.right };
    });
    const group = options.groups.groups.find(group => group.id === strip.dataset.groupId);
    const drop = stripDrop(group ?? { tabs: [], sticky: 0, activeId: null, clusters: [] }, pieces, x);
    // Firefox: a tab held over the middle of another tab that is loose (not pinned, in no tab
    // group) makes a tab group with it when released. Only a tab of this window, itself not
    // pinned; the outer fifths of the tab under it still mean "before" and "after".
    const under = pieces.find(piece => x >= piece.left && x < piece.right), margin = under ? (under.right - under.left) * .2 : 0;
    const loose = !!tabId && !!group && under?.kind === 'tab' && under.id !== tabId && x >= under.left + margin && x < under.right - margin
      && group.tabs.indexOf(under.id) >= group.sticky && !tabClusterOf(group, under.id) && !options.groups.isSticky(tabId);
    if (!loose) clearPair();
    else if (pairing?.id !== under!.id) {
      clearPair();
      // A pointer that rests sends no further dragover in time: the hold is read again when it is long enough.
      pairing = { id: under!.id, since: performance.now(), x, timer: window.setTimeout(() => { if (activeStrip && pairing) stripTarget(activeStrip, pairing.x); }, PAIR_DELAY + 20) };
    } else pairing.x = x;
    if (pairing && group && performance.now() - pairing.since >= PAIR_DELAY) {
      const held = pieces.findIndex(piece => piece.kind === 'tab' && piece.id === pairing!.id);
      const element = list.querySelectorAll<HTMLElement>('[data-tab-id], [data-cluster-label], [data-cluster-more]')[held];
      if (pairedTab !== element) { pairedTab?.classList.remove('is-group-target'); pairedTab = element ?? null; pairedTab?.classList.add('is-group-target'); }
      indicator.hidden = true; overlay.hidden = true;
      options.desktop.setNativeTabDragGuide(null);
      return guidedTarget = { groupId: group.id, direction: null, index: group.tabs.indexOf(pairing.id) + 1, cluster: null, pair: pairing.id };
    }
    pairedTab?.classList.remove('is-group-target'); pairedTab = null;
    // The guide stays inside the part of the row that shows.
    const bounds = tabScroller(strip).getBoundingClientRect(), stripBounds = strip.getBoundingClientRect();
    const edge = pieces.length ? drop.edge : list.getBoundingClientRect().left;
    Object.assign(indicator.style, { left: `${Math.max(bounds.left, Math.min(edge, bounds.right)) - 1}px`,
      top: `${stripBounds.top + 5}px`, height: `${stripBounds.height - 7}px` });
    // A tab that would join a tab group is guided in that group's colour.
    const joined = drop.cluster ? group?.clusters.find(cluster => cluster.id === drop.cluster) : undefined;
    if (joined) indicator.dataset.clusterColor = joined.color; else delete indicator.dataset.clusterColor;
    indicator.hidden = false; overlay.hidden = true;
    options.desktop.setNativeTabDragGuide(null);
    return guidedTarget = { groupId: strip.dataset.groupId!, direction: null, index: drop.index, cluster: drop.cluster };
  }
  function scrollStrip() {
    if (!scrollList || !activeStrip) { scrollFrame = 0; return; }
    const bounds = scrollList.getBoundingClientRect();
    const speed = scrollPointer < bounds.left + 24 ? -12 : scrollPointer > bounds.right - 24 ? 12 : 0;
    const previous = scrollList.scrollLeft;
    scrollList.scrollLeft += speed;
    if (scrollList.scrollLeft !== previous) stripTarget(activeStrip, scrollPointer);
    scrollFrame = requestAnimationFrame(scrollStrip);
  }
  // The top-right strip leaves room for the window's own buttons, as wide as they are (`style.css`
  // `.window-drag-space`). While a tab is dragged the window is not resizable (main, Linux): its
  // maximize button goes, that room shrinks, and every tab of the strip changes width under the
  // tab being dragged, moving the place it was aimed at. The room keeps its width from the start
  // of the drag until the buttons are back.
  let spaceHold = 0;
  const holdWindowButtonRoom = () => {
    const hold = ++spaceHold;
    for (const space of document.querySelectorAll<HTMLElement>('.tab-strip.has-window-controls .window-drag-space')) {
      if (!space.style.flexBasis) space.style.flexBasis = getComputedStyle(space).flexBasis;
    }
    return hold;
  };
  const releaseWindowButtonRoom = () => {
    const hold = ++spaceHold, started = performance.now();
    const release = () => {
      if (hold !== spaceHold) return;
      let waiting = false;
      for (const space of document.querySelectorAll<HTMLElement>('.tab-strip.has-window-controls .window-drag-space')) {
        const kept = space.style.flexBasis;
        if (!kept) continue;
        // Read what the room would be now; give it back only when that is what was kept.
        space.style.flexBasis = '';
        if (getComputedStyle(space).flexBasis !== kept && performance.now() - started < 1500) { space.style.flexBasis = kept; waiting = true; }
      }
      if (waiting) requestAnimationFrame(release);
    };
    release();
  };
  const reset = () => {
    if (transferId) { options.desktop.setNativeTabDrag(null); releaseWindowButtonRoom(); }
    tabId = transferId = null; canceled = false; leftWindow = sourceDrag = fileGuide = false; view.draggedTabId = null;
    clearTarget(); options.shell.classList.remove('is-tab-dragging');
    setDragging(false);
  };
  const installIncoming = (id: string, destination: Target) => {
    void options.desktop.claimTabTransfer(id).then(async transfer => {
      if (transfer) await options.install(transfer, destination);
    }).catch(error => console.error('Could not move dropped tab', error));
  };
  const stopSharedDrag = options.desktop.onTabDragState(({ transferId: id, active, commitGuide, copy, commitPoint }) => {
    if (active) {
      if (sharedDragId !== id && transferId !== id) clearTarget();
      sharedDragId = id;
      setDragging(true); options.shell.classList.add('is-tab-dragging');
    } else if (sharedDragId === id) {
      sharedDragId = null;
      // A new local gesture may start before the previous drag cancellation
      // completes in main. Its late end must not clear the new token/receiver.
      if (transferId && transferId !== id) return;
      const destination = commitGuide ? commitPoint ? target(new DragEvent('drop', {
        clientX: commitPoint.x, clientY: commitPoint.y,
        ctrlKey: copy === true, altKey: copy === true,
      })) : guidedTarget ?? retainedTarget : null;
      const local = sourceDrag ? tabId : null;
      reset();
      if (destination && local) { options.desktop.cancelTabTransfer(id); move(local, destination, copy === true); }
      else if (destination) installIncoming(id, destination);
    }
  });
  window.addEventListener('beforeunload', stopSharedDrag, { once: true });
  const stopNativeDrag = options.desktop.onNativeTabDrag(input => {
    if (input.transferId !== transferId && input.transferId !== sharedDragId) return;
    if (input.type === 'dragleave') {
      leave(input);
      return;
    }
    const dataTransfer = new DataTransfer();
    dataTransfer.setData(MIME, input.transferId);
    dataTransfer.dropEffect = input.ctrlKey || input.altKey ? 'copy' : 'move';
    const event = new DragEvent(input.type, { ...input, dataTransfer, cancelable: true });
    if (input.type === 'dragend') controller.end(event);
    else window.dispatchEvent(event);
  });
  window.addEventListener('beforeunload', stopNativeDrag, { once: true });
  // A folder tab's documents arrive as an OS file drag (file-drag.ts) and take the same placements as Explorer files.
  const ownFiles = (event: DragEvent) => fileDrag.documents.length > 0 && fileDrag.owns(event);
  const supported = (event: DragEvent) => !!transferId || ownFiles(event)
    || Array.from(event.dataTransfer?.types ?? []).some(type => type === MIME || type === FILE || type === PROJECT_FILES);
  // Over a folder tab, dragged files are a transfer into that folder: the folder
  // surface owns the drop, so it must keep receiving pointer events. Tabs still split it.
  const overFolder = (event: DragEvent) => !transferId && !sharedDragId
    && !Array.from(event.dataTransfer?.types ?? []).includes(MIME)
    && [...document.querySelectorAll<HTMLElement>('.folder-content:not(.inactive) .folder-surface')].some(surface => {
      const box = surface.getBoundingClientRect();
      return event.clientX >= box.left && event.clientX < box.right && event.clientY >= box.top && event.clientY < box.bottom;
    });
  function target(event: DragEvent): Target | null {
    const area = document.querySelector('.editor-area')!;
    const point = { x: event.clientX, y: event.clientY };
    for (const element of area.querySelectorAll<HTMLElement>('.editor-group')) {
      const box = element.getBoundingClientRect();
      if (point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom) continue;
      const groupId = element.dataset.groupId!;
      const strip = element.querySelector<HTMLElement>('.tab-strip')!;
      if (point.y < strip.getBoundingClientRect().bottom) return stripTarget(strip, point.x);
      const body = element.querySelector('.group-body')!.getBoundingClientRect();
      if (point.y < body.top || point.y >= body.bottom) { clearTarget(); return null; }
      const direction = splitDirection(point.x - body.left, point.y - body.top, body.width, body.height);
      const source = tabId ? options.groups.owner(tabId) : null;
      const split = source?.id === groupId && source.tabs.length === 1 && !copying(event) ? null : direction;
      // A sole tab cannot split its own group. Keep its existing tear-off in
      // normal windows; main cancels it when maximized/fullscreen. Every other
      // body point splits by the grid; merging/reordering belongs to the strip.
      if (source?.id === groupId && !split) {
        clearTarget();
        detachTarget = { x: event.screenX, y: event.screenY };
        return null;
      }
      // Replace an accepted guide directly. Sending null first makes the native
      // receiver paint an empty frame between the two asynchronous IPC updates.
      clearStrip(); detachTarget = null; retainedTarget = null;
      const left = body.left + (split === 'right' ? body.width / 2 : 0);
      const top = body.top + (split === 'down' ? body.height / 2 : 0);
      Object.assign(overlay.style, { left: `${left}px`, top: `${top}px`,
        width: `${body.width / (split === 'left' || split === 'right' ? 2 : 1)}px`,
        height: `${body.height / (split === 'up' || split === 'down' ? 2 : 1)}px` });
      overlay.hidden = false;
      options.desktop.setNativeTabDragGuide({ bounds: { x: left, y: top, width: parseFloat(overlay.style.width), height: parseFloat(overlay.style.height) }, color: '' });
      return guidedTarget = { groupId, direction: split };
    }
    clearTarget();
    return null;
  }
  function move(id: string, destination: Target, copy = false) {
    if (copy && options.copy) { options.copy(id, destination); return; }
    if (options.move) { options.move(id, destination); return; }
    const tab = options.tabs.find(tab => tab.id === id);
    if (tab) options.serialize(tab); // Capture the visible source group before reparenting its editor.
    options.groups.move(id, destination.groupId, destination.direction, destination.index, destination.cluster);
    options.render(); options.activate(id);
  }
  window.addEventListener('dragstart', event => {
    if (supported(event)) { sourceDrag = true; setDragging(true); options.shell.classList.add('is-tab-dragging'); }
  });
  // Explorer files use the workspace drop guides too, but have no tab-transfer
  // token or TabChrome dragend callback. Cancellation/outside drops must release
  // their input shield just as a completed in-window drop does.
  window.addEventListener('dragend', () => {
    if (sourceDrag && !transferId && !sharedDragId) reset();
  });
  // The OS file drag of a folder tab fires no dragend here; its guide must still be released.
  window.addEventListener(FILE_DRAG_END, () => {
    if (fileGuide && !transferId && !sharedDragId) reset();
  });
  const acceptTarget = (event: DragEvent) => {
    if (!supported(event)) return;
    if (overFolder(event)) { clearTarget(); options.shell.classList.remove('is-tab-dragging'); return; }
    leftWindow = false;
    const destination = target(event);
    if (sharedDragId ?? transferId) options.desktop.updateTabDragTarget((sharedDragId ?? transferId)!, !!destination, true);
    const internalTab = !!transferId || Array.from(event.dataTransfer?.types ?? []).includes(MIME);
    if (!destination && !detachTarget && !internalTab) return;
    // Keep the native tab transport alive while crossing non-drop chrome.
    // X11 can retain a rejected dragover result even after the next valid
    // dragenter, reporting "none" on a quick release. Placement still comes
    // only from the guide; dropping on chrome cancels without moving a tab.
    event.preventDefault();
    // An OS file drag offers copy and link only; "move" would refuse the drop.
    if (event.dataTransfer) event.dataTransfer.dropEffect = ownFiles(event) || (copying(event) && options.copy) ? 'copy' : 'move';
    if (!destination && !detachTarget) return;
    // A native Markdown view otherwise intercepts the next dragover/drop. Main
    // cannot hide one while it runs a folder tab's OS drag, so those files
    // skip the capture: over a native view they are an ordinary file drop.
    if (ownFiles(event)) fileGuide = true; else setDragging(true);
    options.shell.classList.add('is-tab-dragging');
    if (activeStrip) {
      scrollList = tabScroller(activeStrip); scrollPointer = event.clientX;
      if (!scrollFrame) scrollFrame = requestAnimationFrame(scrollStrip);
    }
  };
  // A fast release after crossing a tab/group boundary can follow dragenter
  // without another dragover. Publish the new guide on entry as well, so the
  // previously hovered source strip cannot retain ownership of that release.
  window.addEventListener('dragenter', acceptTarget, true);
  window.addEventListener('dragover', acceptTarget, true);
  window.addEventListener('drop', event => {
    if (!supported(event)) return;
    if (overFolder(event)) { reset(); return; }
    // A fast native release can arrive before its final dragover. Real drop
    // coordinates supersede a previous center hover; coordinate-less Chromium
    // completions still use the placement that was actually painted.
    const destination = event.clientX !== 0 || event.clientY !== 0
      ? target(event) : guidedTarget ?? (detachTarget ? null : target(event));
    if (!destination) {
      const detach = !localOnly && !canceled && detachTarget ? transferId : null;
      const point = detachTarget;
      if (detach) { event.preventDefault(); event.stopPropagation(); }
      const pending = transferId;
      reset();
      if (detach && point) options.desktop.detachTabToWindow(detach, point.x, point.y, true);
      else if (pending) options.desktop.cancelTabTransfer(pending);
      return;
    }
    event.preventDefault(); event.stopPropagation();
    const localId = tabId;
    const incoming = event.dataTransfer?.getData(MIME);
    const dropped = ownFiles(event) ? [...event.dataTransfer?.files ?? []].map(file => options.desktop.pathForFile(file)) : [];
    const paths = dropped.length ? (fileDrag.dropped(dropped) ? dropped.filter(path => fileDrag.documents.includes(path)) : [])
      : draggedPaths(event.dataTransfer, PROJECT_FILES, FILE);
    reset();
    if (localId) {
      if (incoming) options.desktop.cancelTabTransfer(incoming);
      move(localId, destination, copying(event));
    } else if (incoming) {
      installIncoming(incoming, destination);
    } else if (paths.length) {
      void (async () => {
        let placement = destination;
        for (const path of paths) {
          await options.openFile(path, placement);
          // Only the first file creates a split. Subsequent files follow it in
          // selection order and remain pinned in that same destination group.
          const group = options.groups.focused;
          const index = group.activeId ? group.tabs.indexOf(group.activeId) + 1 : group.tabs.length;
          placement = { groupId: group.id, direction: null, index };
        }
      })().catch(error => console.error('Could not open dropped files', error));
    }
  }, true);
  window.addEventListener('dragleave', event => {
    if (!event.relatedTarget) {
      // A native surface entry has its own dragenter/dragover. Clear the old
      // receiver now; screen coordinates cannot disambiguate this on Wayland.
      leave(event);
      // Native child surfaces can emit this while the pointer is still inside
      // the window. A source drag owns its capture until drop/end/cancel;
      // restoring native views here makes them consume the split drop.
      if (!sourceDrag && !sharedDragId) { setDragging(false); options.shell.classList.remove('is-tab-dragging'); }
    }
  });

  /** Why a tab cannot leave its window right now, or null. */
  const held = (id: string): string | null => {
    const image = imageSessions.get(id);
    if (image && (image.history.dirty || image.busy)) return 'Save your image changes before moving this tab to another group or window.';
    // Unsaved Word and presentation edits live in this window's engine and cannot follow the tab to another one.
    const office = officeEditSession(id);
    return office && (office.edits !== office.savedEdits || office.busy) ? 'Save your document changes before moving this tab to another group or window.' : null;
  };
  const controller = {
    /** The tab menu's "Move into New Window": the same transfer as a tear-off, without a drag. */
    moveToWindow(id: string) {
      const tab = options.tabs.find(tab => tab.id === id);
      if (!tab) return;
      const reason = held(id);
      if (reason) { window.alert(reason); return; }
      if (options.groups.pin(id)) options.render();
      options.desktop.moveTabToWindow(crypto.randomUUID(), options.serialize(tab));
    },
    start(id: string, event: DragEvent) {
      const tab = options.tabs.find(tab => tab.id === id);
      if (!tab) return;
      const reason = held(id);
      if (reason) { event.preventDefault(); window.alert(reason); return; }
      if (options.groups.pin(id)) options.render();
      // Do not change selection until the drop succeeds.
      localOnly = tab.kind === 'diff';
      tabId = id; transferId = crypto.randomUUID(); canceled = false; leftWindow = false; sourceDrag = true;
      view.draggedTabId = id;
      options.shell.classList.add('is-tab-dragging'); setDragging(true);
      event.dataTransfer?.setData(MIME, transferId);
      holdWindowButtonRoom();
      options.desktop.setNativeTabDrag(transferId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = options.copy ? 'copyMove' : 'move';
      if (!localOnly) options.desktop.registerTabTransfer(transferId, options.serialize(tab));
    },
    end(event: DragEvent) {
      const id = transferId;
      if (!id) return;
      if (localOnly) {
        const local = tabId, destination = guidedTarget ?? retainedTarget;
        const accepted = !canceled && ['move', 'copy'].includes(event.dataTransfer?.dropEffect ?? 'none');
        reset();
        if (local && destination && accepted) move(local, destination, copying(event));
        return;
      }
      // Keep the painted guide until main arbitrates the actual OS receiver.
      // Global window coordinates cannot identify a destination on Wayland.
      // A forwarded native drop may arrive after source dragend; commit once.
      if (canceled) { reset(); options.desktop.cancelTabTransfer(id); return; }
      const insideSource = !!detachTarget && !leftWindow;
      const position = insideSource ? detachTarget! : { x: event.screenX, y: event.screenY };
      options.desktop.detachTabToWindow(id, position.x, position.y,
        insideSource, event.dataTransfer?.dropEffect, { x: event.clientX, y: event.clientY });
    },
    cancel() { canceled = true; clearTarget(); setDragging(false); options.shell.classList.remove('is-tab-dragging'); }, reset,
  };
  return controller;
}
