const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");

let api;
before(async () => { api = await h.startServer(); });
after(async () => { await api.close(); });
beforeEach(() => h.resetDb());

const login = (tabel, password) => api.post("/auth/login", null, { tabel_number: tabel, password });

test("вход по табельному номеру и паролю", async () => {
  const u = h.createUser();
  const r = await login(u.tabel_number, h.DEFAULT_PASSWORD);
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
  assert.equal(r.body.user.id, u.id);
  assert.equal(r.body.user.password_hash, undefined);
  assert.equal(r.body.user.activation_code_hash, undefined);
  assert.equal(r.body.user.token_version, undefined);
});

test("табельный номер можно передать строкой", async () => {
  const u = h.createUser();
  assert.equal((await login(String(u.tabel_number), h.DEFAULT_PASSWORD)).status, 200);
});

test("неверный пароль и неизвестный табельный неотличимы", async () => {
  const u = h.createUser();
  const a = await login(u.tabel_number, "wrong-password");
  const b = await login(2999, "whatever123");
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.body.code, "invalid_credentials");
  assert.deepEqual(a.body, b.body);
});

test("некорректный ввод при входе", async () => {
  for (const body of [{}, { tabel_number: 5 }, { password: "x" }, { tabel_number: 0, password: "x" }, { tabel_number: 3001, password: "x" }, { tabel_number: "abc", password: "x" }, { tabel_number: 1.5, password: "x" }]) {
    const r = await api.post("/auth/login", null, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.code, "login_invalid_input");
  }
});

test("аккаунт без пароля: needs_activation", async () => {
  const u = h.createUser({ password_hash: null });
  const r = await login(u.tabel_number, "anything123");
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "needs_activation");
});

test("отключённый пользователь не входит", async () => {
  const u = h.createUser({ status: "disabled" });
  const r = await login(u.tabel_number, h.DEFAULT_PASSWORD);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "account_disabled");
});

test("GET /me без токена, с мусором и с валидным токеном", async () => {
  assert.equal((await api.get("/auth/me")).status, 401);
  assert.equal((await api.get("/auth/me", "garbage")).status, 401);
  const u = h.createUser();
  const r = await api.get("/auth/me", h.tokenFor(u));
  assert.equal(r.status, 200);
  assert.equal(r.body.user.tabel_number, u.tabel_number);
});

test("токен отключённого или удалённого пользователя перестаёт работать", async () => {
  const u = h.createUser();
  const t = h.tokenFor(u);
  h.db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(u.id);
  const r = await api.get("/auth/me", t);
  assert.equal(r.status, 401);
  assert.equal(r.body.code, "session_unavailable");
  h.db.prepare("DELETE FROM users WHERE id=?").run(u.id);
  assert.equal((await api.get("/auth/me", t)).status, 401);
});

test("смена пароля: старый пароль нужен, старые токены гаснут, новый токен работает", async () => {
  const u = h.createUser();
  const old = h.tokenFor(u);
  assert.equal((await api.put("/auth/me/password", old, { current_password: "nope", new_password: "newpassword1" })).body.code, "current_password_wrong");
  assert.equal((await api.put("/auth/me/password", old, { current_password: h.DEFAULT_PASSWORD, new_password: "short" })).body.code, "password_policy");
  const r = await api.put("/auth/me/password", old, { current_password: h.DEFAULT_PASSWORD, new_password: "newpassword1" });
  assert.equal(r.status, 200);
  assert.equal((await api.get("/auth/me", old)).status, 401);
  assert.equal((await api.get("/auth/me", r.body.token)).status, 200);
  assert.equal((await login(u.tabel_number, h.DEFAULT_PASSWORD)).status, 401);
  assert.equal((await login(u.tabel_number, "newpassword1")).status, 200);
});

test("настройки языка и темы", async () => {
  const u = h.createUser();
  const t = h.tokenFor(u);
  assert.equal((await api.put("/auth/me/preferences", t, { language: "uz", theme: "dark" })).body.user.language, "uz");
  assert.equal((await api.get("/auth/me", t)).body.user.theme, "dark");
  assert.equal((await api.put("/auth/me/preferences", t, { theme: "light" })).body.user.language, "uz");
  assert.equal((await api.put("/auth/me/preferences", t, { language: "de" })).body.code, "invalid_language");
  assert.equal((await api.put("/auth/me/preferences", t, { theme: "neon" })).body.code, "invalid_theme");
});

// ---------- activation ----------
async function adminCreates(extra = {}) {
  const admin = h.createUser({ perm_manage_users: 1 });
  const tabel = h.nextTabel();
  const r = await api.post("/users", h.tokenFor(admin), { tabel_number: tabel, full_name: "Новый Мастер", ...extra });
  assert.equal(r.status, 201);
  return { tabel, code: r.body.activation_code, admin, user: r.body.user };
}

test("активация: код + новый пароль → вход", async () => {
  const { tabel, code } = await adminCreates();
  const r = await api.post("/auth/activate", null, { tabel_number: tabel, activation_code: code, new_password: "mypassword1" });
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
  assert.equal((await login(tabel, "mypassword1")).status, 200);
  const again = await api.post("/auth/activate", null, { tabel_number: tabel, activation_code: code, new_password: "other-password1" });
  assert.equal(again.status, 400);
  assert.equal(again.body.code, "activation_failed");
});

test("код принимается в любом регистре и без дефиса", async () => {
  const { tabel, code } = await adminCreates();
  const r = await api.post("/auth/activate", null, { tabel_number: tabel, activation_code: code.toLowerCase().replace("-", " "), new_password: "mypassword1" });
  assert.equal(r.status, 200);
});

test("неверный код: после 5 попыток код аннулируется, даже верный не подходит", async () => {
  const { tabel, code } = await adminCreates();
  for (let i = 0; i < 5; i++) {
    const r = await api.post("/auth/activate", null, { tabel_number: tabel, activation_code: "AAAA-AAAA", new_password: "mypassword1" });
    assert.equal(r.body.code, "activation_failed");
  }
  const r = await api.post("/auth/activate", null, { tabel_number: tabel, activation_code: code, new_password: "mypassword1" });
  assert.equal(r.status, 400);
});

test("просроченный код не работает", async () => {
  const { tabel, code } = await adminCreates();
  h.db.prepare("UPDATE users SET activation_expires_at = '2000-01-01 00:00:00' WHERE tabel_number = ?").run(tabel);
  const r = await api.post("/auth/activate", null, { tabel_number: tabel, activation_code: code, new_password: "mypassword1" });
  assert.equal(r.body.code, "activation_failed");
});

test("активация: ответ одинаков для неизвестного табельного и неверного кода; слабый пароль отклоняется", async () => {
  const { tabel, code } = await adminCreates();
  const a = await api.post("/auth/activate", null, { tabel_number: 2998, activation_code: "AAAA-AAAA", new_password: "mypassword1" });
  const b = await api.post("/auth/activate", null, { tabel_number: tabel, activation_code: "AAAA-AAAA", new_password: "mypassword1" });
  assert.deepEqual(a.body, b.body);
  const weak = await api.post("/auth/activate", null, { tabel_number: tabel, activation_code: code, new_password: "short" });
  assert.equal(weak.body.code, "password_policy");
  assert.equal((await api.post("/auth/activate", null, { tabel_number: tabel })).status, 400);
});

test("отключённый пользователь не может активироваться", async () => {
  const { tabel, code, user } = await adminCreates();
  h.db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(user.id);
  const r = await api.post("/auth/activate", null, { tabel_number: tabel, activation_code: code, new_password: "mypassword1" });
  assert.equal(r.status, 403);
});

test("ограничение частоты: 10 неудачных входов → 429, успешные не считаются", async () => {
  const limited = await h.startServer({ rateLimits: true });
  try {
    const u = h.createUser();
    for (let i = 0; i < 12; i++) {
      const r = await limited.post("/auth/login", null, { tabel_number: u.tabel_number, password: h.DEFAULT_PASSWORD });
      assert.equal(r.status, 200);
    }
    let last;
    for (let i = 0; i < 11; i++) last = await limited.post("/auth/login", null, { tabel_number: u.tabel_number, password: "bad-password" });
    assert.equal(last.status, 429);
    assert.equal(last.body.code, "rate_limited");
  } finally {
    await limited.close();
  }
});

test("служебные ответы: 404 и битый JSON содержат code", async () => {
  assert.equal((await api.get("/nothing")).body.code, "not_found");
  const r = await api.request("POST", "/auth/login", { rawBody: "{bad" });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "bad_json");
});
