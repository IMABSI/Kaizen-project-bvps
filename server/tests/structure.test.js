const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");

describe("structure", () => {
  let srv;
  let tAdmin;
  before(async () => {
    srv = await h.startServer();
  });
  after(() => srv.close());
  beforeEach(() => {
    h.resetDb();
    tAdmin = h.tokenFor(h.createUser({ perm_manage_structure: 1 }));
  });

  test("the public endpoint returns departments with a nested position tree, no auth needed", async () => {
    const dep = h.createDepartment("Сварка");
    const top = h.createPosition(dep.id, "Мастер");
    const mid = h.createPosition(dep.id, "Бригадир", top.id);
    h.createPosition(dep.id, "Оператор", mid.id);
    const res = await srv.get("/structure/public");
    assert.equal(res.status, 200);
    const d = res.body.departments.find((x) => x.id === dep.id);
    assert.equal(d.positions.length, 1);
    assert.equal(d.positions[0].children[0].children[0].name, "Оператор");
  });

  test("managing departments and positions requires perm_manage_structure", async () => {
    const tWorker = h.tokenFor(h.createUser());
    assert.equal((await srv.post("/structure/departments", null, { name: "X" })).status, 401);
    assert.equal((await srv.post("/structure/departments", tWorker, { name: "X" })).status, 403);
    assert.equal((await srv.get("/structure/positions", tWorker)).status, 403);
    assert.equal((await srv.post("/structure/departments", tAdmin, { name: "X" })).status, 201);
  });

  describe("departments", () => {
    test("rejects an empty name and a duplicate name", async () => {
      assert.equal((await srv.post("/structure/departments", tAdmin, { name: "   " })).status, 400);
      assert.equal((await srv.post("/structure/departments", tAdmin, { name: "Покраска" })).status, 201);
      assert.equal((await srv.post("/structure/departments", tAdmin, { name: "Покраска" })).status, 409);
    });

    test("renaming to an existing name is a 409, not a 500", async () => {
      const a = h.createDepartment("A");
      h.createDepartment("B");
      assert.equal((await srv.put(`/structure/departments/${a.id}`, tAdmin, { name: "B" })).status, 409);
    });

    test("deleting a department removes its positions and detaches users", async () => {
      const dep = h.createDepartment();
      const pos = h.createPosition(dep.id);
      const user = h.createUser({ department_id: dep.id, position_id: pos.id });
      assert.equal((await srv.del(`/structure/departments/${dep.id}`, tAdmin)).status, 200);
      assert.equal(h.db.prepare("SELECT COUNT(*) c FROM positions").get().c, 0);
      assert.equal(h.getUser(user.id).department_id, null);
      assert.equal(h.getUser(user.id).position_id, null);
    });
  });

  describe("positions", () => {
    test("creates top-level and nested positions", async () => {
      const dep = h.createDepartment();
      const top = await srv.post("/structure/positions", tAdmin, { department_id: dep.id, name: "Мастер" });
      assert.equal(top.status, 201);
      assert.equal(top.body.position.parent_id, null);
      const child = await srv.post("/structure/positions", tAdmin, { department_id: dep.id, name: "Бригадир", parent_id: top.body.position.id });
      assert.equal(child.status, 201);
      assert.equal(child.body.position.parent_id, top.body.position.id);
    });

    test("rejects a duplicate name on the SAME level — including the top level (NULL parent)", async () => {
      const dep = h.createDepartment();
      assert.equal((await srv.post("/structure/positions", tAdmin, { department_id: dep.id, name: "Мастер" })).status, 201);
      assert.equal((await srv.post("/structure/positions", tAdmin, { department_id: dep.id, name: "Мастер" })).status, 409);
      const parent = h.db.prepare("SELECT id FROM positions WHERE name = 'Мастер'").get();
      assert.equal((await srv.post("/structure/positions", tAdmin, { department_id: dep.id, name: "Бригадир", parent_id: parent.id })).status, 201);
      assert.equal((await srv.post("/structure/positions", tAdmin, { department_id: dep.id, name: "Бригадир", parent_id: parent.id })).status, 409);
    });

    test("the same name is fine on a different level or in a different department", async () => {
      const dep1 = h.createDepartment();
      const dep2 = h.createDepartment();
      const top = h.createPosition(dep1.id, "Мастер");
      assert.equal((await srv.post("/structure/positions", tAdmin, { department_id: dep1.id, name: "Мастер", parent_id: top.id })).status, 201);
      assert.equal((await srv.post("/structure/positions", tAdmin, { department_id: dep2.id, name: "Мастер" })).status, 201);
    });

    test("rejects an unknown department, a parent from another department, and an empty name", async () => {
      const dep1 = h.createDepartment();
      const dep2 = h.createDepartment();
      const foreign = h.createPosition(dep2.id);
      assert.equal((await srv.post("/structure/positions", tAdmin, { department_id: 99999, name: "X" })).status, 400);
      assert.equal((await srv.post("/structure/positions", tAdmin, { department_id: dep1.id, name: "X", parent_id: foreign.id })).status, 400);
      assert.equal((await srv.post("/structure/positions", tAdmin, { department_id: dep1.id, name: "  " })).status, 400);
    });

    test("renaming works, and renaming onto a sibling's name is a 409", async () => {
      const dep = h.createDepartment();
      const a = h.createPosition(dep.id, "A");
      h.createPosition(dep.id, "B");
      assert.equal((await srv.put(`/structure/positions/${a.id}`, tAdmin, { name: "C" })).status, 200);
      assert.equal((await srv.put(`/structure/positions/${a.id}`, tAdmin, { name: "B" })).status, 409);
      // keeping its own name is not a conflict with itself
      assert.equal((await srv.put(`/structure/positions/${a.id}`, tAdmin, { name: "C" })).status, 200);
    });

    test("cannot move a position into itself or into its own descendant (no cycles)", async () => {
      const dep = h.createDepartment();
      const a = h.createPosition(dep.id, "A");
      const b = h.createPosition(dep.id, "B", a.id);
      const c = h.createPosition(dep.id, "C", b.id);
      assert.equal((await srv.put(`/structure/positions/${a.id}`, tAdmin, { parent_id: a.id })).status, 400);
      assert.equal((await srv.put(`/structure/positions/${a.id}`, tAdmin, { parent_id: c.id })).status, 400);
      assert.equal((await srv.put(`/structure/positions/${c.id}`, tAdmin, { parent_id: a.id })).status, 200);
      assert.equal((await srv.put(`/structure/positions/${c.id}`, tAdmin, { parent_id: null })).status, 200);
    });

    test("deleting a position removes its whole subtree and detaches users", async () => {
      const dep = h.createDepartment();
      const a = h.createPosition(dep.id, "A");
      const b = h.createPosition(dep.id, "B", a.id);
      const user = h.createUser({ department_id: dep.id, position_id: b.id });
      assert.equal((await srv.del(`/structure/positions/${a.id}`, tAdmin)).status, 200);
      assert.equal(h.db.prepare("SELECT COUNT(*) c FROM positions").get().c, 0);
      assert.equal(h.getUser(user.id).position_id, null);
    });
  });
});
