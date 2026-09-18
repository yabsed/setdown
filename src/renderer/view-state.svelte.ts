export type TabView = {
  id: string;
  name: string;
  path: string;
  active: boolean;
  dirty: boolean;
};

export const view = $state({
  tabs: [] as TabView[],
  draggedTabId: null as string | null,
});
