const express = require("express");
const { z } = require("zod");
const db = require("../db");
const { authMiddleware, requirePermission } = require("../auth");
const { fail } = require("../errors");
const {
  PERMISSION_KEYS,
  hydrateUser,
  parseTabel,
  tabelTaken,
  canManageTarget,
  isLastActiveSuperAdmin,
} = require("../models");
const { generateCode, formatCode, hashCode, expiryFromNow } = require("../activation");

const router = express.Router();

const FORBIDDEN_TARGET = [403, "forbidden_target", "Нельзя изменять пользователя с более высокими правами, чем у вас"];

const createSchema = z.object({
  full_name: z.string().trim().min(2).max(128),
  department_id: z.number().int().nullable().optional(),
  post_title: z.string().trim().max(100).nullable().optional(),
});

/** Issues a fresh one-time code and returns it in plain text — the only time it is ever visible. */
function issueActivationCode(userId, { invalidatePassword }) {
  const code = generateCode();
  const expires = expiryFromNow();
  db.prepare(
    `UPDATE users SET activation_code_hash = ?, activation_expires_at = ?, activation_attempts = 0,
       ${invalidatePassword ? "password_hash = NULL, token_version = token_version + 1," : ""}
       updated_at = datetime('now') WHERE id = ?`
  ).run(hashCode(code), expires, userId);
  return { activation_code: formatCode(code), activation_expires_at: expires };
}

router.use(authMiddleware);

// Directory of colleagues for any signed-in user (names only): used to show who a master is, etc.
router.get("/directory", (req, res) => {
  const rows = db
    .prepare("SELECT id, tabel_number, full_name, post_title, department_id FROM users WHERE status = 'active' ORDER BY full_name")
    .all();
  res.json({ users: rows });
});

// --- Account managers (perm_manage_users) ---
router.get("/", requirePermission("perm_manage_users", "perm_manage_admins"), (req, res) => {
  const { status, department_id, q } = req.query;
  let sql = "SELECT * FROM users WHERE 1=1";
  const params = [];
  if (status === "active" || status === "disabled") {
    sql += " AND status = ?";
    params.push(status);
  } else if (status === "needs_activation") {
    sql += " AND password_hash IS NULL";
  }
  if (department_id) {
    sql += " AND department_id = ?";
    params.push(Number(department_id));
  }
  if (typeof q === "string" && q.trim()) {
    sql += " AND (full_name LIKE ? OR CAST(tabel_number AS TEXT) LIKE ?)";
    params.push(`%${q.trim()}%`, `${q.trim()}%`);
  }
  sql += " ORDER BY tabel_number ASC";
  res.json({ users: db.prepare(sql).all(...params).map(hydrateUser) });
});

router.post("/", requirePermission("perm_manage_users"), (req, res) => {
  const tabel = parseTabel(req.body?.tabel_number);
  if (tabel === null) return fail(res, 400, "tabel_invalid", "Табельный номер — целое число в допустимом диапазоне");
  const parsed = createSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 400, "user_invalid_input", "Укажите ФИО (от 2 символов)");
  const { full_name, department_id, post_title } = parsed.data;

  if (tabelTaken(tabel)) return fail(res, 409, "tabel_taken", "Этот табельный номер уже используется");
  if (department_id != null && !db.prepare("SELECT id FROM departments WHERE id = ?").get(department_id)) {
    return fail(res, 400, "department_not_found", "Отдел не найден");
  }

  const info = db
    .prepare("INSERT INTO users (tabel_number, full_name, department_id, post_title) VALUES (?, ?, ?, ?)")
    .run(tabel, full_name, department_id ?? null, post_title || "Мастер");
  const code = issueActivationCode(info.lastInsertRowid, { invalidatePassword: false });

  const user = hydrateUser(db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid));
  res.status(201).json({ user, ...code });
});

/**
 * In the body, `undefined` means "leave unchanged" and `null` means "clear".
 */
router.put("/:id", requirePermission("perm_manage_users"), (req, res) => {
  const me = req.currentUser;
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return fail(res, 404, "user_not_found", "Пользователь не найден");
  if (!canManageTarget(me, target)) return fail(res, ...FORBIDDEN_TARGET);

  const { full_name, department_id, post_title, status, tabel_number } = req.body || {};

  if (full_name !== undefined && (typeof full_name !== "string" || full_name.trim().length < 2 || full_name.length > 128)) {
    return fail(res, 400, "user_invalid_input", "ФИО должно содержать от 2 до 128 символов");
  }
  if (post_title !== undefined && post_title !== null && (typeof post_title !== "string" || post_title.length > 100)) {
    return fail(res, 400, "user_invalid_input", "Должность — не длиннее 100 символов");
  }

  if (status !== undefined) {
    if (status !== "active" && status !== "disabled") return fail(res, 400, "invalid_status", "Недопустимый статус");
    if (target.id === me.id && status !== target.status) {
      return fail(res, 400, "cannot_change_own_status", "Нельзя менять статус собственной учётной записи");
    }
    if (status !== "active" && isLastActiveSuperAdmin(target)) {
      return fail(res, 400, "last_super_admin", "Нельзя отключить последнего активного супер-администратора");
    }
  }

  let newTabel = target.tabel_number;
  if (tabel_number !== undefined) {
    const parsedTabel = parseTabel(tabel_number);
    if (parsedTabel === null) return fail(res, 400, "tabel_invalid", "Табельный номер — целое число в допустимом диапазоне");
    if (tabelTaken(parsedTabel, { exceptUserId: target.id })) {
      return fail(res, 409, "tabel_taken", "Этот табельный номер уже используется");
    }
    newTabel = parsedTabel;
  }

  let newDepartmentId = target.department_id;
  if (department_id !== undefined) {
    if (department_id === null) {
      newDepartmentId = null;
    } else {
      const dep = Number.isInteger(department_id) ? db.prepare("SELECT id FROM departments WHERE id = ?").get(department_id) : null;
      if (!dep) return fail(res, 400, "department_not_found", "Отдел не найден");
      newDepartmentId = dep.id;
    }
  }

  db.prepare(
    `UPDATE users SET tabel_number = ?, full_name = COALESCE(?, full_name), department_id = ?,
       post_title = ?, status = COALESCE(?, status), updated_at = datetime('now') WHERE id = ?`
  ).run(
    newTabel,
    full_name !== undefined ? full_name.trim() : null,
    newDepartmentId,
    post_title !== undefined ? post_title || null : target.post_title,
    status ?? null,
    target.id
  );

  // Disabling an account also ends its sessions immediately (auth re-reads status), nothing more to do.
  res.json({ user: hydrateUser(db.prepare("SELECT * FROM users WHERE id = ?").get(target.id)) });
});

// New one-time code: for a person who forgot their password, or whose first code expired.
// Resetting also invalidates the old password and every session straight away.
router.post("/:id/activation-code", requirePermission("perm_manage_users"), (req, res) => {
  const me = req.currentUser;
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return fail(res, 404, "user_not_found", "Пользователь не найден");
  if (!canManageTarget(me, target)) return fail(res, ...FORBIDDEN_TARGET);
  if (target.status === "disabled") return fail(res, 400, "account_disabled", "Учётная запись отключена");

  const code = issueActivationCode(target.id, { invalidatePassword: true });
  res.json({ user: hydrateUser(db.prepare("SELECT * FROM users WHERE id = ?").get(target.id)), ...code });
});

// --- Permission managers (perm_manage_admins): grant/revoke granular permissions & role title ---
router.put("/:id/permissions", requirePermission("perm_manage_admins"), (req, res) => {
  const me = req.currentUser;
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return fail(res, 404, "user_not_found", "Пользователь не найден");

  const body = req.body || {};
  const touchesSensitive = body.is_super_admin !== undefined || body.perm_manage_admins !== undefined;
  if (touchesSensitive && !me.is_super_admin) {
    return fail(res, 403, "super_admin_only_fields", "Право «Назначение прав» и статус супер-администратора может менять только супер-администратор");
  }
  if (!canManageTarget(me, target)) return fail(res, ...FORBIDDEN_TARGET);

  // You cannot hand out a permission you don't hold yourself.
  if (!me.is_super_admin) {
    for (const key of PERMISSION_KEYS) {
      if (body[key] && !me[key]) {
        return fail(res, 403, "cannot_grant_unheld", "Нельзя выдать право, которого нет у вас самих");
      }
    }
  }

  if (body.role_title !== undefined && body.role_title !== null && (typeof body.role_title !== "string" || body.role_title.length > 100)) {
    return fail(res, 400, "role_title_too_long", "Название роли — не длиннее 100 символов");
  }
  if (body.is_super_admin !== undefined && !body.is_super_admin && isLastActiveSuperAdmin(target)) {
    return fail(res, 400, "last_super_admin", "Нельзя снять статус с последнего активного супер-администратора");
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

  params.push(target.id);
  db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  res.json({ user: hydrateUser(db.prepare("SELECT * FROM users WHERE id = ?").get(target.id)) });
});

// An account that has submitted kaizens can never be deleted (the cards must stay): disable it instead.
router.delete("/:id", requirePermission("perm_manage_users"), (req, res) => {
  const me = req.currentUser;
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return fail(res, 404, "user_not_found", "Пользователь не найден");
  if (target.id === me.id) return fail(res, 400, "cannot_delete_self", "Нельзя удалить собственную учётную запись");
  if (!canManageTarget(me, target)) return fail(res, ...FORBIDDEN_TARGET);
  if (isLastActiveSuperAdmin(target)) {
    return fail(res, 400, "last_super_admin", "Нельзя удалить последнего активного супер-администратора");
  }
  const authored = db.prepare("SELECT COUNT(*) AS c FROM kaizens WHERE author_id = ?").get(target.id).c;
  if (authored > 0) {
    return fail(res, 409, "user_has_kaizens", "У пользователя есть кайдзены — удалить нельзя, отключите учётную запись");
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(target.id);
  res.json({ ok: true });
});

module.exports = router;
