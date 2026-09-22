// Flattens a nested position tree (as returned by the API, each node carrying a
// `children` array) into an ordered list with a `depth` field, so it can be rendered
// as an indented <select> or a nested <ul>.
export function flattenTree(nodes, depth = 0) {
  let out = [];
  for (const n of nodes || []) {
    out.push({ ...n, depth });
    if (n.children && n.children.length) {
      out = out.concat(flattenTree(n.children, depth + 1));
    }
  }
  return out;
}

export function indentLabel(node) {
  return `${"— ".repeat(node.depth)}${node.name}`;
}

// Builds a parent_id -> children[] tree from a flat list of positions (as returned by
// the admin /structure/positions endpoint, which has no `children` field).
export function buildTreeFromFlat(positions, departmentId, parentId = null) {
  return positions
    .filter((p) => p.department_id === departmentId && (p.parent_id ?? null) === parentId)
    .map((p) => ({ ...p, children: buildTreeFromFlat(positions, departmentId, p.id) }));
}
