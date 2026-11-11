const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const bcrypt = require("bcryptjs");

// The seed is a script, so run it for real in a child process against a throwaway database file.
describe("seed script", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kaizen-seed-"));
  const dbPath = path.join(dir, "seed.db");
  const run = () =>
    spawnSync(process.execPath, [path.join(__dirname, "..", "src", "seed.js")], {
      env: { ...process.env, DB_PATH: dbPath, SEED_ADMIN_LOGIN: "boss", SEED_ADMIN_PASSWORD: "bossPass123", NODE_ENV: "test" },
      encoding: "utf8",
    });

  test("creates one super admin and four departments with a Мастер -> Бригадир -> Оператор chain", () => {
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    const db = new DatabaseSync(dbPath);
    const admin = db.prepare("SELECT * FROM users WHERE login = 'boss'").get();
    assert.equal(admin.is_super_admin, 1);
    assert.equal(admin.status, "approved");
    assert.ok(bcrypt.compareSync("bossPass123", admin.password_hash));
    assert.equal(db.prepare("SELECT COUNT(*) c FROM departments").get().c, 4);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM positions").get().c, 12);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM positions WHERE parent_id IS NULL").get().c, 4);
    db.close();
  });

  test("running it again does not duplicate anything (regression: top-level positions used to double)", () => {
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    const db = new DatabaseSync(dbPath);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM users").get().c, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM departments").get().c, 4);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM positions").get().c, 12);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM positions WHERE parent_id IS NULL").get().c, 4);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
