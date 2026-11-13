const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const h = require("./helpers");

let dist, api, apiNoClient;
before(async () => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), "kaizen-dist-"));
  fs.mkdirSync(path.join(dist, "assets"));
  fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>Kaizen SPA</title>");
  fs.writeFileSync(path.join(dist, "assets", "app-abc123.js"), "console.log(1)");
  fs.writeFileSync(path.join(dist, "favicon.svg"), "<svg/>");
  fs.writeFileSync(path.join(os.tmpdir(), "kaizen-secret.txt"), "TOPSECRET");
  api = await h.startServer({ clientDist: dist });
  apiNoClient = await h.startServer({ clientDist: false });
});
after(async () => {
  await api.close();
  await apiNoClient.close();
});

const root = (a) => a.baseUrl.replace(/\/api$/, "");

test("главная страница и любые маршруты SPA отдают index.html", async () => {
  for (const p of ["/", "/login", "/kaizens/12", "/admin/users"]) {
    const r = await fetch(root(api) + p);
    assert.equal(r.status, 200, p);
    assert.match(await r.text(), /Kaizen SPA/);
    assert.match(r.headers.get("content-type"), /text\/html/);
  }
});

test("файлы из assets отдаются с долгим кешем, а отсутствующий asset — 404, а не index.html", async () => {
  const ok = await fetch(root(api) + "/assets/app-abc123.js");
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("cache-control"), /max-age=2592000/);
  assert.equal((await fetch(root(api) + "/assets/missing.js")).status, 404);
  assert.equal((await fetch(root(api) + "/favicon.svg")).status, 200);
});

test("API по-прежнему отвечает JSON, неизвестный /api/* — 404 JSON, а не страница", async () => {
  const health = await fetch(root(api) + "/api/health");
  assert.deepEqual(await health.json(), { ok: true });
  const nf = await fetch(root(api) + "/api/nothing");
  assert.equal(nf.status, 404);
  assert.equal((await nf.json()).code, "not_found");
  const nf2 = await fetch(root(api) + "/api");
  assert.equal(nf2.status, 404);
});

test("выход за пределы папки сайта невозможен", async () => {
  for (const p of ["/..%2fkaizen-secret.txt", "/%2e%2e/kaizen-secret.txt", "/assets/..%2f..%2fkaizen-secret.txt", "/../kaizen-secret.txt"]) {
    const r = await fetch(root(api) + p);
    const body = await r.text();
    assert.equal(body.includes("TOPSECRET"), false, p);
  }
});

test("CSP разрешает blob: для картинок (фото грузятся через API) и запрещает чужие скрипты", async () => {
  const r = await fetch(root(api) + "/");
  const csp = r.headers.get("content-security-policy");
  assert.match(csp, /img-src 'self' data: blob:/);
  assert.match(csp, /script-src 'self'/);
  assert.equal(csp.includes("upgrade-insecure-requests"), false);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});

test("без собранного сайта сервер работает как чистый API", async () => {
  const r = await fetch(root(apiNoClient) + "/login");
  assert.equal(r.status, 404);
});

test("резервная копия: база и фото, старые копии удаляются", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kaizen-bk-"));
  const dbFile = path.join(dir, "k.db");
  const uploads = path.join(dir, "up");
  fs.mkdirSync(uploads);
  fs.writeFileSync(path.join(uploads, "a.jpg"), "photo");
  const backups = path.join(dir, "backups");
  fs.mkdirSync(backups);
  for (const old of ["2020-01-01-00-00-00", "2020-01-02-00-00-00", "2020-01-03-00-00-00"]) fs.mkdirSync(path.join(backups, old));
  const env = { ...process.env, DB_PATH: dbFile, UPLOAD_DIR: uploads, BACKUP_DIR: backups, BACKUP_KEEP: "2", NODE_ENV: "test" };
  const r = spawnSync(process.execPath, ["--no-warnings", "src/backup.js"], { cwd: path.join(__dirname, ".."), env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const left = fs.readdirSync(backups).sort();
  assert.equal(left.length, 2);
  assert.equal(left.includes("2020-01-01-00-00-00"), false);
  const newest = path.join(backups, left[left.length - 1]);
  assert.equal(fs.readFileSync(path.join(newest, "uploads", "a.jpg"), "utf8"), "photo");
  const { DatabaseSync } = require("node:sqlite");
  const copy = new DatabaseSync(path.join(newest, "kaizen.db"));
  assert.ok(copy.prepare("SELECT COUNT(*) c FROM users").get().c >= 0);
  copy.close();
});

test("seed в продакшене без пароля — отказ", () => {
  const r = spawnSync(process.execPath, ["--no-warnings", "src/seed.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, NODE_ENV: "production", JWT_SECRET: "x".repeat(40), DB_PATH: path.join(os.tmpdir(), `seedprod-${process.pid}.db`), SEED_ADMIN_PASSWORD: "" },
    encoding: "utf8",
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /SEED_ADMIN_PASSWORD/);
});
