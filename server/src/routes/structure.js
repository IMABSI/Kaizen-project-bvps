const express = require("express");
const db = require("../db");
const { authMiddleware, requirePermission } = require("../auth");

const router = express.Router();

function buildTree(positions, parentId = null) {
  return positions
    .filter((p) => p.parent_id === parentId)
    .map((p) => ({ ...p, children: buildTree(positions, p.id) }));
}

function isDescendant(positions, candidateId, ofId) {
  // true if `candidateId` is `ofId` itself or a descendant of it
  if (candidateId === ofId) return true;
  const node = positions.find((p) => p.id === candidateId);
  if (!node || node.parent_id === null || node.parent_id === undefined) return false;
  return isDescendant(positions, node.parent_id, ofId);
}

// Public (used by the registration form) - departments with their full position tree
router.get("/public", (req, res) => {
  const departments = db.prepare("SELECT * FROM departments ORDER BY name").all();
  const positions = db.prepare("SELECT * FROM positions ORDER BY department_id, name").all();
  const byDept = departments.map((d) => ({
    ...d,
    positions: buildTree(
      positions.filter((p) => p.department_id === d.id),
      null
    ),
  }));
  res.json({ departments: byDept });
});

// --- Admin: departments CRUD ---
router.get("/departments", authMiddleware, requirePermission("perm_manage_structure"), (req, res) => {
  const departments = db.prepare("SELECT * FROM departments ORDER BY name").all();
  res.json({ departments });
});

router.post("/departments", authMiddleware, requirePermission("perm_manage_structure"), (req, res) => {
  const { name, description } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Укажите название отдела" });
  try {
    const info = db.prepare("INSERT INTO departments (name, description) VALUES (?, ?)").run(name.trim(), description || null);
    const dep = db.prepare("SELECT * FROM departments WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json({ department: dep });
  } catch (e) {
    res.status(409).json({ error: "Отдел с таким названием уже существует" });
  }
});

router.put("/departments/:id", authMiddleware, requirePermission("perm_manage_structure"), (req, res) => {
  const { name, description } = req.body || {};
  const dep = db.prepare("SELECT * FROM departments WHERE id = ?").get(req.params.id);
  if (!dep) return res.status(404).json({ error: "Отдел не найден" });
  db.prepare("UPDATE departments SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?").run(
    name || null,
    description ?? null,
    req.params.id
  );
  res.json({ department: db.prepare("SELECT * FROM departments WHERE id = ?").get(req.params.id) });
});

router.delete("/departments/:id", authMiddleware, requirePermission("perm_manage_structure"), (req, res) => {
  db.prepare("DELETE FROM departments WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// --- Admin: positions (tree nodes) CRUD ---
router.get("/positions", authMiddleware, requirePermission("perm_manage_structure"), (req, res) => {
  const positions = db.prepare("SELECT * FROM positions ORDER BY department_id, name").all();
  res.json({ positions });
});

router.post("/positions", authMiddleware, requirePermission("perm_manage_structure"), (req, res) => {
  const { department_id, name, parent_id } = req.body || {};
  if (!department_id || !name || !name.trim()) {
    return res.status(400).json({ error: "Укажите отдел и название должности/подпункта" });
  }

  let parentIdValue = null;
  if (parent_id !== undefined && parent_id !== null && parent_id !== "") {
    const parent = db.prepare("SELECT * FROM positions WHERE id = ?").get(parent_id);
    if (!parent || parent.department_id !== Number(department_id)) {
      return res.status(400).json({ error: "Родительский пункт должен быть в том же отделе" });
    }
    parentIdValue = parent.id;
  }

  try {
    const info = db
      .prepare("INSERT INTO positions (department_id, parent_id, name) VALUES (?, ?, ?)")
      .run(department_id, parentIdValue, name.trim());
    const pos = db.prepare("SELECT * FROM positions WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json({ position: pos });
  } catch (e) {
    res.status(409).json({ error: "Такое название уже используется на этом уровне" });
  }
});

router.put("/positions/:id", authMiddleware, requirePermission("perm_manage_structure"), (req, res) => {
  const { name, parent_id } = req.body || {};
  const pos = db.prepare("SELECT * FROM positions WHERE id = ?").get(req.params.id);
  if (!pos) return res.status(404).json({ error: "Пункт не найден" });

  let newParentId = pos.parent_id;
  if (parent_id !== undefined) {
    if (parent_id === null || parent_id === "") {
      newParentId = null;
    } else {
      const allInDept = db.prepare("SELECT * FROM positions WHERE department_id = ?").all(pos.department_id);
      const candidate = allInDept.find((p) => p.id === Number(parent_id));
      if (!candidate) return res.status(400).json({ error: "Родительский пункт должен быть в том же отделе" });
      if (isDescendant(allInDept, candidate.id, pos.id)) {
        return res.status(400).json({ error: "Нельзя переместить пункт внутрь самого себя или своего потомка" });
      }
      newParentId = candidate.id;
    }
  }

  try {
    db.prepare("UPDATE positions SET name = COALESCE(?, name), parent_id = ? WHERE id = ?").run(
      name || null,
      newParentId,
      req.params.id
    );
    res.json({ position: db.prepare("SELECT * FROM positions WHERE id = ?").get(req.params.id) });
  } catch (e) {
    res.status(409).json({ error: "Такое название уже используется на этом уровне" });
  }
});

router.delete("/positions/:id", authMiddleware, requirePermission("perm_manage_structure"), (req, res) => {
  db.prepare("DELETE FROM positions WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
