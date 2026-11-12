const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");

describe("kaizens", () => {
  let srv;
  before(async () => {
    srv = await h.startServer();
  });
  after(() => srv.close());
  beforeEach(() => h.resetDb());

  describe("creating", () => {
    test("creates a kaizen with status 'new', the author's department and a history entry", async () => {
      const dep = h.createDepartment();
      const u = h.createUser({ department_id: dep.id });
      const res = await srv.post("/kaizens", h.tokenFor(u), { title: "  Лишний шаг  ", description: " Убрать лишний шаг ", category: "Quality" });
      assert.equal(res.status, 201);
      const k = res.body.kaizen;
      assert.equal(k.title, "Лишний шаг");
      assert.equal(k.status, "new");
      assert.equal(k.department_id, dep.id);
      assert.equal(k.author.id, u.id);
      assert.equal(k.history.length, 1);
      assert.equal(k.history[0].status, "new");
    });

    test("requires auth", async () => {
      assert.equal((await srv.post("/kaizens", null, { title: "t", description: "d" })).status, 401);
    });

    test("validates required fields, types and length limits", async () => {
      const t = h.tokenFor(h.createUser());
      const bad = [
        {},
        { title: "x" },
        { description: "x" },
        { title: "   ", description: "x" },
        { title: "x".repeat(201), description: "x" },
        { title: "x", description: "y".repeat(5001) },
        { title: "x", description: "y", category: "c".repeat(101) },
        { title: { a: 1 }, description: "y" },
      ];
      for (const body of bad) {
        assert.equal((await srv.post("/kaizens", t, body)).status, 400, JSON.stringify(body).slice(0, 60));
      }
    });

    test("boundary lengths are accepted", async () => {
      const t = h.tokenFor(h.createUser());
      const res = await srv.post("/kaizens", t, { title: "x".repeat(200), description: "y".repeat(5000), category: "c".repeat(100) });
      assert.equal(res.status, 201);
    });
  });

  describe("visibility", () => {
    test("the list shows only own kaizens by default", async () => {
      const dep = h.createDepartment();
      const a = h.createUser({ department_id: dep.id });
      const b = h.createUser({ department_id: dep.id });
      const ka = h.createKaizen({ author: a });
      h.createKaizen({ author: b });
      const res = await srv.get("/kaizens", h.tokenFor(a));
      assert.deepEqual(res.body.kaizens.map((k) => k.id), [ka.id]);
    });

    test("?scope=department shows the whole department but never another one", async () => {
      const dep1 = h.createDepartment();
      const dep2 = h.createDepartment();
      const a = h.createUser({ department_id: dep1.id });
      const b = h.createUser({ department_id: dep1.id });
      const c = h.createUser({ department_id: dep2.id });
      h.createKaizen({ author: a });
      h.createKaizen({ author: b });
      h.createKaizen({ author: c });
      const res = await srv.get("/kaizens?scope=department", h.tokenFor(a));
      assert.equal(res.body.kaizens.length, 2);
      assert.ok(res.body.kaizens.every((k) => k.department_id === dep1.id));
    });

    test("single-item access follows the same rule: own / same department / manager", async () => {
      const dep1 = h.createDepartment();
      const dep2 = h.createDepartment();
      const author = h.createUser({ department_id: dep1.id });
      const teammate = h.createUser({ department_id: dep1.id });
      const outsider = h.createUser({ department_id: dep2.id });
      const manager = h.createUser({ perm_manage_kaizens: 1 });
      const k = h.createKaizen({ author });
      assert.equal((await srv.get(`/kaizens/${k.id}`, h.tokenFor(author))).status, 200);
      assert.equal((await srv.get(`/kaizens/${k.id}`, h.tokenFor(teammate))).status, 200);
      assert.equal((await srv.get(`/kaizens/${k.id}`, h.tokenFor(outsider))).status, 403);
      assert.equal((await srv.get(`/kaizens/${k.id}`, h.tokenFor(manager))).status, 200);
    });

    test("two users WITHOUT a department are not 'the same department' (null != null)", async () => {
      const a = h.createUser({ department_id: null });
      const b = h.createUser({ department_id: null });
      const k = h.createKaizen({ author: a });
      assert.equal((await srv.get(`/kaizens/${k.id}`, h.tokenFor(b))).status, 403);
    });

    test("managers and super admins see every kaizen in the list", async () => {
      const a = h.createUser();
      const b = h.createUser();
      h.createKaizen({ author: a });
      h.createKaizen({ author: b });
      const manager = h.createUser({ perm_manage_kaizens: 1 });
      const root = h.createUser({ is_super_admin: 1 });
      assert.equal((await srv.get("/kaizens", h.tokenFor(manager))).body.kaizens.length, 2);
      assert.equal((await srv.get("/kaizens", h.tokenFor(root))).body.kaizens.length, 2);
    });

    test("unknown id is 404", async () => {
      assert.equal((await srv.get("/kaizens/99999", h.tokenFor(h.createUser()))).status, 404);
    });
  });

  describe("status changes", () => {
    test("a manager changes status; comment and history are recorded in order", async () => {
      const author = h.createUser();
      const manager = h.createUser({ perm_manage_kaizens: 1 });
      const k = h.createKaizen({ author });
      const tM = h.tokenFor(manager);
      assert.equal((await srv.put(`/kaizens/${k.id}/status`, tM, { status: "in_review" })).status, 200);
      const res = await srv.put(`/kaizens/${k.id}/status`, tM, { status: "accepted", comment: "Внедряем" });
      assert.equal(res.status, 200);
      assert.equal(res.body.kaizen.status, "accepted");
      assert.equal(res.body.kaizen.admin_comment, "Внедряем");
      assert.deepEqual(res.body.kaizen.history.map((x) => x.status), ["new", "in_review", "accepted"]);
    });

    test("an ordinary user — even the author — cannot change status", async () => {
      const author = h.createUser();
      const k = h.createKaizen({ author });
      const res = await srv.put(`/kaizens/${k.id}/status`, h.tokenFor(author), { status: "accepted" });
      assert.equal(res.status, 403);
      assert.equal(h.db.prepare("SELECT status FROM kaizens WHERE id = ?").get(k.id).status, "new");
    });

    test("rejects an unknown status and an over-long comment; 404 for unknown id", async () => {
      const author = h.createUser();
      const t = h.tokenFor(h.createUser({ perm_manage_kaizens: 1 }));
      const k = h.createKaizen({ author });
      assert.equal((await srv.put(`/kaizens/${k.id}/status`, t, { status: "done" })).status, 400);
      assert.equal((await srv.put(`/kaizens/${k.id}/status`, t, { status: "accepted", comment: "c".repeat(1001) })).status, 400);
      assert.equal((await srv.put("/kaizens/99999/status", t, { status: "accepted" })).status, 404);
    });

    test("a later status change without a comment keeps the previous admin comment", async () => {
      const author = h.createUser();
      const t = h.tokenFor(h.createUser({ perm_manage_kaizens: 1 }));
      const k = h.createKaizen({ author });
      await srv.put(`/kaizens/${k.id}/status`, t, { status: "in_review", comment: "Смотрим" });
      const res = await srv.put(`/kaizens/${k.id}/status`, t, { status: "accepted" });
      assert.equal(res.body.kaizen.admin_comment, "Смотрим");
    });
  });

  describe("deleting", () => {
    test("the author may withdraw their own kaizen while it is still 'new'", async () => {
      const author = h.createUser();
      const k = h.createKaizen({ author });
      assert.equal((await srv.del(`/kaizens/${k.id}`, h.tokenFor(author))).status, 200);
      assert.equal(h.db.prepare("SELECT COUNT(*) c FROM kaizens").get().c, 0);
    });

    for (const status of ["in_review", "accepted", "rejected", "implemented"]) {
      test(`the author cannot delete a kaizen once it is '${status}'`, async () => {
        const author = h.createUser();
        const k = h.createKaizen({ author, status });
        assert.equal((await srv.del(`/kaizens/${k.id}`, h.tokenFor(author))).status, 403);
        assert.ok(h.db.prepare("SELECT id FROM kaizens WHERE id = ?").get(k.id));
      });
    }

    test("someone else cannot delete it; a manager can", async () => {
      const dep = h.createDepartment();
      const author = h.createUser({ department_id: dep.id });
      const teammate = h.createUser({ department_id: dep.id });
      const manager = h.createUser({ perm_manage_kaizens: 1 });
      const k = h.createKaizen({ author, status: "accepted" });
      assert.equal((await srv.del(`/kaizens/${k.id}`, h.tokenFor(teammate))).status, 403);
      assert.equal((await srv.del(`/kaizens/${k.id}`, h.tokenFor(manager))).status, 200);
    });

    test("deleting also removes its history; unknown id is 404", async () => {
      const author = h.createUser();
      const k = h.createKaizen({ author });
      await srv.del(`/kaizens/${k.id}`, h.tokenFor(author));
      assert.equal(h.db.prepare("SELECT COUNT(*) c FROM kaizen_status_history").get().c, 0);
      assert.equal((await srv.del("/kaizens/99999", h.tokenFor(author))).status, 404);
    });
  });
});
