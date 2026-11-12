const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");

let api;
before(async () => { api = await h.startServer(); });
after(async () => { await api.close(); });
beforeEach(() => h.resetDb());

test("мастер строит своё дерево: бригадир → операторы", async () => {
  const m = h.createUser();
  const t = h.tokenFor(m);
  const foreman = await api.post("/team", t, { tabel_number: 1200, full_name: "Бригадир Один", post_title: "Бригадир" });
  assert.equal(foreman.status, 201);
  const op = await api.post("/team", t, { tabel_number: 1201, full_name: "Оператор Один", post_title: "Оператор", parent_id: foreman.body.member.id });
  assert.equal(op.body.member.parent_id, foreman.body.member.id);
  const list = await api.get("/team", t);
  assert.equal(list.body.members.length, 2);
  assert.equal(list.body.owner.id, m.id);
});

test("табельный уникален на всю компанию (пользователи и члены команд)", async () => {
  const m1 = h.createUser();
  const m2 = h.createUser();
  const t1 = h.tokenFor(m1);
  assert.equal((await api.post("/team", t1, { tabel_number: m2.tabel_number, full_name: "Дубль Дубль", post_title: "Оператор" })).body.code, "tabel_taken");
  const mem = h.createMember(m2);
  assert.equal((await api.post("/team", t1, { tabel_number: mem.tabel_number, full_name: "Дубль Дубль", post_title: "Оператор" })).status, 409);
  assert.equal((await api.post("/team", t1, { tabel_number: 0, full_name: "Дубль Дубль", post_title: "Оператор" })).body.code, "tabel_invalid");
  assert.equal((await api.post("/team", t1, { tabel_number: 2000, full_name: "D", post_title: "Оператор" })).body.code, "member_invalid_input");
});

test("чужая команда недоступна без прав; родитель только из своей команды", async () => {
  const m1 = h.createUser();
  const m2 = h.createUser();
  const foreign = h.createMember(m2);
  const t1 = h.tokenFor(m1);
  assert.equal((await api.get(`/team?owner_id=${m2.id}`, t1)).status, 403);
  assert.equal((await api.put(`/team/${foreign.id}`, t1, { full_name: "Чужой Чужой" })).status, 404);
  assert.equal((await api.del(`/team/${foreign.id}`, t1)).status, 404);
  assert.equal((await api.post("/team", t1, { tabel_number: 1300, full_name: "Имя Имя", post_title: "Оператор", parent_id: foreign.id })).body.code, "parent_not_found");
});

test("менеджер пользователей и супер-админ могут править чужую команду", async () => {
  const m = h.createUser();
  const mgr = h.createUser({ perm_manage_users: 1 });
  const r = await api.post("/team", h.tokenFor(mgr), { owner_id: m.id, tabel_number: 1400, full_name: "Имя Имя", post_title: "Оператор" });
  assert.equal(r.status, 201);
  assert.equal((await api.get("/team", h.tokenFor(m))).body.members.length, 1);
  assert.equal((await api.get("/team?owner_id=9999", h.tokenFor(mgr))).status, 404);
});

test("перемещение: циклы запрещены, перенос в корень разрешён", async () => {
  const m = h.createUser();
  const t = h.tokenFor(m);
  const a = h.createMember(m);
  const b = h.createMember(m, { parent_id: a.id });
  const c = h.createMember(m, { parent_id: b.id });
  assert.equal((await api.put(`/team/${a.id}`, t, { parent_id: c.id })).body.code, "parent_cycle");
  assert.equal((await api.put(`/team/${a.id}`, t, { parent_id: a.id })).body.code, "parent_cycle");
  assert.equal((await api.put(`/team/${c.id}`, t, { parent_id: null })).body.member.parent_id, null);
  assert.equal((await api.put(`/team/${c.id}`, t, { parent_id: a.id })).body.member.parent_id, a.id);
  assert.equal((await api.put(`/team/${c.id}`, t, { parent_id: 99999 })).body.code, "parent_not_found");
});

test("редактирование данных и табельного", async () => {
  const m = h.createUser();
  const t = h.tokenFor(m);
  const a = h.createMember(m);
  const b = h.createMember(m);
  assert.equal((await api.put(`/team/${a.id}`, t, { full_name: "Новое Имя", post_title: "Наладчик" })).body.member.post_title, "Наладчик");
  assert.equal((await api.put(`/team/${a.id}`, t, { tabel_number: b.tabel_number })).status, 409);
  assert.equal((await api.put(`/team/${a.id}`, t, { tabel_number: a.tabel_number })).status, 200);
  assert.equal((await api.put(`/team/${a.id}`, t, { tabel_number: "x" })).body.code, "tabel_invalid");
});

test("удаление: подчинённые поднимаются на уровень выше", async () => {
  const m = h.createUser();
  const t = h.tokenFor(m);
  const top = h.createMember(m);
  const mid = h.createMember(m, { parent_id: top.id });
  const low = h.createMember(m, { parent_id: mid.id });
  assert.equal((await api.del(`/team/${mid.id}`, t)).status, 200);
  const rows = (await api.get("/team", t)).body.members;
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.id === low.id).parent_id, top.id);
  assert.equal((await api.del(`/team/${top.id}`, t)).status, 200);
  assert.equal(h.db.prepare("SELECT parent_id FROM team_members WHERE id = ?").get(low.id).parent_id, null);
});
