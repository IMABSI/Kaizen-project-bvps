const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { canBypassHierarchy, isEligibleApprover, listEligibleApproverUsers } = require("../src/hierarchy");

describe("hierarchy rules (unit)", () => {
  beforeEach(() => h.resetDb());

  const tree = () => {
    const dep = h.createDepartment();
    const master = h.createPosition(dep.id, "Мастер");
    const foreman = h.createPosition(dep.id, "Бригадир", master.id);
    const operator = h.createPosition(dep.id, "Оператор", foreman.id);
    return { dep, master, foreman, operator };
  };

  test("canBypassHierarchy: super admin or perm_approve_any, and only when approved", () => {
    assert.equal(canBypassHierarchy(h.createUser({ is_super_admin: 1 })), true);
    assert.equal(canBypassHierarchy(h.createUser({ perm_approve_any: 1 })), true);
    assert.equal(canBypassHierarchy(h.createUser({ is_super_admin: 1, status: "disabled" })), false);
    assert.equal(canBypassHierarchy(h.createUser()), false);
    assert.equal(canBypassHierarchy(null), false);
  });

  test("isEligibleApprover: the occupant of the direct parent position, in the same department", () => {
    const { dep, master, foreman, operator } = tree();
    const foremanUser = h.createUser({ department_id: dep.id, position_id: foreman.id });
    const masterUser = h.createUser({ department_id: dep.id, position_id: master.id });
    assert.equal(isEligibleApprover(foremanUser, dep.id, operator), true);
    assert.equal(isEligibleApprover(masterUser, dep.id, operator), false, "grandparent is not enough");
    assert.equal(isEligibleApprover(foremanUser, dep.id, foreman), false, "same level is not enough");
  });

  test("isEligibleApprover: a pending or disabled parent-position holder does not count", () => {
    const { dep, foreman, operator } = tree();
    for (const status of ["pending", "rejected", "disabled"]) {
      const u = h.createUser({ department_id: dep.id, position_id: foreman.id, status });
      assert.equal(isEligibleApprover(u, dep.id, operator), false, status);
    }
  });

  test("isEligibleApprover: same position id but another department does not count", () => {
    const { dep, foreman, operator } = tree();
    const otherDep = h.createDepartment();
    const u = h.createUser({ department_id: otherDep.id, position_id: foreman.id });
    assert.equal(isEligibleApprover(u, dep.id, operator), false);
  });

  test("isEligibleApprover: a top-level position needs a bypass holder; missing position never matches", () => {
    const { dep, master } = tree();
    assert.equal(isEligibleApprover(h.createUser({ department_id: dep.id }), dep.id, master), false);
    assert.equal(isEligibleApprover(h.createUser({ perm_approve_any: 1 }), dep.id, master), true);
    assert.equal(isEligibleApprover(h.createUser({ is_super_admin: 1 }), dep.id, null), true);
    assert.equal(isEligibleApprover(h.createUser(), dep.id, null), false);
    assert.equal(isEligibleApprover(null, dep.id, master), false);
  });

  test("listEligibleApproverUsers: direct superiors plus bypass holders, without duplicates", () => {
    const { dep, foreman, operator } = tree();
    const foremanUser = h.createUser({ department_id: dep.id, position_id: foreman.id });
    const rootUser = h.createUser({ is_super_admin: 1 });
    const bypassForeman = h.createUser({ department_id: dep.id, position_id: foreman.id, perm_approve_any: 1 });
    h.createUser({ department_id: dep.id, position_id: foreman.id, status: "pending" });
    const ids = listEligibleApproverUsers(dep.id, operator).map((u) => u.id).sort();
    assert.deepEqual(ids, [foremanUser.id, rootUser.id, bypassForeman.id].sort());
  });

  test("listEligibleApproverUsers: for a top-level position only bypass holders", () => {
    const { dep, master } = tree();
    h.createUser({ department_id: dep.id, position_id: master.id });
    const root = h.createUser({ is_super_admin: 1 });
    assert.deepEqual(listEligibleApproverUsers(dep.id, master).map((u) => u.id), [root.id]);
  });
});
