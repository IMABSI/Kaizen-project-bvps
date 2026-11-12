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

const USER_STATUSES = ["pending", "approved", "rejected", "disabled"];

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

/**
 * A non-super-admin may only act on a user who is not "above" them: not a super admin and
 * not holding any permission the actor lacks. Without this, a holder of the user-management
 * permission could reset a more privileged user's password, log in as them and inherit
 * everything they can do.
 */
function canManageTarget(actor, target) {
  if (actor.is_super_admin) return true;
  if (target.is_super_admin) return false;
  return PERMISSION_KEYS.every((key) => !target[key] || actor[key]);
}

const FORBIDDEN_TARGET = { error: "Нельзя изменять пользователя с более высокими правами, чем у вас" };

function countActiveSuperAdmins() {
  return db.prepare("SELECT COUNT(*) AS c FROM users WHERE is_super_admin = 1 AND status = 'approved'").get().c;
}

function isLastActiveSuperAdmin(target) {
  return !!target.is_super_admin && target.status === "approved" && countActiveSuperAdmins() <= 1;
}

// Pending registrations the CURRENT user is allowed to approve (direct subordinate node
// in their department's position tree, or a super admin / perm_approve_any holder = everyone)
router.get("/pending-for-me", authMiddleware, (req, res) => {
  const me = req.currentUser;

  const pendingUsers = db.prepare("SELECT * FROM users WHERE status = 'pending'").all();
  const relevant = pendingUsers.filter((u) => {
    const position = u.position_id ? db.prepare("SELECT * FROM positions WHERE id = ?").get(u.position_id) : null;
    return isEligibleApprover(me, u.department_id, position);
  });
  res.json({ pending: relevant.map(hydrate) });
});

router.post("/:id/approve", authMiddleware, (req, res) => {
  const me = req.currentUser;
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
  const me = req.currentUser;
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });
  if (target.status !== "pending") return res.status(400).json({ error: "Заявка уже обработана" });

  const position = target.position_id ? db.prepare("SELECT * FROM positions WHERE id = ?").get(target.position_id) : null;
  if (!isEligibleApprover(me, target.department_id, position)) {
    return res.status(403).json({ error: "У вас нет прав отклонять эту заявку" });
  }

  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : null;
  db.prepare(
    "UPDATE users SET status = 'rejected', approved_by = ?, rejection_reason = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(me.id, reason || null, target.id);

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

/**
 * In the body, `undefined` means "leave unchanged" and `null` means "clear".
 * Changing the department without naming a position clears the position, because a position
 * only exists inside one department.
 */
router.put("/:id", authMiddleware, requirePermission("perm_manage_users"), (req, res) => {
  const me = req.currentUser;
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });
  if (!canManageTarget(me, target)) return res.status(403).json(FORBIDDEN_TARGET);

  const { full_name, department_id, position_id, status, rejection_reason } = req.body || {};

  if (full_name !== undefined && (typeof full_name !== "string" || full_name.trim().length < 2 || full_name.length > 128)) {
    return res.status(400).json({ error: "ФИО должно содержать от 2 до 128 символов" });
  }

  if (status !== undefined) {
    if (!USER_STATUSES.includes(status)) return res.status(400).json({ error: "Недопустимый статус" });
    if (target.id === me.id && status !== target.status) {
      return res.status(400).json({ error: "Нельзя менять статус собственной учётной записи" });
    }
    if (status !== "approved" && isLastActiveSuperAdmin(target)) {
      return res.status(400).json({ error: "Нельзя отключить последнего активного супер-администратора" });
    }
  }

  let newDepartmentId = target.department_id;
  if (department_id !== undefined) {
    if (department_id === null) {
      newDepartmentId = null;
    } else {
      const dep = Number.isInteger(department_id) ? db.prepare("SELECT id FROM departments WHERE id = ?").get(department_id) : null;
      if (!dep) return res.status(400).json({ error: "Отдел не найден" });
      newDepartmentId = dep.id;
    }
  }

  let newPositionId = target.position_id;
  if (position_id !== undefined) {
    newPositionId = position_id;
  } else if (newDepartmentId !== target.department_id) {
    newPositionId = null;
  }
  if (newPositionId !== null && newPositionId !== undefined) {
    const pos = Number.isInteger(newPositionId) ? db.prepare("SELECT * FROM positions WHERE id = ?").get(newPositionId) : null;
    if (!pos) return res.status(400).json({ error: "Должность не найдена" });
    if (pos.department_id !== newDepartmentId) {
      return res.status(400).json({ error: "Должность должна принадлежать выбранному отделу" });
    }
  } else {
    newPositionId = null;
  }

  db.prepare(
    `UPDATE users SET
      full_name = COALESCE(?, full_name),
      department_id = ?,
      position_id = ?,
      status = COALESCE(?, status),
      rejection_reason = COALESCE(?, rejection_reason),
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    full_name !== undefined ? full_name.trim() : null,
    newDepartmentId,
    newPositionId,
    status ?? null,
    typeof rejection_reason === "string" ? rejection_reason.slice(0, 500) : null,
    req.params.id
  );

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
      error: "Право «Назначение прав» и статус супер-администратора может менять только супер-администратор",
    });
  }
  if (!canManageTarget(me, target)) return res.status(403).json(FORBIDDEN_TARGET);

  // You cannot hand out a permission you don't hold yourself.
  if (!me.is_super_admin) {
    for (const key of PERMISSION_KEYS) {
      if (body[key] && !me[key]) {
        return res.status(403).json({ error: "Нельзя выдать право, которого нет у вас самих" });
      }
    }
  }

  if (body.role_title !== undefined && body.role_title !== null && (typeof body.role_title !== "string" || body.role_title.length > 100)) {
    return res.status(400).json({ error: "Название роли — не длиннее 100 символов" });
  }

  if (body.is_super_admin !== undefined && !body.is_super_admin && isLastActiveSuperAdmin(target)) {
    return res.status(400).json({ error: "Нельзя снять статус с последнего активного супер-администратора" });
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
  const me = req.currentUser;
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });
  if (!canManageTarget(me, target)) return res.status(403).json(FORBIDDEN_TARGET);

  const { new_password } = req.body || {};
  if (typeof new_password !== "string" || new_password.length < 6 || new_password.length > 128) {
    return res.status(400).json({ error: "Пароль должен содержать от 6 до 128 символов" });
  }
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hash, target.id);
  res.json({ ok: true });
});

router.delete("/:id", authMiddleware, requirePermission("perm_manage_users"), (req, res) => {
  const me = req.currentUser;
  if (Number(req.params.id) === me.id) {
    return res.status(400).json({ error: "Нельзя удалить собственную учётную запись" });
  }
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });
  if (!canManageTarget(me, target)) return res.status(403).json(FORBIDDEN_TARGET);
  if (isLastActiveSuperAdmin(target)) {
    return res.status(400).json({ error: "Нельзя удалить последнего активного супер-администратора" });
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(target.id);
  res.json({ ok: true });
});

module.exports = router;
