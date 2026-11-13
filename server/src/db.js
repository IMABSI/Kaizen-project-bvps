const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

const IN_MEMORY = process.env.DB_PATH === ":memory:";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "kaizen.db");

if (!IN_MEMORY) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// Node's built-in SQLite (node:sqlite) — nothing native to compile on any platform.
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

/**
 * Versioned migrations. The schema version lives in SQLite's `PRAGMA user_version`; every migration
 * runs exactly once, in order, inside a transaction. To change the schema, APPEND a new entry — never
 * edit one that has already shipped.
 */
const MIGRATIONS = [
  {
    version: 1,
    description: "accounts by tabel number, departments, master teams, simple kaizens",
    up(d) {
      d.exec(`
        CREATE TABLE departments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Accounts exist only for masters and above. Login is the tabel number.
        -- password_hash NULL = the person has not set a password yet (must use an activation code).
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tabel_number INTEGER NOT NULL UNIQUE,
          full_name TEXT NOT NULL,
          department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
          post_title TEXT,
          password_hash TEXT,
          activation_code_hash TEXT,
          activation_expires_at TEXT,
          activation_attempts INTEGER NOT NULL DEFAULT 0,
          -- bumped on every password change/reset: all older login tokens stop working
          token_version INTEGER NOT NULL DEFAULT 0,
          is_super_admin INTEGER NOT NULL DEFAULT 0,
          role_title TEXT,
          perm_manage_structure INTEGER NOT NULL DEFAULT 0,  -- departments
          perm_manage_users INTEGER NOT NULL DEFAULT 0,      -- create accounts, activation codes, disable, delete
          perm_manage_admins INTEGER NOT NULL DEFAULT 0,     -- grant/revoke permissions
          perm_manage_kaizens INTEGER NOT NULL DEFAULT 0,    -- see all kaizens, set status, allow editing
          perm_view_kaizens INTEGER NOT NULL DEFAULT 0,      -- see all kaizens (read-only)
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
          language TEXT NOT NULL DEFAULT 'ru' CHECK (language IN ('ru','uz','en')),
          theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- A master's team as branches: foreman / operator / any custom post. These people have NO accounts;
        -- they work through their master. Their tabel number is unique across users AND team members
        -- (enforced in code, because SQLite cannot make a UNIQUE across two tables).
        CREATE TABLE team_members (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          parent_id INTEGER REFERENCES team_members(id) ON DELETE SET NULL,
          tabel_number INTEGER NOT NULL UNIQUE,
          full_name TEXT NOT NULL,
          post_title TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE kaizens (
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

        CREATE TABLE kaizen_status_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kaizen_id INTEGER NOT NULL REFERENCES kaizens(id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          comment TEXT,
          changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          changed_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_users_department ON users(department_id);
        CREATE INDEX idx_team_owner ON team_members(owner_user_id);
        CREATE INDEX idx_team_parent ON team_members(parent_id);
        CREATE INDEX idx_kaizens_author ON kaizens(author_id);
        CREATE INDEX idx_kaizens_dept ON kaizens(department_id);
      `);
    },
  },
  {
    version: 2,
    description: "kaizen card: rich fields, measurements, photos, settings",
    up(d) {
      // No real kaizens exist yet, so the simple stage-1 tables are replaced rather than converted.
      d.exec(`
        DROP TABLE IF EXISTS kaizen_status_history;
        DROP TABLE IF EXISTS kaizens;

        -- The kaizen number is the row id; AUTOINCREMENT guarantees a number is never reused,
        -- even after a card is deleted (deleted cards are only hidden: deleted_at).
        CREATE TABLE kaizens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          author_id INTEGER NOT NULL REFERENCES users(id),          -- the master who submitted it
          -- snapshots: a card keeps who/where it was written even if people or departments change later
          submitter_tabel INTEGER NOT NULL,
          submitter_name TEXT NOT NULL,
          submitter_post TEXT,
          department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
          department_name TEXT,
          operator_member_id INTEGER REFERENCES team_members(id) ON DELETE SET NULL,
          operator_tabel INTEGER NOT NULL,                          -- author of the idea (watermark)
          operator_name TEXT NOT NULL,
          operator_post TEXT,

          title TEXT NOT NULL,
          category TEXT NOT NULL,
          area TEXT,
          equipment TEXT,
          noticed_on TEXT,

          problem_text TEXT NOT NULL,
          before_text TEXT,
          after_text TEXT NOT NULL,
          benefits_text TEXT,
          conclusion_text TEXT,

          wastes TEXT NOT NULL DEFAULT '[]',
          effects TEXT NOT NULL DEFAULT '[]',

          impl_status TEXT NOT NULL DEFAULT 'idea' CHECK (impl_status IN ('idea','pilot','implemented')),
          implemented_on TEXT,
          effort TEXT CHECK (effort IN ('low','medium','high')),
          currency TEXT NOT NULL DEFAULT 'UZS',
          cost_amount REAL,
          saving_month_amount REAL,
          participants TEXT,

          status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','accepted','rejected')),
          admin_comment TEXT,
          edit_allowed_until TEXT,
          deleted_at TEXT,
          deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE kaizen_measures (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kaizen_id INTEGER NOT NULL REFERENCES kaizens(id) ON DELETE CASCADE,
          position INTEGER NOT NULL DEFAULT 0,
          name TEXT NOT NULL,
          unit TEXT,
          before_value REAL NOT NULL,
          after_value REAL NOT NULL,
          better TEXT NOT NULL DEFAULT 'lower' CHECK (better IN ('lower','higher'))
        );

        CREATE TABLE kaizen_photos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kaizen_id INTEGER NOT NULL REFERENCES kaizens(id) ON DELETE CASCADE,
          block TEXT NOT NULL CHECK (block IN ('problem','before','after','benefits','conclusion')),
          position INTEGER NOT NULL DEFAULT 0,
          caption TEXT,
          mime TEXT NOT NULL,
          size INTEGER NOT NULL,
          file_name TEXT NOT NULL UNIQUE,
          uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE kaizen_status_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kaizen_id INTEGER NOT NULL REFERENCES kaizens(id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          comment TEXT,
          changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          changed_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        INSERT INTO settings (key, value) VALUES ('kaizen_visibility', 'all');

        CREATE INDEX idx_kaizens_author ON kaizens(author_id);
        CREATE INDEX idx_kaizens_dept ON kaizens(department_id);
        CREATE INDEX idx_kaizens_operator ON kaizens(operator_tabel);
        CREATE INDEX idx_measures_kaizen ON kaizen_measures(kaizen_id);
        CREATE INDEX idx_photos_kaizen ON kaizen_photos(kaizen_id);
        CREATE INDEX idx_history_kaizen ON kaizen_status_history(kaizen_id);
      `);
    },
  },
];

function tableExists(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}

function schemaVersion() {
  return db.prepare("PRAGMA user_version").get().user_version;
}

/**
 * Databases created by the early prototype (login/password registration, position tree) have tables
 * but user_version 0. There is no real data in them, so we do NOT try to convert them: we copy the file
 * aside as a backup and start from the new schema.
 */
function retireLegacyDatabase() {
  if (schemaVersion() !== 0 || !tableExists("users")) return;

  if (!IN_MEMORY) {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = `${DB_PATH}.legacy-${stamp}.bak`;
    fs.copyFileSync(DB_PATH, backup);
    console.log(`База старого формата сохранена как резервная копия: ${backup}`);
  }

  db.exec("PRAGMA foreign_keys = OFF;");
  for (const t of ["kaizen_status_history", "kaizens", "users", "positions", "departments", "team_members", "settings", "kaizen_measures", "kaizen_photos"]) {
    db.exec(`DROP TABLE IF EXISTS ${t};`);
  }
  db.exec("PRAGMA foreign_keys = ON;");
}

function migrate() {
  retireLegacyDatabase();
  const current = schemaVersion();
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.exec("BEGIN");
    try {
      m.up(db);
      db.exec(`PRAGMA user_version = ${m.version};`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`Миграция ${m.version} (${m.description}) не выполнена: ${e.message}`);
    }
  }
}

migrate();

module.exports = db;
module.exports.schemaVersion = schemaVersion;
module.exports.LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
module.exports.IN_MEMORY = IN_MEMORY;
