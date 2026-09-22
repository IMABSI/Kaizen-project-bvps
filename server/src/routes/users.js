const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { authMiddleware, requirePermission } = require("../auth");
const { isEligibleApprover } = require("../hierarchy");

const router = express.Router();

const PERMISSION_KEYS = [
  "perm_manage_structure",
  "perm_manage_users",
  "perm_manage_admins",
  "perm_approve_any",
  "perm_manage_kaizens",
];

function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

function hydrate(u) {
  if (!u) return u;
  const department = u.department_id ? db.prepare("SELECT * FROM departments WHERE id = ?").get(u.department_id) : null;
  const position = u.position_id ? db.prepare("SELECT * FROM positions WHERE id = ?").get(u.position_id) : null;
  return { ...publicUser(u), department, position };
}

function getCurrentUser(req) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
}

// Pending registrations the CURRENT user is allowed to approve (direct subordinate node
// in their department's position tree, or a super admin / perm_approve_any holder = everyone)
router.get("/pending-for-me", authMiddleware, (req, res) => {
  const me = getCurrentUser(req);
  if (!me || me.status !== "approved") return res.status(403).json({ error: "Недоступно" });

  const pendingUsers = db.prepare("SELECT * FROM users WHERE status = 'pending'").all();
  const relevant = pendingUsers.filter((u) => {
    const position = u.position_id ? db.prepare("SELECT * FROM positions WHERE id = ?").get(u.position_id) : null;
    return isEligibleApprover(me, u.department_id, position);
  });
  res.json({ pending: relevant.map(hydrate) });
});

router.post("/:id/approve", authMiddleware, (req, res) => {
  const me = getCurrentUser(req);
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });
  if (target.status !== "pending") return res.status(400).json({ error: "Заявка уже обработана" });

  const position = target.position_id ? db.prepare("SELECT * FROM positions WHERE id = ?").get(target.position_id) : null;
  if (!isEligibleApprover(me, target.department_id, position)) {
    return res.status(403).json({ error: "У вас нет прав подтверждать эту заявку" });
  }

  db.prepare(
    "UPDATE users SET status = 'approved', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(me.id, target.id);

  res.json({ user: hydrate(db.prepare("SELECT * FROM users WHERE id = ?").get(target.id)) });
});

router.post("/:id/reject", authMiddleware, (req, res) => {
  const me = getCurrentUser(req);
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });
  if (target.status !== "pending") return res.status(400).json({ error: "Заявка уже обработана" });

  const position = target.position_id ? db.prepare("SELECT * FROM positions WHERE id = ?").get(target.position_id) : null;
  if (!isEligibleApprover(me, target.department_id, position)) {
    return res.status(403).json({ error: "У вас нет прав отклонять эту заявку" });
  }

  const reason = (req.body && req.body.reason) || null;
  db.prepare(
    "UPDATE users SET status = 'rejected', approved_by = ?, rejection_reason = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(me.id, reason, target.id);

  res.json({ ok: true });
});

// --- Managers with perm_manage_users: full user directory, reassignment, moderation ---
router.get("/", authMiddleware, requirePermission("perm_manage_users"), (req, res) => {
  const { status, department_id } = req.query;
  let sql = "SELECT * FROM users WHERE 1=1";
  const params = [];
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  if (department_id) {
    sql += " AND department_id = ?";
    params.push(department_id);
  }
  sql += " ORDER BY created_at DESC";
  const users = db.prepare(sql).all(...params);
  res.json({ users: users.map(hydrate) });
});

router.put("/:id", authMiddleware, requirePermission("perm_manage_users"), (req, res) => {
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });
  const { full_name, department_id, position_id, status, rejection_reason } = req.body || {};

  db.prepare(
    `UPDATE users SET
      full_name = COALESCE(?, full_name),
      department_id = COALESCE(?, department_id),
      position_id = COALESCE(?, position_id),
      status = COALESCE(?, status),
      rejection_reason = COALESCE(?, rejection_reason),
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(full_name ?? null, department_id ?? null, position_id ?? null, status ?? null, rejection_reason ?? null, req.params.id);

  res.json({ user: hydrate(db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id)) });
});

// --- Managers with perm_manage_admins: grant/revoke granular permissions & role title ---
router.put("/:id/permissions", authMiddleware, requirePermission("perm_manage_admins"), (req, res) => {
  const me = req.currentUser;
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });

  const body = req.body || {};
  const touchesSensitive = body.is_super_admin !== undefined || body.perm_manage_admins !== undefined;
  if (touchesSensitive && !me.is_super_admin) {
    return res.status(403).json({
      error: "Право «назначать администраторов» и статус супер-администратора может менять только супер-администратор",
    });
  }
  if (target.is_super_admin && !me.is_super_admin) {
    return res.status(403).json({ error: "Только супер-администратор может менять права другого супер-администратора" });
  }

  const sets = ["updated_at = datetime('now')"];
  const params = [];

  if (body.role_title !== undefined) {
    sets.push("role_title = ?");
    params.push(body.role_title || null);
  }
  for (const key of PERMISSION_KEYS) {
    if (body[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(body[key] ? 1 : 0);
    }
  }
  if (me.is_super_admin && body.is_super_admin !== undefined) {
    sets.push("is_super_admin = ?");
    params.push(body.is_super_admin ? 1 : 0);
  }

  params.push(req.params.id);
  db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  res.json({ user: hydrate(db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id)) });
});

router.post("/:id/reset-password", authMiddleware, requirePermission("perm_manage_users"), (req, res) => {
  const { new_password } = req.body || {};
  if (!new_password || new_password.length < 6) return res.status(400).json({ error: "Пароль должен быть не короче 6 символов" });
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hash, req.params.id);
  res.json({ ok: true });
});

router.delete("/:id", authMiddleware, requirePermission("perm_manage_users"), (req, res) => {
  const me = req.currentUser;
  if (Number(req.params.id) === me.id) {
    return res.status(400).json({ error: "Нельзя удалить собственную учётную запись" });
  }
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (target && target.is_super_admin && !me.is_super_admin) {
    return res.status(403).json({ error: "Только супер-администратор может удалить супер-администратора" });
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
