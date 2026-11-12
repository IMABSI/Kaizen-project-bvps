const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");

let api;
before(async () => { api = await h.startServer(); });
after(async () => { await api.close(); });
beforeEach(() => h.resetDb());

const manager = (extra = {}) => h.createUser({ perm_manage_users: 1, ...extra });

test("создание мастера выдаёт одноразовый код и не раскрывает хэши", async () => {
  const dep = h.createDepartment("Логистика");
  const m = manager();
  const r = await api.post("/users", h.tokenFor(m), { tabel_number: 500, full_name: "Иван Петров", department_id: dep.id });
  assert.equal(r.status, 201);
  assert.match(r.body.activation_code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.ok(r.body.activation_expires_at);
  assert.equal(r.body.user.post_title, "Мастер");
  assert.equal(r.body.user.needs_activation, true);
  assert.equal(r.body.user.department.name, "Логистика");
  assert.equal(JSON.stringify(r.body).includes("hash"), false);
});

test("создание: валидация, дубликаты табельного (среди пользователей и членов команды)", async () => {
  const m = manager();
  const t = h.tokenFor(m);
  assert.equal((await api.post("/users", t, { full_name: "Имя Фамилия" })).body.code, "tabel_invalid");
  assert.equal((await api.post("/users", t, { tabel_number: 3001, full_name: "Имя Фамилия" })).body.code, "tabel_invalid");
  assert.equal((await api.post("/users", t, { tabel_number: 600, full_name: "A" })).body.code, "user_invalid_input");
  assert.equal((await api.post("/users", t, { tabel_number: 600, full_name: "Имя Фамилия", department_id: 999 })).body.code, "department_not_found");
  assert.equal((await api.post("/users", t, { tabel_number: m.tabel_number, full_name: "Имя Фамилия" })).status, 409);
  const member = h.createMember(m);
  const r = await api.post("/users", t, { tabel_number: member.tabel_number, full_name: "Имя Фамилия" });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "tabel_taken");
});

test("без права управления пользователями — 403; без токена — 401", async () => {
  const plain = h.createUser();
  assert.equal((await api.get("/users", h.tokenFor(plain))).status, 403);
  assert.equal((await api.post("/users", h.tokenFor(plain), { tabel_number: 700, full_name: "Имя Фамилия" })).status, 403);
  assert.equal((await api.get("/users")).status, 401);
});

test("справочник коллег доступен всем и не раскрывает лишнего", async () => {
  const a = h.createUser({ full_name: "Аня" });
  h.createUser({ status: "disabled", full_name: "Отключён" });
  const r = await api.get("/users/directory", h.tokenFor(a));
  assert.equal(r.status, 200);
  assert.equal(r.body.users.length, 1);
  assert.deepEqual(Object.keys(r.body.users[0]).sort(), ["department_id", "full_name", "id", "post_title", "tabel_number"]);
});

test("список: фильтры и поиск", async () => {
  const dep = h.createDepartment();
  const m = manager();
  const a = h.createUser({ full_name: "Алексей Иванов", department_id: dep.id });
  h.createUser({ full_name: "Борис Сидоров", password_hash: null });
  h.createUser({ full_name: "Виктор", status: "disabled" });
  const t = h.tokenFor(m);
  assert.equal((await api.get("/users?status=needs_activation", t)).body.users.length, 1);
  assert.equal((await api.get("/users?status=disabled", t)).body.users.length, 1);
  assert.equal((await api.get(`/users?department_id=${dep.id}`, t)).body.users.length, 1);
  assert.equal((await api.get("/users?q=Алексей", t)).body.users[0].id, a.id);
  assert.equal((await api.get(`/users?q=${a.tabel_number}`, t)).body.users[0].id, a.id);
});

test("редактирование: undefined — без изменений, null — очистка", async () => {
  const dep = h.createDepartment();
  const m = manager();
  const u = h.createUser({ department_id: dep.id, post_title: "Старший мастер" });
  const t = h.tokenFor(m);
  const r1 = await api.put(`/users/${u.id}`, t, { full_name: "Новое Имя" });
  assert.equal(r1.body.user.department_id, dep.id);
  assert.equal(r1.body.user.post_title, "Старший мастер");
  const r2 = await api.put(`/users/${u.id}`, t, { department_id: null });
  assert.equal(r2.body.user.department_id, null);
  assert.equal(r2.body.user.full_name, "Новое Имя");
  assert.equal((await api.put(`/users/${u.id}`, t, { full_name: "X" })).body.code, "user_invalid_input");
  assert.equal((await api.put(`/users/${u.id}`, t, { status: "weird" })).body.code, "invalid_status");
  assert.equal((await api.put(`/users/${u.id}`, t, { department_id: 12345 })).body.code, "department_not_found");
  assert.equal((await api.put(`/users/9999`, t, {})).status, 404);
});

test("смена табельного: диапазон и занятость", async () => {
  const m = manager();
  const u = h.createUser();
  const other = h.createUser();
  const t = h.tokenFor(m);
  assert.equal((await api.put(`/users/${u.id}`, t, { tabel_number: other.tabel_number })).status, 409);
  assert.equal((await api.put(`/users/${u.id}`, t, { tabel_number: 0 })).body.code, "tabel_invalid");
  assert.equal((await api.put(`/users/${u.id}`, t, { tabel_number: u.tabel_number })).status, 200);
  assert.equal((await api.put(`/users/${u.id}`, t, { tabel_number: 2500 })).body.user.tabel_number, 2500);
});

test("отключение пользователя мгновенно обрывает его сессию; себя отключить нельзя", async () => {
  const m = manager();
  const u = h.createUser();
  const ut = h.tokenFor(u);
  assert.equal((await api.put(`/users/${u.id}`, h.tokenFor(m), { status: "disabled" })).status, 200);
  assert.equal((await api.get("/auth/me", ut)).status, 401);
  assert.equal((await api.put(`/users/${m.id}`, h.tokenFor(m), { status: "disabled" })).body.code, "cannot_change_own_status");
});

test("менеджер не может трогать супер-админа или пользователя с большими правами", async () => {
  const m = manager();
  const sa = h.createUser({ is_super_admin: 1 });
  const strong = h.createUser({ perm_manage_kaizens: 1 });
  const t = h.tokenFor(m);
  for (const target of [sa, strong]) {
    assert.equal((await api.put(`/users/${target.id}`, t, { full_name: "Взлом Взлом" })).body.code, "forbidden_target");
    assert.equal((await api.post(`/users/${target.id}/activation-code`, t)).body.code, "forbidden_target");
    assert.equal((await api.del(`/users/${target.id}`, t)).body.code, "forbidden_target");
  }
  // а супер-админ — может
  assert.equal((await api.put(`/users/${strong.id}`, h.tokenFor(sa), { full_name: "Нормально Нормально" })).status, 200);
});

test("новый код сбрасывает пароль и все сессии; старый пароль не работает; активация возвращает доступ", async () => {
  const m = manager();
  const u = h.createUser();
  const ut = h.tokenFor(u);
  const r = await api.post(`/users/${u.id}/activation-code`, h.tokenFor(m));
  assert.equal(r.status, 200);
  assert.ok(r.body.activation_code);
  assert.equal(r.body.user.needs_activation, true);
  assert.equal((await api.get("/auth/me", ut)).status, 401);
  assert.equal((await api.post("/auth/login", null, { tabel_number: u.tabel_number, password: h.DEFAULT_PASSWORD })).body.code, "needs_activation");
  const act = await api.post("/auth/activate", null, { tabel_number: u.tabel_number, activation_code: r.body.activation_code, new_password: "brandnewpass1" });
  assert.equal(act.status, 200);
});

test("код для отключённого пользователя выдать нельзя", async () => {
  const m = manager();
  const u = h.createUser({ status: "disabled" });
  assert.equal((await api.post(`/users/${u.id}/activation-code`, h.tokenFor(m))).body.code, "account_disabled");
});

test("права: менеджер пользователей не может выдавать права; супер-админ может", async () => {
  const m = manager();
  const u = h.createUser();
  assert.equal((await api.put(`/users/${u.id}/permissions`, h.tokenFor(m), { perm_view_kaizens: 1 })).status, 403);
  const sa = h.createUser({ is_super_admin: 1 });
  const r = await api.put(`/users/${u.id}/permissions`, h.tokenFor(sa), { perm_view_kaizens: 1, role_title: "Куратор" });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.perm_view_kaizens, 1);
  assert.equal(r.body.user.role_title, "Куратор");
});

test("права: эскалация запрещена", async () => {
  const pm = h.createUser({ perm_manage_admins: 1, perm_manage_users: 1 });
  const t = h.tokenFor(pm);
  const u = h.createUser();
  // нельзя выдать то, чего нет у самого
  assert.equal((await api.put(`/users/${u.id}/permissions`, t, { perm_manage_kaizens: 1 })).body.code, "cannot_grant_unheld");
  // нельзя трогать perm_manage_admins и is_super_admin
  assert.equal((await api.put(`/users/${u.id}/permissions`, t, { perm_manage_admins: 1 })).body.code, "super_admin_only_fields");
  assert.equal((await api.put(`/users/${u.id}/permissions`, t, { is_super_admin: true })).body.code, "super_admin_only_fields");
  // можно выдать то, что есть
  assert.equal((await api.put(`/users/${u.id}/permissions`, t, { perm_manage_users: 1 })).status, 200);
  // и нельзя править супер-админа
  const sa = h.createUser({ is_super_admin: 1 });
  assert.equal((await api.put(`/users/${sa.id}/permissions`, t, { perm_manage_users: 0 })).body.code, "forbidden_target");
});

test("последний супер-админ: нельзя отключить, разжаловать и удалить", async () => {
  const sa1 = h.createUser({ is_super_admin: 1 });
  const mgr = h.createUser({ perm_manage_users: 1, is_super_admin: 0 });
  // единственный супер-админ, действует сам на себя через разжалование
  assert.equal((await api.put(`/users/${sa1.id}/permissions`, h.tokenFor(sa1), { is_super_admin: false })).body.code, "last_super_admin");
  assert.equal((await api.del(`/users/${sa1.id}`, h.tokenFor(sa1))).body.code, "cannot_delete_self");
  // второй супер-админ появился — теперь можно разжаловать одного, но не последнего
  const sa2 = h.createUser({ is_super_admin: 1 });
  assert.equal((await api.put(`/users/${sa2.id}/permissions`, h.tokenFor(sa1), { is_super_admin: false })).status, 200);
  assert.equal((await api.put(`/users/${sa1.id}`, h.tokenFor(mgr), {})).body.code, "forbidden_target");
  assert.ok(sa2);
});

test("нельзя отключить последнего супер-админа руками другого супер-админа, ставшего неактивным", async () => {
  const sa1 = h.createUser({ is_super_admin: 1 });
  const sa2 = h.createUser({ is_super_admin: 1 });
  assert.equal((await api.put(`/users/${sa2.id}`, h.tokenFor(sa1), { status: "disabled" })).status, 200);
  assert.equal((await api.put(`/users/${sa1.id}`, h.tokenFor(sa1), { status: "disabled" })).body.code, "cannot_change_own_status");
});

test("удаление: себя нельзя, автора кайдзенов нельзя, остальных можно", async () => {
  const m = manager();
  const t = h.tokenFor(m);
  assert.equal((await api.del(`/users/${m.id}`, t)).body.code, "cannot_delete_self");
  const author = h.createUser();
  h.createKaizen({ author });
  assert.equal((await api.del(`/users/${author.id}`, t)).body.code, "user_has_kaizens");
  const free = h.createUser();
  assert.equal((await api.del(`/users/${free.id}`, t)).status, 200);
  assert.equal((await api.del(`/users/${free.id}`, t)).status, 404);
});

test("удаление мастера удаляет его команду (каскад)", async () => {
  const m = manager();
  const u = h.createUser();
  h.createMember(u);
  await api.del(`/users/${u.id}`, h.tokenFor(m));
  assert.equal(h.db.prepare("SELECT COUNT(*) c FROM team_members").get().c, 0);
});
