const express = require("express");
const { z } = require("zod");
const db = require("../db");
const { authMiddleware, requirePermission } = require("../auth");
const { fail } = require("../errors");

const router = express.Router();

const departmentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
});

router.use(authMiddleware);

// Every signed-in user needs the department list (forms, filters).
router.get("/departments", (req, res) => {
  const departments = db.prepare("SELECT * FROM departments ORDER BY name").all();
  res.json({ departments });
});

router.post("/departments", requirePermission("perm_manage_structure"), (req, res) => {
  const parsed = departmentSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 400, "department_invalid_input", "Укажите название отдела (до 100 символов)");
  try {
    const info = db
      .prepare("INSERT INTO departments (name, description) VALUES (?, ?)")
      .run(parsed.data.name, parsed.data.description || null);
    res.status(201).json({ department: db.prepare("SELECT * FROM departments WHERE id = ?").get(info.lastInsertRowid) });
  } catch (e) {
    return fail(res, 409, "department_exists", "Отдел с таким названием уже существует");
  }
});

router.put("/departments/:id", requirePermission("perm_manage_structure"), (req, res) => {
  const dep = db.prepare("SELECT * FROM departments WHERE id = ?").get(req.params.id);
  if (!dep) return fail(res, 404, "department_not_found", "Отдел не найден");
  const parsed = departmentSchema.partial().safeParse(req.body || {});
  if (!parsed.success) return fail(res, 400, "department_invalid_input", "Некорректные данные отдела");
  const { name, description } = parsed.data;
  try {
    db.prepare("UPDATE departments SET name = ?, description = ? WHERE id = ?").run(
      name ?? dep.name,
      description === undefined ? dep.description : description || null,
      dep.id
    );
  } catch (e) {
    return fail(res, 409, "department_exists", "Отдел с таким названием уже существует");
  }
  res.json({ department: db.prepare("SELECT * FROM departments WHERE id = ?").get(dep.id) });
});

// Deleting a department leaves its people in place, just without a department.
router.delete("/departments/:id", requirePermission("perm_manage_structure"), (req, res) => {
  const dep = db.prepare("SELECT * FROM departments WHERE id = ?").get(req.params.id);
  if (!dep) return fail(res, 404, "department_not_found", "Отдел не найден");
  db.prepare("DELETE FROM departments WHERE id = ?").run(dep.id);
  res.json({ ok: true });
});

module.exports = router;
