const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "kaizen.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// Uses Node's built-in SQLite (node:sqlite, stable since Node 22+) instead of a native
// addon like better-sqlite3, so there is nothing to compile — no Visual Studio / build
// tools required on any platform (Windows, macOS, Linux).
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

const CURRENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Arbitrary-depth tree within a department: parent_id NULL = top-level node directly
-- under the department; otherwise the node is nested under another position/node.
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES positions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(department_id, parent_id, name)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL,
  -- Super admin: always has every permission, cannot be limited. Only another
  -- super admin can create/remove a super admin.
  is_super_admin INTEGER NOT NULL DEFAULT 0,
  -- Free-text label shown instead of a generic "admin" badge, e.g. "Модератор кайдзенов".
  role_title TEXT,
  -- Granular permissions, each independently grantable:
  perm_manage_structure INTEGER NOT NULL DEFAULT 0, -- departments & position tree
  perm_manage_users INTEGER NOT NULL DEFAULT 0,      -- reassign dept/position, disable, delete, reset password
  perm_manage_admins INTEGER NOT NULL DEFAULT 0,     -- grant/revoke the permissions above & role_title on others
  perm_approve_any INTEGER NOT NULL DEFAULT 0,       -- approve/reject any pending registration, bypassing hierarchy
  perm_manage_kaizens INTEGER NOT NULL DEFAULT 0,    -- view all kaizens & change their status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','disabled')),
  requested_approver_note TEXT,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kaizens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_review','accepted','rejected','implemented')),
  admin_comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kaizen_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kaizen_id INTEGER NOT NULL REFERENCES kaizens(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  comment TEXT,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_dept_pos ON users(department_id, position_id);
CREATE INDEX IF NOT EXISTS idx_positions_parent ON positions(parent_id);
CREATE INDEX IF NOT EXISTS idx_kaizens_author ON kaizens(author_id);
CREATE INDEX IF NOT EXISTS idx_kaizens_dept ON kaizens(department_id);
`;

function tableExists(name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
  return !!row;
}

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

/**
 * One-time, non-destructive migration for databases created by the earlier version of
 * this app (flat `level`-based positions, single `is_admin` flag). Rebuilds the schema
 * in place while preserving every row and every id (so foreign keys in users/kaizens
 * keep working untouched).
 */
function migrateLegacySchemaIfNeeded() {
  if (!tableExists("positions") || !tableExists("users")) return; // fresh install, nothing to migrate
  const needsPositionsMigration = !columnExists("positions", "parent_id");
  const needsUsersMigration = !columnExists("users", "is_super_admin");
  if (!needsPositionsMigration && !needsUsersMigration) return;

  console.log("Обнаружена база данных старого формата — выполняю миграцию схемы...");

  const departments = needsPositionsMigration ? db.prepare("SELECT * FROM departments").all() : [];
  const oldPositions = needsPositionsMigration ? db.prepare("SELECT * FROM positions ORDER BY department_id, level").all() : [];
  const users = db.prepare("SELECT * FROM users").all();

  db.exec("BEGIN");
  try {
    if (needsPositionsMigration) {
      db.exec("ALTER TABLE positions RENAME TO positions_legacy;");
      db.exec(`
        CREATE TABLE positions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
          parent_id INTEGER REFERENCES positions(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(department_id, parent_id, name)
        );
      `);
      const insertPos = db.prepare(
        "INSERT INTO positions (id, department_id, parent_id, name, created_at) VALUES (?, ?, ?, ?, ?)"
      );
      for (const dep of departments) {
        const chain = oldPositions.filter((p) => p.department_id === dep.id).sort((a, b) => a.level - b.level);
        let parentId = null;
        for (const p of chain) {
          insertPos.run(p.id, p.department_id, parentId, p.name, p.created_at);
          parentId = p.id;
        }
      }
      db.exec("DROP TABLE positions_legacy;");
      db.exec("CREATE INDEX IF NOT EXISTS idx_positions_parent ON positions(parent_id);");
    }

    if (needsUsersMigration) {
      db.exec("ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0;");
      db.exec("ALTER TABLE users ADD COLUMN role_title TEXT;");
      db.exec("ALTER TABLE users ADD COLUMN perm_manage_structure INTEGER NOT NULL DEFAULT 0;");
      db.exec("ALTER TABLE users ADD COLUMN perm_manage_users INTEGER NOT NULL DEFAULT 0;");
      db.exec("ALTER TABLE users ADD COLUMN perm_manage_admins INTEGER NOT NULL DEFAULT 0;");
      db.exec("ALTER TABLE users ADD COLUMN perm_approve_any INTEGER NOT NULL DEFAULT 0;");
      db.exec("ALTER TABLE users ADD COLUMN perm_manage_kaizens INTEGER NOT NULL DEFAULT 0;");

      const hadIsAdmin = columnExists("users", "is_admin");
      if (hadIsAdmin) {
        const promote = db.prepare(
          `UPDATE users SET is_super_admin = 1, role_title = COALESCE(role_title, 'Супер администратор') WHERE id = ?`
        );
        for (const u of users) {
          if (u.is_admin) promote.run(u.id);
        }
      }
    }

    db.exec("COMMIT");
    console.log("Миграция схемы успешно завершена.");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// Migrate any pre-existing legacy-format tables FIRST (it creates its own positions
// table with the new columns via ALTER/rebuild), then let CURRENT_SCHEMA fill in
// anything still missing (fresh installs, new indexes, etc.) — CREATE TABLE/INDEX
// IF NOT EXISTS makes this safe to run every time.
migrateLegacySchemaIfNeeded();
db.exec(CURRENT_SCHEMA);

module.exports = db;
