// Shared test helpers. Every test file runs in its own process (node --test), so each gets a fresh
// in-memory SQLite database; between tests we just empty the tables.
process.env.NODE_ENV = "test";
process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "test-secret-not-for-production";

const http = require("node:http");
const bcrypt = require("bcryptjs");
const db = require("../src/db");
const { createApp } = require("../src/app");
const { signToken } = require("../src/auth");

const DEFAULT_PASSWORD = "secret123";
const PASSWORD_HASH = bcrypt.hashSync(DEFAULT_PASSWORD, 4); // low cost: tests create many users

function resetDb() {
  db.exec(`
    DELETE FROM kaizen_status_history;
    DELETE FROM kaizens;
    DELETE FROM users;
    DELETE FROM positions;
    DELETE FROM departments;
  `);
}

async function startServer(options = {}) {
  const app = createApp(options);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  async function request(method, path, { token, body, rawBody } = {}) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: {
        ...(body !== undefined || rawBody !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* empty body */
    }
    return { status: res.status, body: data, headers: res.headers };
  }

  return {
    baseUrl,
    request,
    get: (path, token) => request("GET", path, { token }),
    post: (path, token, body) => request("POST", path, { token, body: body ?? {} }),
    put: (path, token, body) => request("PUT", path, { token, body: body ?? {} }),
    del: (path, token) => request("DELETE", path, { token }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

let counter = 0;

function createDepartment(name = `Dept ${++counter}`) {
  const info = db.prepare("INSERT INTO departments (name) VALUES (?)").run(name);
  return db.prepare("SELECT * FROM departments WHERE id = ?").get(info.lastInsertRowid);
}

function createPosition(departmentId, name = `Pos ${++counter}`, parentId = null) {
  const info = db.prepare("INSERT INTO positions (department_id, parent_id, name) VALUES (?, ?, ?)").run(departmentId, parentId, name);
  return db.prepare("SELECT * FROM positions WHERE id = ?").get(info.lastInsertRowid);
}

/** Inserts a user straight into the DB. Default: approved, no permissions. */
function createUser(overrides = {}) {
  const n = ++counter;
  const u = {
    login: `user${n}`,
    full_name: `User ${n}`,
    status: "approved",
    is_super_admin: 0,
    perm_manage_structure: 0,
    perm_manage_users: 0,
    perm_manage_admins: 0,
    perm_approve_any: 0,
    perm_manage_kaizens: 0,
    department_id: null,
    position_id: null,
    ...overrides,
  };
  const info = db
    .prepare(
      `INSERT INTO users (login, password_hash, full_name, department_id, position_id, is_super_admin,
         perm_manage_structure, perm_manage_users, perm_manage_admins, perm_approve_any, perm_manage_kaizens, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      u.login,
      PASSWORD_HASH,
      u.full_name,
      u.department_id,
      u.position_id,
      u.is_super_admin,
      u.perm_manage_structure,
      u.perm_manage_users,
      u.perm_manage_admins,
      u.perm_approve_any,
      u.perm_manage_kaizens,
      u.status
    );
  return getUser(info.lastInsertRowid);
}

function getUser(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function tokenFor(user) {
  return signToken(user);
}

function createKaizen({ author, title = "Идея", description = "Описание", status = "new", department_id } = {}) {
  const info = db
    .prepare("INSERT INTO kaizens (author_id, department_id, title, description, status) VALUES (?, ?, ?, ?, ?)")
    .run(author.id, department_id === undefined ? author.department_id : department_id, title, description, status);
  db.prepare("INSERT INTO kaizen_status_history (kaizen_id, status, changed_by, comment) VALUES (?, ?, ?, ?)").run(
    info.lastInsertRowid,
    status,
    author.id,
    "seed"
  );
  return db.prepare("SELECT * FROM kaizens WHERE id = ?").get(info.lastInsertRowid);
}

module.exports = {
  db,
  DEFAULT_PASSWORD,
  resetDb,
  startServer,
  createDepartment,
  createPosition,
  createUser,
  createKaizen,
  getUser,
  tokenFor,
};
