const express = require("express");
const { z } = require("zod");
const db = require("../db");
const { authMiddleware } = require("../auth");
const { fail } = require("../errors");
const { parseTabel, tabelTaken } = require("../models");

const router = express.Router();

const memberSchema = z.object({
  full_name: z.string().trim().min(2).max(128),
  post_title: z.string().trim().min(1).max(100),
});

/**
 * A master manages their OWN team (branches of foremen, operators or any custom post).
 * Account managers and super admins may open and edit anybody's team via ?owner_id=.
 */
function resolveOwner(req, res) {
  const me = req.currentUser;
  const wanted = req.query.owner_id ?? req.body?.owner_id;
  if (wanted === undefined || Number(wanted) === me.id) return me;

  if (!me.is_super_admin && !me.perm_manage_users) {
    fail(res, 403, "forbidden", "У вас нет прав для этого действия");
    return null;
  }
  const owner = db.prepare("SELECT * FROM users WHERE id = ?").get(Number(wanted));
  if (!owner) {
    fail(res, 404, "user_not_found", "Пользователь не найден");
    return null;
  }
  return owner;
}

function loadMember(id, ownerId) {
  return db.prepare("SELECT * FROM team_members WHERE id = ? AND owner_user_id = ?").get(id, ownerId);
}

function isDescendant(members, candidateId, ofId) {
  // true if `candidateId` is `ofId` itself or lies below it
  let node = members.find((m) => m.id === candidateId);
  const seen = new Set();
  while (node) {
    if (node.id === ofId) return true;
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    node = node.parent_id == null ? null : members.find((m) => m.id === node.parent_id);
  }
  return false;
}

router.use(authMiddleware);

router.get("/", (req, res) => {
  const owner = resolveOwner(req, res);
  if (!owner) return;
  const members = db.prepare("SELECT * FROM team_members WHERE owner_user_id = ? ORDER BY id").all(owner.id);
  res.json({ owner: { id: owner.id, tabel_number: owner.tabel_number, full_name: owner.full_name, post_title: owner.post_title }, members });
});

router.post("/", (req, res) => {
  const owner = resolveOwner(req, res);
  if (!owner) return;

  const tabel = parseTabel(req.body?.tabel_number);
  if (tabel === null) return fail(res, 400, "tabel_invalid", "Табельный номер — целое число в допустимом диапазоне");
  const parsed = memberSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 400, "member_invalid_input", "Укажите ФИО и должность");

  let parentId = null;
  const parent_id = req.body?.parent_id;
  if (parent_id !== undefined && parent_id !== null) {
    const parent = Number.isInteger(parent_id) ? loadMember(parent_id, owner.id) : null;
    if (!parent) return fail(res, 400, "parent_not_found", "Родительский пункт не найден в вашей команде");
    parentId = parent.id;
  }

  if (tabelTaken(tabel)) return fail(res, 409, "tabel_taken", "Этот табельный номер уже используется");

  const info = db
    .prepare("INSERT INTO team_members (owner_user_id, parent_id, tabel_number, full_name, post_title) VALUES (?, ?, ?, ?, ?)")
    .run(owner.id, parentId, tabel, parsed.data.full_name, parsed.data.post_title);
  res.status(201).json({ member: db.prepare("SELECT * FROM team_members WHERE id = ?").get(info.lastInsertRowid) });
});

router.put("/:id", (req, res) => {
  const owner = resolveOwner(req, res);
  if (!owner) return;
  const member = loadMember(req.params.id, owner.id);
  if (!member) return fail(res, 404, "member_not_found", "Сотрудник не найден");

  const parsed = memberSchema.partial().safeParse(req.body || {});
  if (!parsed.success) return fail(res, 400, "member_invalid_input", "Некорректные данные сотрудника");

  let tabel = member.tabel_number;
  if (req.body?.tabel_number !== undefined) {
    const t = parseTabel(req.body.tabel_number);
    if (t === null) return fail(res, 400, "tabel_invalid", "Табельный номер — целое число в допустимом диапазоне");
    if (tabelTaken(t, { exceptMemberId: member.id })) return fail(res, 409, "tabel_taken", "Этот табельный номер уже используется");
    tabel = t;
  }

  let parentId = member.parent_id;
  if (req.body?.parent_id !== undefined) {
    if (req.body.parent_id === null) {
      parentId = null;
    } else {
      const all = db.prepare("SELECT * FROM team_members WHERE owner_user_id = ?").all(owner.id);
      const candidate = Number.isInteger(req.body.parent_id) ? all.find((m) => m.id === req.body.parent_id) : null;
      if (!candidate) return fail(res, 400, "parent_not_found", "Родительский пункт не найден в вашей команде");
      if (isDescendant(all, candidate.id, member.id)) {
        return fail(res, 400, "parent_cycle", "Нельзя переместить сотрудника под самого себя или под своего подчинённого");
      }
      parentId = candidate.id;
    }
  }

  db.prepare(
    "UPDATE team_members SET tabel_number = ?, full_name = ?, post_title = ?, parent_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(tabel, parsed.data.full_name ?? member.full_name, parsed.data.post_title ?? member.post_title, parentId, member.id);
  res.json({ member: db.prepare("SELECT * FROM team_members WHERE id = ?").get(member.id) });
});

// Removing a person never removes the people below them: their subordinates move up one level.
// (Kaizens already written keep a copy of the author's details, so nothing is lost.)
router.delete("/:id", (req, res) => {
  const owner = resolveOwner(req, res);
  if (!owner) return;
  const member = loadMember(req.params.id, owner.id);
  if (!member) return fail(res, 404, "member_not_found", "Сотрудник не найден");

  db.exec("BEGIN");
  try {
    db.prepare("UPDATE team_members SET parent_id = ? WHERE parent_id = ?").run(member.parent_id, member.id);
    db.prepare("DELETE FROM team_members WHERE id = ?").run(member.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  res.json({ ok: true });
});

module.exports = router;
