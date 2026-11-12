const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");

let api;
before(async () => { api = await h.startServer(); });
after(async () => { await api.close(); });
beforeEach(() => h.resetDb());

test("мастер создаёт кайдзен; автор содержит табельный номер", async () => {
  const u = h.createUser();
  const r = await api.post("/kaizens", h.tokenFor(u), { title: "Идея", description: "Описание" });
  assert.equal(r.status, 201);
  assert.equal(r.body.kaizen.author.tabel_number, u.tabel_number);
  assert.equal(r.body.kaizen.status, "new");
});

test("видимость: свои, отдел, всё для менеджера; чужое — 403", async () => {
  const d = h.createDepartment();
  const a = h.createUser({ department_id: d.id });
  const b = h.createUser({ department_id: d.id });
  const c = h.createUser();
  const k = h.createKaizen({ author: a });
  assert.equal((await api.get(`/kaizens/${k.id}`, h.tokenFor(b))).status, 200);
  assert.equal((await api.get(`/kaizens/${k.id}`, h.tokenFor(c))).status, 403);
  assert.equal((await api.get("/kaizens", h.tokenFor(c))).body.kaizens.length, 0);
  const m = h.createUser({ perm_manage_kaizens: 1 });
  assert.equal((await api.get("/kaizens", h.tokenFor(m))).body.kaizens.length, 1);
});

test("смена статуса только с правом; история пишется", async () => {
  const a = h.createUser();
  const k = h.createKaizen({ author: a });
  assert.equal((await api.put(`/kaizens/${k.id}/status`, h.tokenFor(a), { status: "accepted" })).status, 403);
  const m = h.createUser({ perm_manage_kaizens: 1 });
  const r = await api.put(`/kaizens/${k.id}/status`, h.tokenFor(m), { status: "accepted", comment: "ок" });
  assert.equal(r.body.kaizen.status, "accepted");
  assert.equal(r.body.kaizen.history.length, 2);
  assert.equal((await api.put(`/kaizens/${k.id}/status`, h.tokenFor(m), { status: "bogus" })).status, 400);
});

test("автор удаляет только новый кайдзен", async () => {
  const a = h.createUser();
  const k1 = h.createKaizen({ author: a });
  const k2 = h.createKaizen({ author: a, status: "accepted" });
  assert.equal((await api.del(`/kaizens/${k2.id}`, h.tokenFor(a))).status, 403);
  assert.equal((await api.del(`/kaizens/${k1.id}`, h.tokenFor(a))).status, 200);
});
