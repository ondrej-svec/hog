import { useCallback, useMemo, useReducer, useRef } from "react";

export type SectionId = string;

export interface NavItem {
  id: string;
  section: SectionId;
  type: "header" | "subHeader" | "item";
  subSection?: SectionId;
}

interface NavState {
  selectedId: string | null;
  /** Section of the currently selected item (used for fallback when item disappears) */
  selectedSection: SectionId | null;
  sections: SectionId[];
  collapsedSections: Set<SectionId>;
}

type NavAction =
  | { type: "SET_ITEMS"; items: NavItem[] }
  | { type: "SELECT"; id: string; section?: SectionId | undefined }
  | { type: "TOGGLE_SECTION"; section: SectionId }
  | { type: "COLLAPSE_ALL" };

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Find a fallback item when the selected item disappears from the list. */
export function findFallback(items: NavItem[], oldSection: SectionId | null): NavItem | undefined {
  if (oldSection) {
    // Prefer next item in same section (skip headers/subHeaders)
    const sectionItem = items.find((i) => i.section === oldSection && i.type === "item");
    if (sectionItem) return sectionItem;
    // Section header as last resort within section
    const sectionHeader = items.find((i) => i.section === oldSection && i.type === "header");
    if (sectionHeader) return sectionHeader;
  }
  // Fall back to first header globally
  return items.find((i) => i.type === "header") ?? items[0];
}

function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case "SET_ITEMS": {
      const sections = [...new Set(action.items.map((i) => i.section))];
      const isFirstLoad = state.sections.length === 0;
      // On first load: expand all sections except Activity (collapse it by default)
      // On refresh: preserve collapsed state
      const collapsedSections = isFirstLoad
        ? new Set(sections.filter((s) => s === "activity"))
        : state.collapsedSections;
      const selectionValid =
        state.selectedId != null && action.items.some((i) => i.id === state.selectedId);

      // Bail out if nothing meaningful changed (same sections, valid selection)
      if (!isFirstLoad && selectionValid && arraysEqual(sections, state.sections)) {
        return state;
      }

      if (selectionValid) {
        // Update selectedSection in case it wasn't set yet (e.g., first load)
        const selected = action.items.find((i) => i.id === state.selectedId);
        return {
          ...state,
          selectedSection: selected?.section ?? state.selectedSection,
          sections,
          collapsedSections,
        };
      }

      // Selected item disappeared — find best fallback
      const fallback = findFallback(action.items, state.selectedSection);
      return {
        selectedId: fallback?.id ?? null,
        selectedSection: fallback?.section ?? null,
        sections,
        collapsedSections,
      };
    }
    case "SELECT": {
      return {
        ...state,
        selectedId: action.id,
        selectedSection: action.section ?? state.selectedSection,
      };
    }
    case "TOGGLE_SECTION": {
      const next = new Set(state.collapsedSections);
      if (next.has(action.section)) {
        next.delete(action.section);
      } else {
        next.add(action.section);
      }
      return { ...state, collapsedSections: next };
    }
    case "COLLAPSE_ALL": {
      return { ...state, collapsedSections: new Set(state.sections) };
    }
    default:
      return state;
  }
}

/** Returns only items that should be navigable (headers + non-collapsed items). */
function getVisibleItems(allItems: NavItem[], collapsedSections: Set<SectionId>): NavItem[] {
  return allItems.filter((item) => {
    if (item.type === "header") return true;
    if (collapsedSections.has(item.section)) return false;
    if (item.type === "subHeader") return true;
    if (item.subSection && collapsedSections.has(item.subSection)) return false;
    return true;
  });
}

export interface UseNavigationResult {
  selectedId: string | null;
  selectedIndex: number;
  collapsedSections: Set<SectionId>;
  moveUp: () => void;
  moveDown: () => void;
  nextSection: () => void;
  prevSection: () => void;
  toggleSection: () => void;
  collapseAll: () => void;
  select: (id: string) => void;
  isCollapsed: (section: SectionId) => boolean;
}

export function useNavigation(allItems: NavItem[]): UseNavigationResult {
  const [state, dispatch] = useReducer(navReducer, {
    selectedId: null,
    selectedSection: null,
    sections: [],
    collapsedSections: new Set<SectionId>(),
  });

  // Sync items into reducer when they change (by reference comparison).
  // Dispatching during render is safe here: the ref prevents re-dispatch
  // on the subsequent re-render since allItems will be the same reference.
  const prevItemsRef = useRef<NavItem[] | null>(null);
  if (allItems !== prevItemsRef.current) {
    prevItemsRef.current = allItems;
    dispatch({ type: "SET_ITEMS", items: allItems });
  }

  const visibleItems = useMemo(
    () => getVisibleItems(allItems, state.collapsedSections),
    [allItems, state.collapsedSections],
  );

  const selectedIndex = useMemo(() => {
    if (!state.selectedId) return 0;
    const idx = visibleItems.findIndex((i) => i.id === state.selectedId);
    return idx >= 0 ? idx : 0;
  }, [state.selectedId, visibleItems]);

  const moveUp = useCallback(() => {
    const newIdx = Math.max(0, selectedIndex - 1);
    const item = visibleItems[newIdx];
    if (item) dispatch({ type: "SELECT", id: item.id, section: item.section });
  }, [selectedIndex, visibleItems]);

  const moveDown = useCallback(() => {
    const newIdx = Math.min(visibleItems.length - 1, selectedIndex + 1);
    const item = visibleItems[newIdx];
    if (item) dispatch({ type: "SELECT", id: item.id, section: item.section });
  }, [selectedIndex, visibleItems]);

  const nextSection = useCallback(() => {
    const currentItem = visibleItems[selectedIndex];
    if (!currentItem) return;
    const currentSectionIdx = state.sections.indexOf(currentItem.section);
    const nextSectionId = state.sections[currentSectionIdx + 1];
    if (!nextSectionId) return;
    const header = visibleItems.find((i) => i.section === nextSectionId && i.type === "header");
    if (header) dispatch({ type: "SELECT", id: header.id, section: header.section });
  }, [selectedIndex, visibleItems, state.sections]);

  const prevSection = useCallback(() => {
    const currentItem = visibleItems[selectedIndex];
    if (!currentItem) return;
    const currentSectionIdx = state.sections.indexOf(currentItem.section);
    const prevSectionId = state.sections[currentSectionIdx - 1];
    if (!prevSectionId) return;
    const header = visibleItems.find((i) => i.section === prevSectionId && i.type === "header");
    if (header) dispatch({ type: "SELECT", id: header.id, section: header.section });
  }, [selectedIndex, visibleItems, state.sections]);

  const toggleSection = useCallback(() => {
    const currentItem = visibleItems[selectedIndex];
    if (!currentItem) return;
    // Sub-headers toggle their own ID (used as sub-section key); headers toggle the section
    const key = currentItem.type === "subHeader" ? currentItem.id : currentItem.section;
    dispatch({ type: "TOGGLE_SECTION", section: key });
  }, [selectedIndex, visibleItems]);

  const collapseAll = useCallback(() => {
    dispatch({ type: "COLLAPSE_ALL" });
  }, []);

  const allItemsRef = useRef(allItems);
  allItemsRef.current = allItems;

  const select = useCallback((id: string) => {
    const item = allItemsRef.current.find((i) => i.id === id);
    dispatch({ type: "SELECT", id, section: item?.section });
  }, []);

  const isCollapsed = useCallback(
    (section: SectionId) => state.collapsedSections.has(section),
    [state.collapsedSections],
  );

  return {
    selectedId: state.selectedId,
    selectedIndex,
    collapsedSections: state.collapsedSections,
    moveUp,
    moveDown,
    nextSection,
    prevSection,
    toggleSection,
    collapseAll,
    select,
    isCollapsed,
  };
}
