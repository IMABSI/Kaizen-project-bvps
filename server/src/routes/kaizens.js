const express = require("express");
const db = require("../db");
const { authMiddleware } = require("../auth");

const router = express.Router();

const STATUSES = ["new", "in_review", "accepted", "rejected", "implemented"];

function getCurrentUser(req) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
}

function canSeeAllKaizens(user) {
  return !!(user && (user.is_super_admin || user.perm_manage_kaizens));
}

function hydrateKaizen(k) {
  const author = db.prepare("SELECT id, full_name, login FROM users WHERE id = ?").get(k.author_id);
  const department = k.department_id ? db.prepare("SELECT * FROM departments WHERE id = ?").get(k.department_id) : null;
  const history = db
    .prepare("SELECT * FROM kaizen_status_history WHERE kaizen_id = ? ORDER BY changed_at ASC")
    .all(k.id);
  return { ...k, author, department, history };
}

router.use(authMiddleware);

// List: workers see their own; admins (or managers, per query) see all/department
router.get("/", (req, res) => {
  const me = getCurrentUser(req);
  if (!me || me.status !== "approved") return res.status(403).json({ error: "Недоступно" });

  let rows;
  if (canSeeAllKaizens(me)) {
    rows = db.prepare("SELECT * FROM kaizens ORDER BY created_at DESC").all();
  } else if (req.query.scope === "department" && me.department_id) {
    rows = db.prepare("SELECT * FROM kaizens WHERE department_id = ? ORDER BY created_at DESC").all(me.department_id);
  } else {
    rows = db.prepare("SELECT * FROM kaizens WHERE author_id = ? ORDER BY created_at DESC").all(me.id);
  }
  res.json({ kaizens: rows.map(hydrateKaizen) });
});

router.post("/", (req, res) => {
  const me = getCurrentUser(req);
  if (!me || me.status !== "approved") return res.status(403).json({ error: "Недоступно" });

  const { title, description, category } = req.body || {};
  if (!title || !title.trim() || !description || !description.trim()) {
    return res.status(400).json({ error: "Укажите название и описание предложения" });
  }

  const info = db
    .prepare(
      `INSERT INTO kaizens (author_id, department_id, title, description, category, status)
       VALUES (?, ?, ?, ?, ?, 'new')`
    )
    .run(me.id, me.department_id, title.trim(), description.trim(), category || null);

  db.prepare("INSERT INTO kaizen_status_history (kaizen_id, status, changed_by, comment) VALUES (?, 'new', ?, ?)").run(
    info.lastInsertRowid,
    me.id,
    "Предложение создано"
  );

  res.status(201).json({ kaizen: hydrateKaizen(db.prepare("SELECT * FROM kaizens WHERE id = ?").get(info.lastInsertRowid)) });
});

router.get("/:id", (req, res) => {
  const me = getCurrentUser(req);
  const kaizen = db.prepare("SELECT * FROM kaizens WHERE id = ?").get(req.params.id);
  if (!kaizen) return res.status(404).json({ error: "Не найдено" });
  if (!canSeeAllKaizens(me) && kaizen.author_id !== me.id && kaizen.department_id !== me.department_id) {
    return res.status(403).json({ error: "Нет доступа" });
  }
  res.json({ kaizen: hydrateKaizen(kaizen) });
});

// Requires perm_manage_kaizens (or super admin): change status / add comment
router.put("/:id/status", (req, res) => {
  const me = getCurrentUser(req);
  if (!me || me.status !== "approved" || !canSeeAllKaizens(me)) {
    return res.status(403).json({ error: "У вас нет прав изменять статус предложений" });
  }
  const { status, comment } = req.body || {};
  if (!STATUSES.includes(status)) return res.status(400).json({ error: "Недопустимый статус" });

  const kaizen = db.prepare("SELECT * FROM kaizens WHERE id = ?").get(req.params.id);
  if (!kaizen) return res.status(404).json({ error: "Не найдено" });

  db.prepare("UPDATE kaizens SET status = ?, admin_comment = COALESCE(?, admin_comment), updated_at = datetime('now') WHERE id = ?").run(
    status,
    comment ?? null,
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

router.delete("/:id", (req, res) => {
  const me = getCurrentUser(req);
  const kaizen = db.prepare("SELECT * FROM kaizens WHERE id = ?").get(req.params.id);
  if (!kaizen) return res.status(404).json({ error: "Не найдено" });
  if (!canSeeAllKaizens(me) && kaizen.author_id !== me.id) return res.status(403).json({ error: "Нет доступа" });
  db.prepare("DELETE FROM kaizens WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
