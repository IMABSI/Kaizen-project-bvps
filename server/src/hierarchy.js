const db = require("./db");

/**
 * Returns the list of users allowed to approve a pending registration for the given
 * department + position (a node in that department's position tree).
 *
 * Rule: whoever occupies the DIRECT PARENT node of the target position, within the same
 * department, and is themselves approved, may approve. A super admin, or anyone granted
 * the perm_approve_any permission, may approve any registration regardless of hierarchy.
 * If the position has no parent (it's a top-level node of the department), only a super
 * admin / perm_approve_any holder can approve it.
 */
function canBypassHierarchy(user) {
  return !!(user && user.status === "approved" && (user.is_super_admin || user.perm_approve_any));
}

function isEligibleApprover(approverUser, targetDepartmentId, targetPosition) {
  if (!approverUser || approverUser.status !== "approved") return false;
  if (canBypassHierarchy(approverUser)) return true;
  if (!targetPosition) return false;
  if (targetPosition.parent_id === null || targetPosition.parent_id === undefined) return false; // top of tree: admin-only
  if (approverUser.department_id !== targetDepartmentId) return false;
  return approverUser.position_id === targetPosition.parent_id;
}

function listEligibleApproverUsers(targetDepartmentId, targetPosition) {
  const bypassUsers = db
    .prepare("SELECT * FROM users WHERE status = 'approved' AND (is_super_admin = 1 OR perm_approve_any = 1)")
    .all();

  if (!targetPosition || targetPosition.parent_id === null || targetPosition.parent_id === undefined) {
    return bypassUsers;
  }

  const directSuperiors = db
    .prepare("SELECT * FROM users WHERE department_id = ? AND position_id = ? AND status = 'approved'")
    .all(targetDepartmentId, targetPosition.parent_id);

  const seen = new Set();
  return [...directSuperiors, ...bypassUsers].filter((u) => {
    if (seen.has(u.id)) return false;
    seen.add(u.id);
    return true;
  });
}

module.exports = { canBypassHierarchy, isEligibleApprover, listEligibleApproverUsers };
