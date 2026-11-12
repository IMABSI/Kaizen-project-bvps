const express = require("express");
const { z } = require("zod");
const db = require("../db");
const { authMiddleware } = require("../auth");

const router = express.Router();

const STATUSES = ["new", "in_review", "accepted", "rejected", "implemented"];

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  category: z.string().trim().max(100).optional().nullable(),
});

const statusSchema = z.object({
  status: z.enum(STATUSES),
  comment: z.string().trim().max(1000).optional().nullable(),
});

function canSeeAllKaizens(user) {
  return !!(user && (user.is_super_admin || user.perm_manage_kaizens));
}

// Same visibility rule everywhere (list by department scope, and single-item access):
// own kaizens, everything for managers, or the same department when the user has one.
function canViewKaizen(user, kaizen) {
  if (canSeeAllKaizens(user)) return true;
  if (kaizen.author_id === user.id) return true;
  return kaizen.department_id !== null && kaizen.department_id !== undefined && kaizen.department_id === user.department_id;
}

function hydrateKaizen(k) {
  const author = db.prepare("SELECT id, full_name, tabel_number FROM users WHERE id = ?").get(k.author_id);
  const department = k.department_id ? db.prepare("SELECT * FROM departments WHERE id = ?").get(k.department_id) : null;
  const history = db
    .prepare("SELECT * FROM kaizen_status_history WHERE kaizen_id = ? ORDER BY changed_at ASC, id ASC")
    .all(k.id);
  return { ...k, author, department, history };
}

// authMiddleware guarantees req.currentUser is an existing, approved user.
router.use(authMiddleware);

// List: workers see their own; managers see all; ?scope=department shows the user's department
router.get("/", (req, res) => {
  const me = req.currentUser;

  let rows;
  if (canSeeAllKaizens(me)) {
    rows = db.prepare("SELECT * FROM kaizens ORDER BY created_at DESC, id DESC").all();
  } else if (req.query.scope === "department" && me.department_id) {
    rows = db
      .prepare("SELECT * FROM kaizens WHERE department_id = ? ORDER BY created_at DESC, id DESC")
      .all(me.department_id);
  } else {
    rows = db.prepare("SELECT * FROM kaizens WHERE author_id = ? ORDER BY created_at DESC, id DESC").all(me.id);
  }
  res.json({ kaizens: rows.map(hydrateKaizen) });
});

router.post("/", (req, res) => {
  const me = req.currentUser;

  const parsed = createSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Укажите название (до 200 символов) и описание (до 5000 символов) предложения" });
  }
  const { title, description, category } = parsed.data;

  const info = db
    .prepare(
      `INSERT INTO kaizens (author_id, department_id, title, description, category, status)
       VALUES (?, ?, ?, ?, ?, 'new')`
    )
    .run(me.id, me.department_id, title, description, category || null);

  db.prepare("INSERT INTO kaizen_status_history (kaizen_id, status, changed_by, comment) VALUES (?, 'new', ?, ?)").run(
    info.lastInsertRowid,
    me.id,
    "Предложение создано"
  );

  res.status(201).json({ kaizen: hydrateKaizen(db.prepare("SELECT * FROM kaizens WHERE id = ?").get(info.lastInsertRowid)) });
});

router.get("/:id", (req, res) => {
  const me = req.currentUser;
  const kaizen = db.prepare("SELECT * FROM kaizens WHERE id = ?").get(req.params.id);
  if (!kaizen) return res.status(404).json({ error: "Не найдено" });
  if (!canViewKaizen(me, kaizen)) return res.status(403).json({ error: "Нет доступа" });
  res.json({ kaizen: hydrateKaizen(kaizen) });
});

// Requires perm_manage_kaizens (or super admin): change status / add comment
router.put("/:id/status", (req, res) => {
  const me = req.currentUser;
  if (!canSeeAllKaizens(me)) {
    return res.status(403).json({ error: "У вас нет прав изменять статус предложений" });
  }
  const parsed = statusSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "Недопустимый статус или слишком длинный комментарий" });
  const { status, comment } = parsed.data;

  const kaizen = db.prepare("SELECT * FROM kaizens WHERE id = ?").get(req.params.id);
  if (!kaizen) return res.status(404).json({ error: "Не найдено" });

  db.prepare("UPDATE kaizens SET status = ?, admin_comment = COALESCE(?, admin_comment), updated_at = datetime('now') WHERE id = ?").run(
    status,
    comment || null,
    req.params.id
  );
  db.prepare("INSERT INTO kaizen_status_history (kaizen_id, status, changed_by, comment) VALUES (?, ?, ?, ?)").run(
    req.params.id,
    status,
    me.id,
    comment || null
  );

  res.json({ kaizen: hydrateKaizen(db.prepare("SELECT * FROM kaizens WHERE id = ?").get(req.params.id)) });
});

// An author may withdraw only their own kaizen and only while it is still new: once it has been
// looked at (in review / accepted / rejected / implemented) it becomes part of the record.
router.delete("/:id", (req, res) => {
  const me = req.currentUser;
  const kaizen = db.prepare("SELECT * FROM kaizens WHERE id = ?").get(req.params.id);
  if (!kaizen) return res.status(404).json({ error: "Не найдено" });

  if (!canSeeAllKaizens(me)) {
    if (kaizen.author_id !== me.id) return res.status(403).json({ error: "Нет доступа" });
    if (kaizen.status !== "new") {
      return res.status(403).json({ error: "Предложение уже рассматривалось и не может быть удалено автором" });
    }
  }
  db.prepare("DELETE FROM kaizens WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
