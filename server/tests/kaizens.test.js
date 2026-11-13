const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");

let api;
before(async () => { api = await h.startServer(); });
after(async () => { await api.close(); });
beforeEach(() => h.resetDb());

const create = (user, overrides) => api.post("/kaizens", h.tokenFor(user), h.kaizenBody(overrides));
const manager = (extra = {}) => h.createUser({ perm_manage_kaizens: 1, ...extra });

// ------------------------------------------------------------ создание

test("мастер создаёт кайдзен от своего имени: снимок данных, номер, история", async () => {
  const dep = h.createDepartment("Логистика");
  const m = h.createUser({ department_id: dep.id, post_title: "Мастер" });
  const r = await create(m);
  assert.equal(r.status, 201);
  const k = r.body.kaizen;
  assert.equal(k.number, k.id);
  assert.equal(k.status, "sent");
  assert.equal(k.operator_tabel, m.tabel_number);
  assert.equal(k.submitter_tabel, m.tabel_number);
  assert.equal(k.department_name, "Логистика");
  assert.equal(k.history.length, 1);
  assert.equal(k.can_edit, true);
  assert.ok(k.edit_deadline);
});

test("кайдзен от имени оператора из своей команды; чужого оператора указать нельзя", async () => {
  const m = h.createUser();
  const other = h.createUser();
  const op = h.createMember(m, { full_name: "Оператор Один", post_title: "Оператор" });
  const foreign = h.createMember(other);
  const ok = await create(m, { member_id: op.id });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.kaizen.operator_tabel, op.tabel_number);
  assert.equal(ok.body.kaizen.operator_name, "Оператор Один");
  assert.equal(ok.body.kaizen.submitter_tabel, m.tabel_number);
  const bad = await create(m, { member_id: foreign.id });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "member_not_found");
  assert.equal((await create(m, { member_id: 99999 })).body.code, "member_not_found");
});

test("снимок: после переименования отдела и удаления оператора карточка не меняется", async () => {
  const dep = h.createDepartment("Старое имя");
  const m = h.createUser({ department_id: dep.id });
  const op = h.createMember(m, { full_name: "Иван Иванов" });
  const k = (await create(m, { member_id: op.id })).body.kaizen;
  h.db.prepare("UPDATE departments SET name = 'Новое имя' WHERE id = ?").run(dep.id);
  h.db.prepare("DELETE FROM team_members WHERE id = ?").run(op.id);
  const again = (await api.get(`/kaizens/${k.id}`, h.tokenFor(m))).body.kaizen;
  assert.equal(again.department_name, "Старое имя");
  assert.equal(again.operator_name, "Иван Иванов");
  assert.equal(again.operator_member_id, null);
});

test("номера растут и не переиспользуются после удаления", async () => {
  const m = h.createUser();
  const a = (await create(m)).body.kaizen;
  assert.equal((await api.del(`/kaizens/${a.id}`, h.tokenFor(m))).status, 200);
  const b = (await create(m)).body.kaizen;
  assert.ok(b.number > a.number);
});

test("все богатые поля сохраняются; теги дедуплицируются", async () => {
  const m = h.createUser();
  const r = await create(m, {
    area: "Склад 2", equipment: "Погрузчик", noticed_on: "2026-11-01",
    before_text: "до", benefits_text: "выгода", conclusion_text: "вывод",
    wastes: ["waiting", "motion", "waiting"], effects: ["time", "money"],
    impl_status: "implemented", implemented_on: "2026-11-10", effort: "low",
    currency: "USD", cost_amount: 100, saving_month_amount: 500, participants: "Иванов, Петров",
  });
  assert.equal(r.status, 201);
  const k = r.body.kaizen;
  assert.deepEqual(k.wastes, ["waiting", "motion"]);
  assert.deepEqual(k.effects, ["time", "money"]);
  assert.equal(k.impl_status, "implemented");
  assert.equal(k.currency, "USD");
  assert.equal(k.saving_month_amount, 500);
  assert.equal(k.area, "Склад 2");
});

test("замеры: процент изменения и направление «лучше»", async () => {
  const m = h.createUser();
  const r = await create(m, {
    measures: [
      { name: "Время операции", unit: "мин", before_value: 12, after_value: 8 },
      { name: "Выпуск", unit: "шт", before_value: 100, after_value: 130, better: "higher" },
      { name: "Брак", unit: "шт", before_value: 0, after_value: 0 },
      { name: "Ухудшение", before_value: 5, after_value: 6 },
    ],
  });
  const [a, b, c, d] = r.body.kaizen.measures;
  assert.equal(a.change_pct, -33.3);
  assert.equal(a.improved, true);
  assert.equal(b.change_pct, 30);
  assert.equal(b.improved, true);
  assert.equal(c.change_pct, null);
  assert.equal(c.improved, null);
  assert.equal(d.improved, false);
});

test("валидация: обязательные поля, списки, числа, даты, лимиты", async () => {
  const m = h.createUser();
  const bad = async (over, field) => {
    const r = await create(m, over);
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.equal(r.body.code, "kaizen_invalid_input");
    if (field) assert.equal(r.body.field, field);
  };
  await bad({ title: "ab" }, "title");
  await bad({ title: "x".repeat(201) }, "title");
  await bad({ category: "weird" }, "category");
  await bad({ problem_text: "" }, "problem_text");
  await bad({ after_text: undefined }, "after_text");
  await bad({ wastes: ["nope"] });
  await bad({ effects: "time" });
  await bad({ impl_status: "done" }, "impl_status");
  await bad({ effort: "huge" }, "effort");
  await bad({ currency: "RUB" }, "currency");
  await bad({ cost_amount: -1 }, "cost_amount");
  await bad({ cost_amount: "100" }, "cost_amount");
  await bad({ noticed_on: "13.11.2026" }, "noticed_on");
  await bad({ noticed_on: "2026-13-45" }, "noticed_on");
  await bad({ measures: [{ name: "", before_value: 1, after_value: 2 }] });
  await bad({ measures: [{ name: "x", before_value: "1", after_value: 2 }] });
  await bad({ measures: Array.from({ length: 21 }, () => ({ name: "x", before_value: 1, after_value: 2 })) });
  await bad({ problem_text: "x".repeat(5001) }, "problem_text");
  assert.equal((await api.post("/kaizens", h.tokenFor(m), {})).status, 400);
});

test("без токена нельзя ни читать, ни создавать", async () => {
  assert.equal((await api.get("/kaizens")).status, 401);
  assert.equal((await api.post("/kaizens", null, h.kaizenBody())).status, 401);
});

// ------------------------------------------------------------ чтение, видимость

test("по умолчанию все вошедшие видят все кайдзены; удалённые скрыты", async () => {
  const a = h.createUser();
  const b = h.createUser();
  const k = (await create(a)).body.kaizen;
  assert.equal((await api.get(`/kaizens/${k.id}`, h.tokenFor(b))).status, 200);
  assert.equal((await api.get("/kaizens", h.tokenFor(b))).body.kaizens.length, 1);
  await api.del(`/kaizens/${k.id}`, h.tokenFor(a));
  assert.equal((await api.get("/kaizens", h.tokenFor(b))).body.kaizens.length, 0);
  assert.equal((await api.get(`/kaizens/${k.id}`, h.tokenFor(b))).status, 403);
  const m = manager();
  assert.equal((await api.get(`/kaizens/${k.id}`, h.tokenFor(m))).status, 200);
  assert.equal((await api.get("/kaizens?include_deleted=1", h.tokenFor(m))).body.kaizens.length, 1);
  assert.equal((await api.get("/kaizens?include_deleted=1", h.tokenFor(b))).body.kaizens.length, 0);
});

test("режим restricted: свои, отдел, права; настройку меняет только супер-админ", async () => {
  const d = h.createDepartment();
  const a = h.createUser({ department_id: d.id });
  const colleague = h.createUser({ department_id: d.id });
  const stranger = h.createUser();
  const viewer = h.createUser({ perm_view_kaizens: 1 });
  const sa = h.createUser({ is_super_admin: 1 });
  const k = (await create(a)).body.kaizen;

  assert.equal((await api.put("/settings", h.tokenFor(a), { kaizen_visibility: "restricted" })).status, 403);
  assert.equal((await api.put("/settings", h.tokenFor(sa), { kaizen_visibility: "nope" })).body.code, "invalid_setting");
  assert.equal((await api.put("/settings", h.tokenFor(sa), { kaizen_visibility: "restricted" })).status, 200);
  assert.equal((await api.get("/settings", h.tokenFor(a))).body.kaizen_visibility, "restricted");

  assert.equal((await api.get(`/kaizens/${k.id}`, h.tokenFor(a))).status, 200);
  assert.equal((await api.get(`/kaizens/${k.id}`, h.tokenFor(colleague))).status, 200);
  assert.equal((await api.get(`/kaizens/${k.id}`, h.tokenFor(stranger))).status, 403);
  assert.equal((await api.get(`/kaizens/${k.id}`, h.tokenFor(viewer))).status, 200);
  assert.equal((await api.get("/kaizens", h.tokenFor(stranger))).body.kaizens.length, 0);
  assert.equal((await api.get("/kaizens", h.tokenFor(viewer))).body.kaizens.length, 1);
});

test("список: фильтры и поиск по названию, табельному, номеру", async () => {
  const d = h.createDepartment();
  const a = h.createUser({ department_id: d.id });
  const b = h.createUser();
  const op = h.createMember(a, { full_name: "Сидоров Пётр" });
  const k1 = (await create(a, { title: "Первый кайдзен", category: "cost" })).body.kaizen;
  const k2 = (await create(b, { title: "Второй кайдзен", category: "quality" })).body.kaizen;
  const k3 = (await create(a, { title: "Третий", member_id: op.id })).body.kaizen;
  await api.put(`/kaizens/${k2.id}/status`, h.tokenFor(manager()), { status: "accepted" });
  const t = h.tokenFor(a);
  const ids = async (qs) => (await api.get(`/kaizens${qs}`, t)).body.kaizens.map((k) => k.id).sort();
  assert.deepEqual(await ids(""), [k1.id, k2.id, k3.id].sort());
  assert.deepEqual(await ids("?category=quality"), [k2.id]);
  assert.deepEqual(await ids("?status=accepted"), [k2.id]);
  assert.deepEqual(await ids("?mine=1"), [k1.id, k3.id].sort());
  assert.deepEqual(await ids(`?department_id=${d.id}`), [k1.id, k3.id].sort());
  assert.deepEqual(await ids("?q=Второй"), [k2.id]);
  assert.deepEqual(await ids(`?q=${op.tabel_number}`), [k3.id]);
  assert.deepEqual(await ids("?q=Сидоров"), [k3.id]);
  assert.deepEqual(await ids(`?q=%23${k1.id}`), [k1.id]);
  assert.deepEqual(await ids("?q=%25"), []);
  assert.deepEqual(await ids("?status=bogus"), (await ids("")));
});

test("несуществующий и нечисловой id", async () => {
  const m = h.createUser();
  assert.equal((await api.get("/kaizens/9999", h.tokenFor(m))).body.code, "kaizen_not_found");
  assert.equal((await api.get("/kaizens/abc", h.tokenFor(m))).status, 404);
  assert.equal((await api.get("/kaizens/1 OR 1=1", h.tokenFor(m))).status, 404);
});

// ------------------------------------------------------------ редактирование

test("автор правит в течение суток; после — 403 edit_window_closed; админ может всегда", async () => {
  const a = h.createUser();
  const old = h.createKaizen({ author: a, createdAt: "2020-01-01 00:00:00" });
  const t = h.tokenFor(a);
  const closed = await api.put(`/kaizens/${old.id}`, t, { title: "Новое название" });
  assert.equal(closed.status, 403);
  assert.equal(closed.body.code, "edit_window_closed");
  assert.equal((await api.get(`/kaizens/${old.id}`, t)).body.kaizen.can_edit, false);
  assert.equal((await api.put(`/kaizens/${old.id}`, h.tokenFor(manager()), { title: "Правка админа" })).status, 200);

  const fresh = (await create(a)).body.kaizen;
  const r = await api.put(`/kaizens/${fresh.id}`, t, { title: "Новое название", wastes: ["motion"] });
  assert.equal(r.status, 200);
  assert.equal(r.body.kaizen.title, "Новое название");
  assert.deepEqual(r.body.kaizen.wastes, ["motion"]);
  assert.equal(r.body.kaizen.problem_text, fresh.problem_text);
});

test("чужой кайдзен автор-коллега править не может", async () => {
  const a = h.createUser();
  const b = h.createUser();
  const k = (await create(a)).body.kaizen;
  assert.equal((await api.put(`/kaizens/${k.id}`, h.tokenFor(b), { title: "Взлом взлом" })).status, 403);
});

test("правка: частичное обновление, null очищает необязательное, замеры заменяются целиком", async () => {
  const a = h.createUser();
  const k = (await create(a, { area: "Зона А", measures: [{ name: "x", before_value: 1, after_value: 2 }] })).body.kaizen;
  const t = h.tokenFor(a);
  const r1 = await api.put(`/kaizens/${k.id}`, t, { area: null });
  assert.equal(r1.body.kaizen.area, null);
  assert.equal(r1.body.kaizen.measures.length, 1);
  const r2 = await api.put(`/kaizens/${k.id}`, t, { measures: [] });
  assert.equal(r2.body.kaizen.measures.length, 0);
  assert.equal((await api.put(`/kaizens/${k.id}`, t, { category: "bad" })).body.code, "kaizen_invalid_input");
  // оператора и автора менять нельзя: поля игнорируются
  const r3 = await api.put(`/kaizens/${k.id}`, t, { operator_tabel: 1, author_id: 999, status: "accepted" });
  assert.equal(r3.body.kaizen.operator_tabel, a.tabel_number);
  assert.equal(r3.body.kaizen.status, "sent");
});

test("разрешение админа продлевает окно правки", async () => {
  const a = h.createUser();
  const old = h.createKaizen({ author: a, createdAt: "2020-01-01 00:00:00" });
  const m = manager();
  assert.equal((await api.post(`/kaizens/${old.id}/allow-edit`, h.tokenFor(a), { hours: 5 })).status, 403);
  assert.equal((await api.post(`/kaizens/${old.id}/allow-edit`, h.tokenFor(m), { hours: 0 })).body.code, "invalid_hours");
  assert.equal((await api.post(`/kaizens/${old.id}/allow-edit`, h.tokenFor(m), { hours: 99999 })).body.code, "invalid_hours");
  assert.equal((await api.post(`/kaizens/${old.id}/allow-edit`, h.tokenFor(m), { hours: 2.5 })).status, 400);
  const r = await api.post(`/kaizens/${old.id}/allow-edit`, h.tokenFor(m), { hours: 5 });
  assert.equal(r.status, 200);
  assert.equal(r.body.kaizen.edit_allowed_until, undefined);
  const edit = await api.put(`/kaizens/${old.id}`, h.tokenFor(a), { title: "После разрешения" });
  assert.equal(edit.status, 200);
});

// ------------------------------------------------------------ статусы и удаление

test("статус меняет только менеджер; допустимы sent/accepted/rejected; история ведётся", async () => {
  const a = h.createUser();
  const k = (await create(a)).body.kaizen;
  assert.equal((await api.put(`/kaizens/${k.id}/status`, h.tokenFor(a), { status: "accepted" })).status, 403);
  const m = manager();
  const r = await api.put(`/kaizens/${k.id}/status`, h.tokenFor(m), { status: "rejected", comment: "дубликат" });
  assert.equal(r.body.kaizen.status, "rejected");
  assert.equal(r.body.kaizen.admin_comment, "дубликат");
  assert.equal(r.body.kaizen.history.length, 2);
  for (const bad of ["new", "implemented", "", 5]) {
    assert.equal((await api.put(`/kaizens/${k.id}/status`, h.tokenFor(m), { status: bad })).body.code, "invalid_status");
  }
  assert.equal((await api.put("/kaizens/9999/status", h.tokenFor(m), { status: "accepted" })).status, 404);
});

test("удаление: автор — свой неразобранный кайдзен в окне правки; менеджер — любой; мягкое", async () => {
  const a = h.createUser();
  const m = manager();
  const accepted = (await create(a)).body.kaizen;
  await api.put(`/kaizens/${accepted.id}/status`, h.tokenFor(m), { status: "accepted" });
  assert.equal((await api.del(`/kaizens/${accepted.id}`, h.tokenFor(a))).status, 403);
  const old = h.createKaizen({ author: a, createdAt: "2020-01-01 00:00:00" });
  assert.equal((await api.del(`/kaizens/${old.id}`, h.tokenFor(a))).status, 403);
  assert.equal((await api.del(`/kaizens/${old.id}`, h.tokenFor(h.createUser()))).status, 403);
  assert.equal((await api.del(`/kaizens/${old.id}`, h.tokenFor(m))).status, 200);
  assert.equal((await api.del(`/kaizens/${old.id}`, h.tokenFor(m))).status, 404);
  const row = h.db.prepare("SELECT deleted_at, deleted_by FROM kaizens WHERE id = ?").get(old.id);
  assert.ok(row.deleted_at);
  assert.equal(row.deleted_by, m.id);
  assert.equal((await api.put(`/kaizens/${old.id}`, h.tokenFor(m), { title: "Правка удалённого" })).status, 403);
});

test("автора-пользователя с кайдзенами нельзя удалить (карточки не теряются)", async () => {
  const a = h.createUser();
  const admin = h.createUser({ perm_manage_users: 1 });
  await create(a);
  assert.equal((await api.del(`/users/${a.id}`, h.tokenFor(admin))).body.code, "user_has_kaizens");
});
