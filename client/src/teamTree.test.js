import { describe, it, expect } from "vitest";
import { buildTree, flattenTree, subtreeIds } from "./teamTree";

const members = [
  { id: 1, parent_id: null, full_name: "A" },
  { id: 2, parent_id: 1, full_name: "B" },
  { id: 3, parent_id: 2, full_name: "C" },
  { id: 4, parent_id: 1, full_name: "D" },
  { id: 5, parent_id: null, full_name: "E" },
  { id: 6, parent_id: 99, full_name: "orphan" },
];

describe("teamTree", () => {
  it("строит лес; сироты становятся корнями", () => {
    const tree = buildTree(members);
    expect(tree.map((n) => n.id)).toEqual([1, 5, 6]);
    expect(tree[0].children.map((n) => n.id)).toEqual([2, 4]);
  });
  it("flattenTree даёт глубину", () => {
    const flat = flattenTree(buildTree(members)).map((x) => [x.member.id, x.depth]);
    expect(flat).toEqual([[1, 0], [2, 1], [3, 2], [4, 1], [5, 0], [6, 0]]);
  });
  it("subtreeIds содержит узел и потомков", () => {
    expect([...subtreeIds(buildTree(members), 2)].sort()).toEqual([2, 3]);
    expect(subtreeIds(buildTree(members), 42).size).toBe(0);
  });
  it("пустой список", () => expect(buildTree([])).toEqual([]));
});
