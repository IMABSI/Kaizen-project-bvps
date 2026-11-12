const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const root = path.join(__dirname, "..");
function run(script, env) {
  return spawnSync(process.execPath, ["--no-warnings", script], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "test", JWT_SECRET: "x", ...env },
    encoding: "utf8",
  });
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "kaizen-"));

test("чистая БД получает последнюю версию схемы, повторное открытие ничего не ломает", () => {
  const dir = tmp();
  const file = path.join(dir, "a.db");
  const code = `const db=require("./src/db");console.log(db.schemaVersion, db.LATEST_VERSION)`;
  const a = spawnSync(process.execPath, ["--no-warnings", "-e", code], { cwd: root, env: { ...process.env, DB_PATH: file }, encoding: "utf8" });
  assert.equal(a.status, 0, a.stderr);
  const [v, latest] = a.stdout.trim().split(" ").map(Number);
  assert.equal(v, latest);
  const b = spawnSync(process.execPath, ["--no-warnings", "-e", code], { cwd: root, env: { ...process.env, DB_PATH: file }, encoding: "utf8" });
  assert.equal(b.stdout, a.stdout);
});

test("старая БД (до миграций) сохраняется в .bak и пересоздаётся", () => {
  const dir = tmp();
  const file = path.join(dir, "old.db");
  const old = new DatabaseSync(file);
  old.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, login TEXT); INSERT INTO users (login) VALUES ('legacy');");
  old.close();
  const r = spawnSync(process.execPath, ["--no-warnings", "-e", `const db=require("./src/db");console.log(db.schemaVersion)`], {
    cwd: root, env: { ...process.env, DB_PATH: file }, encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  const backups = fs.readdirSync(dir).filter((f) => f.includes(".legacy-") && f.endsWith(".bak"));
  assert.equal(backups.length, 1);
  const bak = new DatabaseSync(path.join(dir, backups[0]));
  assert.equal(bak.prepare("SELECT login FROM users").get().login, "legacy");
  bak.close();
  const fresh = new DatabaseSync(file);
  assert.ok(fresh.prepare("SELECT tabel_number FROM users LIMIT 1").all() !== undefined);
  fresh.close();
});

test("seed: создаёт супер-админа и отдел, повторный запуск идемпотентен", () => {
  const dir = tmp();
  const env = { DB_PATH: path.join(dir, "s.db"), SEED_ADMIN_TABEL: "7", SEED_ADMIN_PASSWORD: "seedpassword1" };
  assert.equal(run("src/seed.js", env).status, 0);
  assert.equal(run("src/seed.js", env).status, 0);
  const db = new DatabaseSync(env.DB_PATH);
  const users = db.prepare("SELECT tabel_number, is_super_admin, password_hash FROM users").all();
  assert.equal(users.length, 1);
  assert.equal(users[0].tabel_number, 7);
  assert.equal(users[0].is_super_admin, 1);
  assert.ok(users[0].password_hash && users[0].password_hash !== "seedpassword1");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM departments").get().c, 1);
  db.close();
});

test("seed: неверный табельный номер — ошибка", () => {
  const r = run("src/seed.js", { DB_PATH: path.join(tmp(), "e.db"), SEED_ADMIN_TABEL: "99999" });
  assert.notEqual(r.status, 0);
});
