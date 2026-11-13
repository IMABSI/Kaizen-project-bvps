const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const h = require("./helpers");
const config = require("../src/config");

let api;
before(async () => { api = await h.startServer(); });
after(async () => {
  await api.close();
  fs.rmSync(config.UPLOAD_DIR, { recursive: true, force: true });
});
beforeEach(() => h.resetDb());

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50, 2)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(20, 3)]);

async function upload(user, kaizenId, { block = "problem", body = JPEG, type = "image/jpeg", caption } = {}) {
  const qs = `block=${block}${caption ? `&caption=${encodeURIComponent(caption)}` : ""}`;
  const res = await fetch(`${api.baseUrl}/kaizens/${kaizenId}/photos?${qs}`, {
    method: "POST",
    headers: { "Content-Type": type, Authorization: `Bearer ${h.tokenFor(user)}` },
    body,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}

async function setup() {
  const a = h.createUser();
  const k = (await api.post("/kaizens", h.tokenFor(a), h.kaizenBody())).body.kaizen;
  return { a, k };
}

test("загрузка JPEG/PNG/WebP, подпись, метаданные в карточке", async () => {
  const { a, k } = await setup();
  for (const [body, type] of [[JPEG, "image/jpeg"], [PNG, "image/png"], [WEBP, "image/webp"]]) {
    const r = await upload(a, k.id, { body, type, caption: "Вид сверху" });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.photo.mime, type);
    assert.equal(r.body.photo.caption, "Вид сверху");
  }
  const card = (await api.get(`/kaizens/${k.id}`, h.tokenFor(a))).body.kaizen;
  assert.equal(card.photos.length, 3);
  assert.deepEqual(card.photos.map((p) => p.position), [0, 1, 2]);
  assert.equal(JSON.stringify(card).includes("file_name"), false);
});

test("лимит 4 фото на блок, в другом блоке место есть", async () => {
  const { a, k } = await setup();
  for (let i = 0; i < 4; i++) assert.equal((await upload(a, k.id)).status, 201);
  const r = await upload(a, k.id);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "photo_limit_reached");
  assert.equal((await upload(a, k.id, { block: "after" })).status, 201);
});

test("подмена типа: заголовок image/jpeg, а внутри не картинка — отказ", async () => {
  const { a, k } = await setup();
  const r = await upload(a, k.id, { body: Buffer.from("<svg onload=alert(1)>"), type: "image/jpeg" });
  assert.equal(r.status, 415);
  assert.equal(r.body.code, "photo_type_invalid");
  assert.equal((await upload(a, k.id, { body: Buffer.from("<svg/>"), type: "image/svg+xml" })).status, 415);
  assert.equal((await upload(a, k.id, { body: Buffer.alloc(0) })).status, 415);
});

test("слишком большое фото и неверный блок", async () => {
  const { a, k } = await setup();
  const big = Buffer.concat([JPEG, Buffer.alloc(config.MAX_PHOTO_BYTES)]);
  const r = await upload(a, k.id, { body: big });
  assert.equal(r.status, 413);
  assert.equal((await upload(a, k.id, { block: "evil" })).body.code, "photo_block_invalid");
  assert.equal((await upload(a, k.id, { block: "../x" })).status, 400);
});

test("скачивание только по токену; чужой при restricted не видит; файл лежит под случайным именем", async () => {
  const { a, k } = await setup();
  const p = (await upload(a, k.id)).body.photo;
  const url = `${api.baseUrl}/kaizens/${k.id}/photos/${p.id}`;
  assert.equal((await fetch(url)).status, 401);
  const ok = await fetch(url, { headers: { Authorization: `Bearer ${h.tokenFor(a)}` } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/jpeg");
  assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), JPEG);
  const stored = h.db.prepare("SELECT file_name FROM kaizen_photos WHERE id = ?").get(p.id).file_name;
  assert.match(stored, /^[0-9a-f]{32}\.jpg$/);
  assert.ok(fs.existsSync(path.join(config.UPLOAD_DIR, stored)));

  const sa = h.createUser({ is_super_admin: 1 });
  await api.put("/settings", h.tokenFor(sa), { kaizen_visibility: "restricted" });
  const stranger = h.createUser();
  const denied = await fetch(url, { headers: { Authorization: `Bearer ${h.tokenFor(stranger)}` } });
  assert.equal(denied.status, 403);
  assert.equal((await api.get(`/kaizens/${k.id}/photos/99999`, h.tokenFor(a))).body.code, "photo_not_found");
  assert.equal((await api.get(`/kaizens/${k.id}/photos/abc`, h.tokenFor(a))).status, 404);
});

test("фото другого кайдзена не открывается через чужой id", async () => {
  const { a, k } = await setup();
  const k2 = (await api.post("/kaizens", h.tokenFor(a), h.kaizenBody())).body.kaizen;
  const p = (await upload(a, k.id)).body.photo;
  assert.equal((await api.get(`/kaizens/${k2.id}/photos/${p.id}`, h.tokenFor(a))).body.code, "photo_not_found");
});

test("удаление фото удаляет и файл; после окна правки загрузка и удаление закрыты", async () => {
  const { a, k } = await setup();
  const p = (await upload(a, k.id)).body.photo;
  const stored = h.db.prepare("SELECT file_name FROM kaizen_photos WHERE id = ?").get(p.id).file_name;
  assert.equal((await api.del(`/kaizens/${k.id}/photos/${p.id}`, h.tokenFor(h.createUser()))).status, 403);
  assert.equal((await api.del(`/kaizens/${k.id}/photos/${p.id}`, h.tokenFor(a))).status, 200);
  assert.equal(fs.existsSync(path.join(config.UPLOAD_DIR, stored)), false);

  const p2 = (await upload(a, k.id)).body.photo;
  h.db.prepare("UPDATE kaizens SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(k.id);
  const closed = await upload(a, k.id);
  assert.equal(closed.status, 403);
  assert.equal(closed.body.code, "edit_window_closed");
  assert.equal((await api.del(`/kaizens/${k.id}/photos/${p2.id}`, h.tokenFor(a))).status, 403);
  assert.equal((await upload(h.createUser({ perm_manage_kaizens: 1 }), k.id)).status, 201);
});

test("кайдзен с фото: фото удаляются вместе с карточкой только при физическом удалении строки, мягкое удаление их сохраняет", async () => {
  const { a, k } = await setup();
  await upload(a, k.id);
  await api.del(`/kaizens/${k.id}`, h.tokenFor(a));
  assert.equal(h.db.prepare("SELECT COUNT(*) c FROM kaizen_photos WHERE kaizen_id = ?").get(k.id).c, 1);
  assert.equal((await upload(a, k.id)).status, 404);
});
