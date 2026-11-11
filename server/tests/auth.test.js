const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");

describe("auth", () => {
  let srv;
  before(async () => {
    srv = await h.startServer();
  });
  after(() => srv.close());
  beforeEach(() => h.resetDb());

  describe("register", () => {
    test("creates a pending user and never returns the password hash", async () => {
      const dep = h.createDepartment();
      const pos = h.createPosition(dep.id);
      const res = await srv.post("/auth/register", null, {
        login: "newbie",
        password: "secret123",
        full_name: "Новый Сотрудник",
        department_id: dep.id,
        position_id: pos.id,
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.user.status, "pending");
      assert.equal(res.body.user.password_hash, undefined);
    });

    test("rejects short password, short login and missing fields", async () => {
      const dep = h.createDepartment();
      const pos = h.createPosition(dep.id);
      const base = { login: "okname", password: "secret123", full_name: "Имя Фамилия", department_id: dep.id, position_id: pos.id };
      for (const patch of [{ password: "123" }, { login: "ab" }, { full_name: "" }, { department_id: undefined }]) {
        const res = await srv.post("/auth/register", null, { ...base, ...patch });
        assert.equal(res.status, 400, JSON.stringify(patch));
      }
    });

    test("rejects a duplicate login with 409", async () => {
      const dep = h.createDepartment();
      const pos = h.createPosition(dep.id);
      h.createUser({ login: "taken" });
      const res = await srv.post("/auth/register", null, {
        login: "taken", password: "secret123", full_name: "Кто-то", department_id: dep.id, position_id: pos.id,
      });
      assert.equal(res.status, 409);
    });

    test("rejects a position that belongs to another department", async () => {
      const depA = h.createDepartment();
      const depB = h.createDepartment();
      const posB = h.createPosition(depB.id);
      const res = await srv.post("/auth/register", null, {
        login: "mismatch", password: "secret123", full_name: "Кто-то", department_id: depA.id, position_id: posB.id,
      });
      assert.equal(res.status, 400);
    });

    test("a malformed JSON body gives 400, not 500", async () => {
      const res = await srv.request("POST", "/auth/register", { rawBody: "{not json" });
      assert.equal(res.status, 400);
    });
  });

  describe("login", () => {
    test("approved user gets a token and no password hash", async () => {
      const u = h.createUser({ login: "ivan" });
      const res = await srv.post("/auth/login", null, { login: "ivan", password: h.DEFAULT_PASSWORD });
      assert.equal(res.status, 200);
      assert.ok(res.body.token);
      assert.equal(res.body.user.id, u.id);
      assert.equal(res.body.user.password_hash, undefined);
    });

    test("wrong password and unknown login give the same 401 message", async () => {
      h.createUser({ login: "ivan" });
      const wrong = await srv.post("/auth/login", null, { login: "ivan", password: "nope-nope" });
      const unknown = await srv.post("/auth/login", null, { login: "ghost", password: "nope-nope" });
      assert.equal(wrong.status, 401);
      assert.equal(unknown.status, 401);
      assert.equal(wrong.body.error, unknown.body.error);
    });

    test("non-string credentials are rejected with 400", async () => {
      const res = await srv.post("/auth/login", null, { login: { $ne: "" }, password: ["x"] });
      assert.equal(res.status, 400);
    });

    for (const status of ["pending", "rejected", "disabled"]) {
      test(`a ${status} account cannot log in and gets its status back`, async () => {
        h.createUser({ login: `u_${status}`, status });
        const res = await srv.post("/auth/login", null, { login: `u_${status}`, password: h.DEFAULT_PASSWORD });
        assert.equal(res.status, 403);
        assert.equal(res.body.status, status);
        assert.equal(res.body.token, undefined);
      });
    }
  });

  describe("sessions", () => {
    test("/auth/me requires a token", async () => {
      assert.equal((await srv.get("/auth/me")).status, 401);
      assert.equal((await srv.get("/auth/me", "garbage.token.value")).status, 401);
    });

    test("/auth/me returns the current user", async () => {
      const u = h.createUser();
      const res = await srv.get("/auth/me", h.tokenFor(u));
      assert.equal(res.status, 200);
      assert.equal(res.body.user.id, u.id);
      assert.equal(res.body.user.password_hash, undefined);
    });

    test("a token stops working immediately when the account is disabled", async () => {
      const u = h.createUser();
      const token = h.tokenFor(u);
      assert.equal((await srv.get("/auth/me", token)).status, 200);
      h.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(u.id);
      assert.equal((await srv.get("/auth/me", token)).status, 401);
      assert.equal((await srv.post("/kaizens", token, { title: "t", description: "d" })).status, 401);
    });

    test("a token stops working when the user is deleted (no 500)", async () => {
      const u = h.createUser();
      const token = h.tokenFor(u);
      h.db.prepare("DELETE FROM users WHERE id = ?").run(u.id);
      for (const res of [await srv.get("/auth/me", token), await srv.get("/kaizens", token), await srv.get("/kaizens/1", token)]) {
        assert.equal(res.status, 401);
      }
    });
  });

  describe("rate limiting", () => {
    test("repeated failed logins are throttled with 429; successful ones are not counted", async () => {
      const limited = await h.startServer({ rateLimits: true });
      try {
        h.createUser({ login: "ivan" });
        // 5 successes must not eat into the failure budget
        for (let i = 0; i < 5; i++) {
          assert.equal((await limited.post("/auth/login", null, { login: "ivan", password: h.DEFAULT_PASSWORD })).status, 200);
        }
        let last;
        for (let i = 0; i < 10; i++) last = await limited.post("/auth/login", null, { login: "ivan", password: "wrong-pass" });
        assert.equal(last.status, 401);
        const blocked = await limited.post("/auth/login", null, { login: "ivan", password: "wrong-pass" });
        assert.equal(blocked.status, 429);
        assert.ok(blocked.body.error);
      } finally {
        await limited.close();
      }
    });
  });

  test("unknown API routes return a JSON 404", async () => {
    const res = await srv.get("/definitely-not-a-route");
    assert.equal(res.status, 404);
    assert.ok(res.body.error);
  });

  test("security headers are set", async () => {
    const res = await srv.get("/health");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-powered-by"), null);
  });
});
