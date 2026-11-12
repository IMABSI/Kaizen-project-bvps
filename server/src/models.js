const db = require("./db");
const config = require("./config");

const PERMISSION_KEYS = [
  "perm_manage_structure",
  "perm_manage_users",
  "perm_manage_admins",
  "perm_manage_kaizens",
  "perm_view_kaizens",
];

/** What the API may show about a user: never password or activation hashes. */
function publicUser(u) {
  if (!u) return null;
  const { password_hash, activation_code_hash, activation_attempts, token_version, ...rest } = u;
  return {
    ...rest,
    needs_activation: !password_hash,
    has_pending_activation_code: !!activation_code_hash,
  };
}

function hydrateUser(u) {
  if (!u) return u;
  const department = u.department_id ? db.prepare("SELECT * FROM departments WHERE id = ?").get(u.department_id) : null;
  return { ...publicUser(u), department };
}

/** Accepts 12, "12" or " 0012 "; returns an integer inside the allowed range, otherwise null. */
function parseTabel(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= config.TABEL_MIN && value <= config.TABEL_MAX ? value : null;
  }
  if (typeof value === "string" && /^\s*\d{1,6}\s*$/.test(value)) {
    const n = Number(value.trim());
    return n >= config.TABEL_MIN && n <= config.TABEL_MAX ? n : null;
  }
  return null;
}

/**
 * A tabel number belongs to exactly one person in the whole company: either an account holder (master and
 * above) or a team member (foreman, operator…). SQLite cannot enforce one UNIQUE across two tables, so we check.
 */
function tabelTaken(tabel, { exceptUserId = null, exceptMemberId = null } = {}) {
  const u = db.prepare("SELECT id FROM users WHERE tabel_number = ? AND id IS NOT ?").get(tabel, exceptUserId);
  if (u) return true;
  const m = db.prepare("SELECT id FROM team_members WHERE tabel_number = ? AND id IS NOT ?").get(tabel, exceptMemberId);
  return !!m;
}

/**
 * A non-super-admin may only act on a user who is not "above" them: not a super admin and not holding
 * any permission the actor lacks. Without this, a holder of the user-management permission could take over
 * a more privileged account and inherit everything it can do.
 */
function canManageTarget(actor, target) {
  if (actor.is_super_admin) return true;
  if (target.is_super_admin) return false;
  return PERMISSION_KEYS.every((key) => !target[key] || actor[key]);
}

function countActiveSuperAdmins() {
  return db.prepare("SELECT COUNT(*) AS c FROM users WHERE is_super_admin = 1 AND status = 'active'").get().c;
}

function isLastActiveSuperAdmin(target) {
  return !!target.is_super_admin && target.status === "active" && countActiveSuperAdmins() <= 1;
}

module.exports = {
  PERMISSION_KEYS,
  publicUser,
  hydrateUser,
  parseTabel,
  tabelTaken,
  canManageTarget,
  isLastActiveSuperAdmin,
};
