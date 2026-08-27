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
