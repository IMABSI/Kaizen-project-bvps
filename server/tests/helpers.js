// Shared test helpers. Every test file runs in its own process (node --test), so each gets a fresh
// in-memory SQLite database; between tests we just empty the tables.
process.env.NODE_ENV = "test";
process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "test-secret-not-for-production";
process.env.UPLOAD_DIR = require("node:path").join(require("node:os").tmpdir(), `kaizen-test-uploads-${process.pid}`);

const http = require("node:http");
const bcrypt = require("bcryptjs");
const db = require("../src/db");
const { createApp } = require("../src/app");
const { signToken } = require("../src/auth");

const DEFAULT_PASSWORD = "secret1234";
const PASSWORD_HASH = bcrypt.hashSync(DEFAULT_PASSWORD, 4); // low cost: tests create many users

function resetDb() {
  db.exec(`
    DELETE FROM kaizen_status_history;
    DELETE FROM kaizen_photos;
    DELETE FROM kaizen_measures;
    DELETE FROM kaizens;
    UPDATE settings SET value = 'all' WHERE key = 'kaizen_visibility';
    DELETE FROM team_members;
    DELETE FROM users;
    DELETE FROM departments;
  `);
  tabelCounter = 100;
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
let tabelCounter = 100;

/** A fresh tabel number that is free in this test's database. */
function nextTabel() {
  return ++tabelCounter;
}

function createDepartment(name = `Dept ${++counter}`) {
  const info = db.prepare("INSERT INTO departments (name) VALUES (?)").run(name);
  return db.prepare("SELECT * FROM departments WHERE id = ?").get(info.lastInsertRowid);
}

/** Inserts a user straight into the DB. Default: active master with a password and no permissions. */
function createUser(overrides = {}) {
  const n = ++counter;
  const u = {
    tabel_number: nextTabel(),
    full_name: `User ${n}`,
    post_title: "Мастер",
    status: "active",
    password_hash: PASSWORD_HASH,
    is_super_admin: 0,
    perm_manage_structure: 0,
    perm_manage_users: 0,
    perm_manage_admins: 0,
    perm_manage_kaizens: 0,
    perm_view_kaizens: 0,
    department_id: null,
    ...overrides,
  };
  const info = db
    .prepare(
      `INSERT INTO users (tabel_number, full_name, post_title, department_id, password_hash, is_super_admin,
         perm_manage_structure, perm_manage_users, perm_manage_admins, perm_manage_kaizens, perm_view_kaizens, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      u.tabel_number,
      u.full_name,
      u.post_title,
      u.department_id,
      u.password_hash,
      u.is_super_admin,
      u.perm_manage_structure,
      u.perm_manage_users,
      u.perm_manage_admins,
      u.perm_manage_kaizens,
      u.perm_view_kaizens,
      u.status
    );
  return getUser(info.lastInsertRowid);
}

function createMember(owner, overrides = {}) {
  const m = { tabel_number: nextTabel(), full_name: `Member ${++counter}`, post_title: "Оператор", parent_id: null, ...overrides };
  const info = db
    .prepare("INSERT INTO team_members (owner_user_id, parent_id, tabel_number, full_name, post_title) VALUES (?, ?, ?, ?, ?)")
    .run(owner.id, m.parent_id, m.tabel_number, m.full_name, m.post_title);
  return db.prepare("SELECT * FROM team_members WHERE id = ?").get(info.lastInsertRowid);
}

function getUser(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function tokenFor(user) {
  return signToken(getUser(user.id) || user);
}

/** A valid kaizen request body; override any field. */
function kaizenBody(overrides = {}) {
  return {
    title: "Стеллаж для мелких деталей",
    category: "efficiency",
    problem_text: "Детали ищут по 10 минут",
    after_text: "Ввели разметку ячеек",
    ...overrides,
  };
}

/** Inserts a kaizen straight into the DB for `author` (operator = the author unless `operator` given). */
function createKaizen({ author, title = "Идея", status = "sent", operator, createdAt, department_id } = {}) {
  const op = operator || { id: null, tabel_number: author.tabel_number, full_name: author.full_name, post_title: author.post_title };
  const dept = department_id === undefined ? author.department_id : department_id;
  const info = db
    .prepare(
      `INSERT INTO kaizens (author_id, submitter_tabel, submitter_name, submitter_post, department_id,
         operator_member_id, operator_tabel, operator_name, operator_post, title, category, problem_text, after_text, status
         ${createdAt ? ", created_at" : ""})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'other', 'Проблема', 'Решение', ? ${createdAt ? ", ?" : ""})`
    )
    .run(
      ...[author.id, author.tabel_number, author.full_name, author.post_title, dept, op.id || null, op.tabel_number, op.full_name, op.post_title, title, status],
      ...(createdAt ? [createdAt] : [])
    );
  db.prepare("INSERT INTO kaizen_status_history (kaizen_id, status, changed_by) VALUES (?, ?, ?)").run(info.lastInsertRowid, status, author.id);
  return db.prepare("SELECT * FROM kaizens WHERE id = ?").get(info.lastInsertRowid);
}

module.exports = {
  db,
  DEFAULT_PASSWORD,
  resetDb,
  startServer,
  nextTabel,
  createDepartment,
  createUser,
  createMember,
  createKaizen,
  kaizenBody,
  getUser,
  tokenFor,
};
