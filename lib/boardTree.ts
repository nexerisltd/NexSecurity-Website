// Shared helpers for turning the flat `boards` table (self-referencing via
// parent_id) into an ordered hierarchy: Top-Level boards first, each
// followed immediately by its descendants, depth-first. Depth is
// unbounded — a board can be nested under a custom sub-board just as
// easily as directly under a top-level one.

export type TreeBoard = {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order?: number;
  [key: string]: unknown;
};

export type BoardNode<T extends TreeBoard> = T & { depth: number; children: BoardNode<T>[] };

/**
 * Builds a nested tree from a flat board list. Boards whose parent_id
 * points at a board NOT in the list (shouldn't happen, but data can be
 * mid-migration or a parent could be filtered out upstream) are treated
 * as top-level so nothing silently disappears from the admin UI.
 */
export function buildBoardTree<T extends TreeBoard>(boards: T[]): BoardNode<T>[] {
  const byId = new Map(boards.map((b) => [b.id, b]));
  const childrenOf = new Map<string | null, T[]>();

  for (const b of boards) {
    const key = b.parent_id && byId.has(b.parent_id) ? b.parent_id : null;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(b);
  }

  for (const list of childrenOf.values()) {
    list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.title.localeCompare(b.title));
  }

  function attach(parentId: string | null, depth: number): BoardNode<T>[] {
    return (childrenOf.get(parentId) ?? []).map((b) => ({
      ...b,
      depth,
      children: attach(b.id, depth + 1),
    }));
  }

  return attach(null, 0);
}

/** Flattens a tree back into depth-first order (parent, then all its
 * descendants, then the next sibling) — the order every list/select in
 * the admin UI should render boards in so hierarchy reads top to bottom. */
export function flattenTree<T extends TreeBoard>(nodes: BoardNode<T>[]): BoardNode<T>[] {
  const out: BoardNode<T>[] = [];
  for (const n of nodes) {
    out.push(n);
    out.push(...flattenTree(n.children));
  }
  return out;
}

/** Depth-first ordered, flat list — the one function most call sites need. */
export function orderBoardsHierarchically<T extends TreeBoard>(boards: T[]): BoardNode<T>[] {
  return flattenTree(buildBoardTree(boards));
}

/**
 * Titles of every ancestor of `boardId`, root-first, NOT including the
 * board itself — e.g. for "Chapter 3" nested under "Physics" under
 * "Class 9" this returns ["Class 9", "Physics"]. Used to show a real
 * breadcrumb ("Class 9 › Physics › Chapter 3") instead of a bare
 * "depth 2" label, so which board sits under which is legible without
 * having to trace indentation by eye.
 */
export function ancestorTitles<T extends TreeBoard>(boards: T[], boardId: string): string[] {
  const byId = new Map(boards.map((b) => [b.id, b]));
  const titles: string[] = [];
  let current = byId.get(boardId);
  const seen = new Set<string>();
  while (current?.parent_id && byId.has(current.parent_id) && !seen.has(current.parent_id)) {
    seen.add(current.parent_id);
    const parent = byId.get(current.parent_id)!;
    titles.unshift(parent.title);
    current = parent;
  }
  return titles;
}

/**
 * Ids of every ancestor of `boardId`, root-first, NOT including the
 * board itself — same walk as ancestorTitles above, but returns ids
 * instead of titles. Used to reconstruct which option was picked at
 * each level of a cascading (top-level → sub-board → ...) selector from
 * just the final board id a video/record actually stores.
 */
export function ancestorIds<T extends TreeBoard>(boards: T[], boardId: string): string[] {
  const byId = new Map(boards.map((b) => [b.id, b]));
  const ids: string[] = [];
  let current = byId.get(boardId);
  const seen = new Set<string>();
  while (current?.parent_id && byId.has(current.parent_id) && !seen.has(current.parent_id)) {
    seen.add(current.parent_id);
    ids.unshift(current.parent_id);
    current = byId.get(current.parent_id);
  }
  return ids;
}

/** Every id that has at least one child — used to decide which rows get
 * an expand/collapse toggle. */
export function idsWithChildren<T extends TreeBoard>(boards: T[]): Set<string> {
  const ids = new Set<string>();
  for (const b of boards) {
    if (b.parent_id) ids.add(b.parent_id);
  }
  return ids;
}

/**
 * Every id in `excludeId`'s own subtree (including itself) — used to keep
 * a board from being reparented under one of its own descendants, which
 * would silently break the tree (a cycle Postgres won't catch for you).
 */
export function subtreeIds<T extends TreeBoard>(boards: T[], excludeId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const b of boards) {
    if (!b.parent_id) continue;
    if (!childrenOf.has(b.parent_id)) childrenOf.set(b.parent_id, []);
    childrenOf.get(b.parent_id)!.push(b.id);
  }
  const ids = new Set<string>([excludeId]);
  const stack = [excludeId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const childId of childrenOf.get(id) ?? []) {
      if (!ids.has(childId)) {
        ids.add(childId);
        stack.push(childId);
      }
    }
  }
  return ids;
}
