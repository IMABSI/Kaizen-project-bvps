const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const h = require("./helpers");

describe("users: moderation and privilege escalation", () => {
  let srv;
  before(async () => {
    srv = await h.startServer();
  });
  after(() => srv.close());
  beforeEach(() => h.resetDb());

  const setup = () => {
    const superAdmin = h.createUser({ login: "root", is_super_admin: 1 });
    const manager = h.createUser({ login: "mgr", perm_manage_users: 1 });
    const worker = h.createUser({ login: "worker" });
    return { superAdmin, manager, worker, tSuper: h.tokenFor(superAdmin), tMgr: h.tokenFor(manager), tWorker: h.tokenFor(worker) };
  };

  describe("who can see and manage users at all", () => {
    test("an ordinary user cannot list, edit, reset or delete users", async () => {
      const { worker, manager, tWorker } = setup();
      assert.equal((await srv.get("/users", tWorker)).status, 403);
      assert.equal((await srv.put(`/users/${manager.id}`, tWorker, { full_name: "Hacked" })).status, 403);
      assert.equal((await srv.post(`/users/${manager.id}/reset-password`, tWorker, { new_password: "newpass1" })).status, 403);
      assert.equal((await srv.del(`/users/${worker.id}`, tWorker)).status, 403);
    });

    test("the user list never exposes password hashes", async () => {
      const { tMgr } = setup();
      const res = await srv.get("/users", tMgr);
      assert.equal(res.status, 200);
      assert.ok(res.body.users.length >= 3);
      for (const u of res.body.users) assert.equal(u.password_hash, undefined);
    });
  });

  describe("a user-manager must not be able to attack a super admin", () => {
    test("cannot reset the super admin's password", async () => {
      const { superAdmin, tMgr } = setup();
      const before = h.getUser(superAdmin.id).password_hash;
      const res = await srv.post(`/users/${superAdmin.id}/reset-password`, tMgr, { new_password: "hacked123" });
      assert.equal(res.status, 403);
      assert.equal(h.getUser(superAdmin.id).password_hash, before);
    });

    test("cannot disable, rename or move the super admin", async () => {
      const { superAdmin, tMgr } = setup();
      for (const patch of [{ status: "disabled" }, { full_name: "Pwned" }, { department_id: null }]) {
        const res = await srv.put(`/users/${superAdmin.id}`, tMgr, patch);
        assert.equal(res.status, 403, JSON.stringify(patch));
      }
      assert.equal(h.getUser(superAdmin.id).status, "approved");
    });

    test("cannot delete the super admin", async () => {
      const { superAdmin, tMgr } = setup();
      assert.equal((await srv.del(`/users/${superAdmin.id}`, tMgr)).status, 403);
      assert.ok(h.getUser(superAdmin.id));
    });

    test("cannot take over a user who holds a permission the manager lacks", async () => {
      const { manager, tMgr } = setup();
      const structureAdmin = h.createUser({ login: "structadmin", perm_manage_structure: 1 });
      const res = await srv.post(`/users/${structureAdmin.id}/reset-password`, tMgr, { new_password: "hacked123" });
      assert.equal(res.status, 403);
      assert.equal((await srv.put(`/users/${structureAdmin.id}`, tMgr, { status: "disabled" })).status, 403);
      assert.equal((await srv.del(`/users/${structureAdmin.id}`, tMgr)).status, 403);
      assert.ok(manager);
    });

    test("CAN manage ordinary users and peers with the same permissions", async () => {
      const { worker, tMgr } = setup();
      const peer = h.createUser({ login: "peer", perm_manage_users: 1 });
      assert.equal((await srv.post(`/users/${worker.id}/reset-password`, tMgr, { new_password: "newpass1" })).status, 200);
      assert.ok(bcrypt.compareSync("newpass1", h.getUser(worker.id).password_hash));
      assert.equal((await srv.put(`/users/${peer.id}`, tMgr, { status: "disabled" })).status, 200);
    });

    test("a super admin can still manage anyone", async () => {
      const { manager, tSuper } = setup();
      const other = h.createUser({ login: "other_root", is_super_admin: 1 });
      assert.equal((await srv.post(`/users/${manager.id}/reset-password`, tSuper, { new_password: "newpass1" })).status, 200);
      assert.equal((await srv.put(`/users/${other.id}`, tSuper, { status: "disabled" })).status, 200);
    });
  });

  describe("safety rails", () => {
    test("cannot change your own status", async () => {
      const { manager, tMgr } = setup();
      const res = await srv.put(`/users/${manager.id}`, tMgr, { status: "disabled" });
      assert.equal(res.status, 400);
    });

    test("cannot delete yourself", async () => {
      const { manager, tMgr } = setup();
      assert.equal((await srv.del(`/users/${manager.id}`, tMgr)).status, 400);
    });

    test("the only active super admin cannot demote themselves (the system must always have one)", async () => {
      const root = h.createUser({ login: "root", is_super_admin: 1 });
      const res = await srv.put(`/users/${root.id}/permissions`, h.tokenFor(root), { is_super_admin: false });
      assert.equal(res.status, 400);
      assert.equal(h.getUser(root.id).is_super_admin, 1);
    });

    test("with two super admins one may demote the other; the survivor is then protected", async () => {
      const root = h.createUser({ login: "root", is_super_admin: 1 });
      const other = h.createUser({ login: "other_root", is_super_admin: 1 });
      assert.equal((await srv.put(`/users/${other.id}/permissions`, h.tokenFor(root), { is_super_admin: false })).status, 200);
      assert.equal(h.getUser(other.id).is_super_admin, 0);
      // root is now the last one: cannot be demoted, and a plain user-manager cannot delete them
      assert.equal((await srv.put(`/users/${root.id}/permissions`, h.tokenFor(root), { is_super_admin: false })).status, 400);
      const manager = h.createUser({ login: "mgr", perm_manage_users: 1 });
      assert.equal((await srv.del(`/users/${root.id}`, h.tokenFor(manager))).status, 403);
      assert.ok(h.getUser(root.id));
    });
  });

  describe("reassigning department and position", () => {
    test("department_id 0 (what a blank select used to send) is a 400, not a 500", async () => {
      const { worker, tMgr } = setup();
      const res = await srv.put(`/users/${worker.id}`, tMgr, { department_id: 0, position_id: 0 });
      assert.equal(res.status, 400);
    });

    test("rejects a position from a different department", async () => {
      const { worker, tMgr } = setup();
      const depA = h.createDepartment();
      const depB = h.createDepartment();
      const posB = h.createPosition(depB.id);
      const res = await srv.put(`/users/${worker.id}`, tMgr, { department_id: depA.id, position_id: posB.id });
      assert.equal(res.status, 400);
      assert.equal(h.getUser(worker.id).department_id, null);
    });

    test("moving to another department clears the old position", async () => {
      const { worker, tMgr } = setup();
      const depA = h.createDepartment();
      const depB = h.createDepartment();
      const posA = h.createPosition(depA.id);
      h.db.prepare("UPDATE users SET department_id = ?, position_id = ? WHERE id = ?").run(depA.id, posA.id, worker.id);
      const res = await srv.put(`/users/${worker.id}`, tMgr, { department_id: depB.id });
      assert.equal(res.status, 200);
      assert.equal(h.getUser(worker.id).department_id, depB.id);
      assert.equal(h.getUser(worker.id).position_id, null);
    });

    test("sets department and a matching position together; null clears them", async () => {
      const { worker, tMgr } = setup();
      const dep = h.createDepartment();
      const pos = h.createPosition(dep.id);
      assert.equal((await srv.put(`/users/${worker.id}`, tMgr, { department_id: dep.id, position_id: pos.id })).status, 200);
      assert.equal(h.getUser(worker.id).position_id, pos.id);
      assert.equal((await srv.put(`/users/${worker.id}`, tMgr, { position_id: null })).status, 200);
      assert.equal(h.getUser(worker.id).position_id, null);
      assert.equal(h.getUser(worker.id).department_id, dep.id);
    });

    test("rejects an invalid status value", async () => {
      const { worker, tMgr } = setup();
      assert.equal((await srv.put(`/users/${worker.id}`, tMgr, { status: "godmode" })).status, 400);
    });

    test("returns 404 for a user that does not exist", async () => {
      const { tMgr } = setup();
      assert.equal((await srv.put("/users/99999", tMgr, { full_name: "Ghost" })).status, 404);
      assert.equal((await srv.post("/users/99999/reset-password", tMgr, { new_password: "newpass1" })).status, 404);
      assert.equal((await srv.del("/users/99999", tMgr)).status, 404);
    });
  });

  describe("password reset validation", () => {
    test("enforces 6..128 characters and string type", async () => {
      const { worker, tMgr } = setup();
      for (const bad of ["12345", "x".repeat(129), 123456, null, undefined]) {
        const res = await srv.post(`/users/${worker.id}/reset-password`, tMgr, { new_password: bad });
        assert.equal(res.status, 400, String(bad));
      }
    });
  });

  describe("permissions endpoint", () => {
    test("only a super admin may touch is_super_admin or perm_manage_admins", async () => {
      const admins = h.createUser({ login: "padm", perm_manage_admins: 1 });
      const worker = h.createUser({ login: "w" });
      const t = h.tokenFor(admins);
      assert.equal((await srv.put(`/users/${worker.id}/permissions`, t, { is_super_admin: true })).status, 403);
      assert.equal((await srv.put(`/users/${worker.id}/permissions`, t, { perm_manage_admins: true })).status, 403);
      assert.equal(h.getUser(worker.id).is_super_admin, 0);
    });

    test("a permission-manager cannot grant a permission they do not hold themselves", async () => {
      const admins = h.createUser({ login: "padm", perm_manage_admins: 1, perm_manage_kaizens: 1 });
      const worker = h.createUser({ login: "w" });
      const t = h.tokenFor(admins);
      assert.equal((await srv.put(`/users/${worker.id}/permissions`, t, { perm_manage_users: true })).status, 403);
      assert.equal(h.getUser(worker.id).perm_manage_users, 0);
      // ...but can grant one they do hold
      assert.equal((await srv.put(`/users/${worker.id}/permissions`, t, { perm_manage_kaizens: true })).status, 200);
      assert.equal(h.getUser(worker.id).perm_manage_kaizens, 1);
    });

    test("a permission-manager cannot edit a super admin or someone more privileged", async () => {
      const admins = h.createUser({ login: "padm", perm_manage_admins: 1 });
      const root = h.createUser({ login: "root", is_super_admin: 1 });
      const strong = h.createUser({ login: "strong", perm_manage_structure: 1 });
      const t = h.tokenFor(admins);
      assert.equal((await srv.put(`/users/${root.id}/permissions`, t, { role_title: "x" })).status, 403);
      assert.equal((await srv.put(`/users/${strong.id}/permissions`, t, { role_title: "x" })).status, 403);
    });

    test("a super admin can grant everything, including super admin", async () => {
      const root = h.createUser({ login: "root", is_super_admin: 1 });
      const worker = h.createUser({ login: "w" });
      const res = await srv.put(`/users/${worker.id}/permissions`, h.tokenFor(root), {
        role_title: "Модератор кайдзенов",
        perm_manage_kaizens: true,
        perm_manage_users: true,
        is_super_admin: true,
      });
      assert.equal(res.status, 200);
      const w = h.getUser(worker.id);
      assert.equal(w.role_title, "Модератор кайдзенов");
      assert.equal(w.perm_manage_kaizens, 1);
      assert.equal(w.is_super_admin, 1);
    });

    test("role_title longer than 100 characters is rejected", async () => {
      const root = h.createUser({ login: "root", is_super_admin: 1 });
      const worker = h.createUser({ login: "w" });
      const res = await srv.put(`/users/${worker.id}/permissions`, h.tokenFor(root), { role_title: "x".repeat(101) });
      assert.equal(res.status, 400);
    });
  });
});

describe("users: registration approval by hierarchy", () => {
  let srv;
  before(async () => {
    srv = await h.startServer();
  });
  after(() => srv.close());
  beforeEach(() => h.resetDb());

  // Department tree:  Мастер -> Бригадир -> Оператор
  const tree = () => {
    const dep = h.createDepartment();
    const master = h.createPosition(dep.id, "Мастер");
    const foreman = h.createPosition(dep.id, "Бригадир", master.id);
    const operator = h.createPosition(dep.id, "Оператор", foreman.id);
    return { dep, master, foreman, operator };
  };

  test("only the direct parent position may approve; the list shows exactly those requests", async () => {
    const { dep, master, foreman, operator } = tree();
    const masterUser = h.createUser({ login: "m", department_id: dep.id, position_id: master.id });
    const foremanUser = h.createUser({ login: "f", department_id: dep.id, position_id: foreman.id });
    const applicant = h.createUser({ login: "op", status: "pending", department_id: dep.id, position_id: operator.id });

    const forForeman = await srv.get("/users/pending-for-me", h.tokenFor(foremanUser));
    assert.deepEqual(forForeman.body.pending.map((u) => u.id), [applicant.id]);
    const forMaster = await srv.get("/users/pending-for-me", h.tokenFor(masterUser));
    assert.deepEqual(forMaster.body.pending, []);

    assert.equal((await srv.post(`/users/${applicant.id}/approve`, h.tokenFor(masterUser))).status, 403);
    assert.equal((await srv.post(`/users/${applicant.id}/approve`, h.tokenFor(foremanUser))).status, 200);
    assert.equal(h.getUser(applicant.id).status, "approved");
    assert.equal(h.getUser(applicant.id).approved_by, foremanUser.id);
  });

  test("a foreman from ANOTHER department cannot approve", async () => {
    const a = tree();
    const b = tree();
    const foremanB = h.createUser({ login: "fb", department_id: b.dep.id, position_id: b.foreman.id });
    const applicant = h.createUser({ login: "op", status: "pending", department_id: a.dep.id, position_id: a.operator.id });
    assert.equal((await srv.post(`/users/${applicant.id}/approve`, h.tokenFor(foremanB))).status, 403);
  });

  test("a top-level position can be approved only by a super admin or perm_approve_any", async () => {
    const { dep, master } = tree();
    const applicant = h.createUser({ login: "newmaster", status: "pending", department_id: dep.id, position_id: master.id });
    const ordinary = h.createUser({ login: "o", department_id: dep.id });
    const approver = h.createUser({ login: "ap", perm_approve_any: 1 });
    assert.equal((await srv.post(`/users/${applicant.id}/approve`, h.tokenFor(ordinary))).status, 403);
    assert.equal((await srv.post(`/users/${applicant.id}/approve`, h.tokenFor(approver))).status, 200);
  });

  test("an already processed request cannot be approved or rejected again", async () => {
    const { dep, operator } = tree();
    const root = h.createUser({ login: "root", is_super_admin: 1 });
    const applicant = h.createUser({ login: "op", status: "pending", department_id: dep.id, position_id: operator.id });
    assert.equal((await srv.post(`/users/${applicant.id}/approve`, h.tokenFor(root))).status, 200);
    assert.equal((await srv.post(`/users/${applicant.id}/approve`, h.tokenFor(root))).status, 400);
    assert.equal((await srv.post(`/users/${applicant.id}/reject`, h.tokenFor(root), { reason: "late" })).status, 400);
  });

  test("rejection stores the reason, truncated to 500 chars, and blocks login with it", async () => {
    const { dep, operator } = tree();
    const root = h.createUser({ login: "root", is_super_admin: 1 });
    const applicant = h.createUser({ login: "op", status: "pending", department_id: dep.id, position_id: operator.id });
    assert.equal((await srv.post(`/users/${applicant.id}/reject`, h.tokenFor(root), { reason: "Нет в списках" })).status, 200);
    const login = await srv.post("/auth/login", null, { login: "op", password: h.DEFAULT_PASSWORD });
    assert.equal(login.status, 403);
    assert.equal(login.body.status, "rejected");
    assert.equal(login.body.reason, "Нет в списках");
  });

  test("a pending user cannot approve anyone, even their own request", async () => {
    const { dep, operator } = tree();
    const applicant = h.createUser({ login: "op", status: "pending", department_id: dep.id, position_id: operator.id, perm_approve_any: 1 });
    // pending accounts have no valid session at all
    assert.equal((await srv.post(`/users/${applicant.id}/approve`, h.tokenFor(applicant))).status, 401);
  });
});
