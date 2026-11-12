const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");

let api;
before(async () => { api = await h.startServer(); });
after(async () => { await api.close(); });
beforeEach(() => h.resetDb());

test("список отделов виден любому вошедшему, без токена — 401", async () => {
  h.createDepartment("Логистика");
  const u = h.createUser();
  assert.equal((await api.get("/structure/departments", h.tokenFor(u))).body.departments.length, 1);
  assert.equal((await api.get("/structure/departments")).status, 401);
});

test("создание, переименование, дубликат, удаление отдела", async () => {
  const a = h.createUser({ perm_manage_structure: 1 });
  const t = h.tokenFor(a);
  const c = await api.post("/structure/departments", t, { name: "  Склад  ", description: "Основной" });
  assert.equal(c.status, 201);
  assert.equal(c.body.department.name, "Склад");
  assert.equal((await api.post("/structure/departments", t, { name: "Склад" })).body.code, "department_exists");
  assert.equal((await api.post("/structure/departments", t, { name: "" })).body.code, "department_invalid_input");
  const other = (await api.post("/structure/departments", t, { name: "ОТК" })).body.department;
  assert.equal((await api.put(`/structure/departments/${other.id}`, t, { name: "Склад" })).body.code, "department_exists");
  const up = await api.put(`/structure/departments/${other.id}`, t, { name: "Качество" });
  assert.equal(up.body.department.name, "Качество");
  assert.equal((await api.put(`/structure/departments/${other.id}`, t, { description: null })).body.department.description, null);
  assert.equal((await api.put("/structure/departments/999", t, { name: "X" })).status, 404);
  assert.equal((await api.del(`/structure/departments/${other.id}`, t)).status, 200);
  assert.equal((await api.del(`/structure/departments/${other.id}`, t)).status, 404);
});

test("без права управления структурой — 403", async () => {
  const u = h.createUser({ perm_manage_users: 1 });
  const t = h.tokenFor(u);
  assert.equal((await api.post("/structure/departments", t, { name: "Х" })).status, 403);
  const d = h.createDepartment();
  assert.equal((await api.put(`/structure/departments/${d.id}`, t, { name: "Y" })).status, 403);
  assert.equal((await api.del(`/structure/departments/${d.id}`, t)).status, 403);
});

test("удаление отдела не удаляет людей, а лишь снимает отдел", async () => {
  const sa = h.createUser({ is_super_admin: 1 });
  const d = h.createDepartment();
  const u = h.createUser({ department_id: d.id });
  assert.equal((await api.del(`/structure/departments/${d.id}`, h.tokenFor(sa))).status, 200);
  assert.equal(h.getUser(u.id).department_id, null);
});
