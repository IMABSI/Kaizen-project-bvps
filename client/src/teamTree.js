/** Turns a flat list of team members (with parent_id) into a forest of nodes with `children`. */
export function buildTree(members) {
  const byId = new Map(members.map((m) => [m.id, { ...m, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parent_id != null ? byId.get(node.parent_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Depth-first flat list with depth, for indented <select> options. */
export function flattenTree(roots, depth = 0, out = []) {
  for (const node of roots) {
    out.push({ member: node, depth });
    flattenTree(node.children, depth + 1, out);
  }
  return out;
}

/** ids of a node and everything below it (a member cannot be moved under any of these). */
export function subtreeIds(roots, id) {
  const find = (nodes) => {
    for (const n of nodes) {
      if (n.id === id) return n;
      const f = find(n.children);
      if (f) return f;
    }
    return null;
  };
  const start = find(roots);
  const ids = new Set();
  const walk = (n) => {
    ids.add(n.id);
    n.children.forEach(walk);
  };
  if (start) walk(start);
  return ids;
}
