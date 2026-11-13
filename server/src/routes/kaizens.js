const express = require("express");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { z } = require("zod");
const db = require("../db");
const config = require("../config");
const { authMiddleware } = require("../auth");
const { fail } = require("../errors");
const { parseUtc, toSqlite, addHours } = require("../time");
const { getVisibility } = require("./settings");

const router = express.Router();
router.use(authMiddleware);

// ---------------------------------------------------------------- validation

const text = (max) => z.string().trim().max(max);
const optText = (max) => text(max).nullish().transform((v) => (v ? v : null));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)));
const optDate = date.nullish().transform((v) => v || null);
const money = z.number().finite().min(0).max(1e13).nullish().transform((v) => v ?? null);
const tags = (allowed) =>
  z.array(z.enum(allowed)).max(allowed.length).transform((a) => [...new Set(a)]);

const measureSchema = z.object({
  name: text(120).min(1),
  unit: optText(30),
  before_value: z.number().finite().min(-1e12).max(1e12),
  after_value: z.number().finite().min(-1e12).max(1e12),
  better: z.enum(config.BETTER).default("lower"),
});

const fields = {
  title: text(200).min(3),
  category: z.enum(config.CATEGORIES),
  area: optText(150),
  equipment: optText(150),
  noticed_on: optDate,
  problem_text: text(5000).min(3),
  before_text: optText(5000),
  after_text: text(5000).min(3),
  benefits_text: optText(5000),
  conclusion_text: optText(5000),
  wastes: tags(config.WASTES).default([]),
  effects: tags(config.EFFECTS).default([]),
  impl_status: z.enum(config.IMPL_STATUSES).default("idea"),
  implemented_on: optDate,
  effort: z.enum(config.EFFORTS).nullish().transform((v) => v ?? null),
  currency: z.enum(config.CURRENCIES).default("UZS"),
  cost_amount: money,
  saving_month_amount: money,
  participants: optText(500),
  measures: z.array(measureSchema).max(config.MAX_MEASURES).default([]),
};
const createSchema = z.object({ ...fields, member_id: z.number().int().positive().nullish() });
const updateSchema = z.object(fields).partial();

function invalid(res, parsed) {
  const issue = parsed.error.issues[0];
  return fail(res, 400, "kaizen_invalid_input", "Проверьте заполнение формы", { field: issue.path.join(".") || null });
}

// ---------------------------------------------------------------- access rules

const canManage = (u) => !!(u.is_super_admin || u.perm_manage_kaizens);

function seesEverything(u) {
  return canManage(u) || !!u.perm_view_kaizens || getVisibility() === "all";
}

function canView(u, k) {
  if (k.deleted_at && !canManage(u)) return false;
  if (seesEverything(u)) return true;
  if (k.author_id === u.id) return true;
  return k.department_id != null && k.department_id === u.department_id;
}

/** Author edits within 24h of creation (or until an admin-granted deadline). Managers: always. */
function editDeadline(k) {
  const base = addHours(parseUtc(k.created_at) || new Date(0), config.EDIT_WINDOW_HOURS);
  const extra = parseUtc(k.edit_allowed_until);
  return extra && extra > base ? extra : base;
}

function canEdit(u, k) {
  if (k.deleted_at) return false;
  if (canManage(u)) return true;
  return k.author_id === u.id && new Date() < editDeadline(k);
}

// ---------------------------------------------------------------- serialisation

function parseList(s) {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function measureWithChange(m) {
  const change = m.before_value === 0 ? null : ((m.after_value - m.before_value) / Math.abs(m.before_value)) * 100;
  const improved =
    m.after_value === m.before_value ? null : m.better === "lower" ? m.after_value < m.before_value : m.after_value > m.before_value;
  return { ...m, change_pct: change === null ? null : Math.round(change * 10) / 10, improved };
}

function photoMeta(p) {
  return { id: p.id, block: p.block, position: p.position, caption: p.caption, mime: p.mime, size: p.size };
}

function serialize(k, me) {
  const measures = db.prepare("SELECT * FROM kaizen_measures WHERE kaizen_id = ? ORDER BY position, id").all(k.id);
  const photos = db.prepare("SELECT * FROM kaizen_photos WHERE kaizen_id = ? ORDER BY block, position, id").all(k.id);
  const history = db.prepare("SELECT * FROM kaizen_status_history WHERE kaizen_id = ? ORDER BY changed_at, id").all(k.id);
  const { edit_allowed_until, ...rest } = k;
  void edit_allowed_until;
  return {
    ...rest,
    number: k.id,
    wastes: parseList(k.wastes),
    effects: parseList(k.effects),
    measures: measures.map(measureWithChange),
    photos: photos.map(photoMeta),
    history,
    can_edit: canEdit(me, k),
    edit_deadline: k.deleted_at ? null : toSqlite(editDeadline(k)),
  };
}

function summary(k) {
  return {
    id: k.id,
    number: k.id,
    title: k.title,
    category: k.category,
    status: k.status,
    impl_status: k.impl_status,
    operator_tabel: k.operator_tabel,
    operator_name: k.operator_name,
    submitter_name: k.submitter_name,
    department_id: k.department_id,
    department_name: k.department_name,
    area: k.area,
    created_at: k.created_at,
    deleted_at: k.deleted_at,
    photo_count: k.photo_count ?? 0,
  };
}

function loadKaizen(id) {
  if (!/^\d+$/.test(String(id))) return null;
  return db.prepare("SELECT * FROM kaizens WHERE id = ?").get(Number(id)) || null;
}

function addHistory(kaizenId, status, userId, comment) {
  db.prepare("INSERT INTO kaizen_status_history (kaizen_id, status, changed_by, comment) VALUES (?, ?, ?, ?)").run(
    kaizenId,
    status,
    userId,
    comment || null
  );
}

function replaceMeasures(kaizenId, measures) {
  db.prepare("DELETE FROM kaizen_measures WHERE kaizen_id = ?").run(kaizenId);
  const ins = db.prepare(
    "INSERT INTO kaizen_measures (kaizen_id, position, name, unit, before_value, after_value, better) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  measures.forEach((m, i) => ins.run(kaizenId, i, m.name, m.unit, m.before_value, m.after_value, m.better));
}

function inTransaction(fn) {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// ---------------------------------------------------------------- list / create / read

router.get("/", (req, res) => {
  const me = req.currentUser;
  const where = [];
  const args = [];

  if (!canManage(me) || req.query.include_deleted !== "1") where.push("k.deleted_at IS NULL");
  if (!seesEverything(me)) {
    where.push("(k.author_id = ? OR (k.department_id IS NOT NULL AND k.department_id = ?))");
    args.push(me.id, me.department_id ?? -1);
  }
  if (req.query.mine === "1") {
    where.push("k.author_id = ?");
    args.push(me.id);
  }
  if (config.STATUSES.includes(req.query.status)) {
    where.push("k.status = ?");
    args.push(req.query.status);
  }
  if (config.CATEGORIES.includes(req.query.category)) {
    where.push("k.category = ?");
    args.push(req.query.category);
  }
  if (/^\d+$/.test(String(req.query.department_id ?? ""))) {
    where.push("k.department_id = ?");
    args.push(Number(req.query.department_id));
  }
  const q = String(req.query.q ?? "").trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    where.push(
      "(k.title LIKE ? ESCAPE '\\' OR k.operator_name LIKE ? ESCAPE '\\' OR CAST(k.operator_tabel AS TEXT) = ? OR CAST(k.id AS TEXT) = ?)"
    );
    args.push(like, like, q.replace(/^#/, ""), q.replace(/^#/, ""));
  }

  const rows = db
    .prepare(
      `SELECT k.*, (SELECT COUNT(*) FROM kaizen_photos p WHERE p.kaizen_id = k.id) AS photo_count
       FROM kaizens k ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY k.id DESC LIMIT 500`
    )
    .all(...args);
  res.json({ kaizens: rows.map(summary) });
});

router.post("/", (req, res) => {
  const me = req.currentUser;
  const parsed = createSchema.safeParse(req.body || {});
  if (!parsed.success) return invalid(res, parsed);
  const d = parsed.data;

  // Who is the author of the idea: the master himself, or one of the people in his own team.
  let operator = { id: null, tabel: me.tabel_number, name: me.full_name, post: me.post_title };
  if (d.member_id != null) {
    const m = db.prepare("SELECT * FROM team_members WHERE id = ? AND owner_user_id = ?").get(d.member_id, me.id);
    if (!m) return fail(res, 400, "member_not_found", "Сотрудник не найден в вашей команде");
    operator = { id: m.id, tabel: m.tabel_number, name: m.full_name, post: m.post_title };
  }
  const department = me.department_id ? db.prepare("SELECT name FROM departments WHERE id = ?").get(me.department_id) : null;

  const id = inTransaction(() => {
    const info = db
      .prepare(
        `INSERT INTO kaizens (
           author_id, submitter_tabel, submitter_name, submitter_post, department_id, department_name,
           operator_member_id, operator_tabel, operator_name, operator_post,
           title, category, area, equipment, noticed_on,
           problem_text, before_text, after_text, benefits_text, conclusion_text,
           wastes, effects, impl_status, implemented_on, effort, currency, cost_amount, saving_month_amount, participants)
         VALUES (?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?,?,?,?)`
      )
      .run(
        me.id, me.tabel_number, me.full_name, me.post_title, me.department_id, department?.name ?? null,
        operator.id, operator.tabel, operator.name, operator.post,
        d.title, d.category, d.area, d.equipment, d.noticed_on,
        d.problem_text, d.before_text, d.after_text, d.benefits_text, d.conclusion_text,
        JSON.stringify(d.wastes), JSON.stringify(d.effects), d.impl_status, d.implemented_on, d.effort, d.currency,
        d.cost_amount, d.saving_month_amount, d.participants
      );
    const kid = Number(info.lastInsertRowid);
    replaceMeasures(kid, d.measures);
    addHistory(kid, "sent", me.id, null);
    return kid;
  });

  res.status(201).json({ kaizen: serialize(loadKaizen(id), me) });
});

router.get("/:id", (req, res) => {
  const me = req.currentUser;
  const k = loadKaizen(req.params.id);
  if (!k) return fail(res, 404, "kaizen_not_found", "Кайдзен не найден");
  if (!canView(me, k)) return fail(res, 403, "forbidden", "У вас нет доступа к этому кайдзену");
  res.json({ kaizen: serialize(k, me) });
});

// ---------------------------------------------------------------- edit / status / delete

router.put("/:id", (req, res) => {
  const me = req.currentUser;
  const k = loadKaizen(req.params.id);
  if (!k || (k.deleted_at && !canManage(me))) return fail(res, 404, "kaizen_not_found", "Кайдзен не найден");
  if (!canView(me, k)) return fail(res, 403, "forbidden", "У вас нет доступа к этому кайдзену");
  if (!canEdit(me, k)) {
    return fail(res, 403, "edit_window_closed", "Срок редактирования истёк. Попросите администратора разрешить правку.");
  }
  const parsed = updateSchema.safeParse(req.body || {});
  if (!parsed.success) return invalid(res, parsed);
  const d = parsed.data;

  const columns = {
    title: d.title, category: d.category, area: d.area, equipment: d.equipment, noticed_on: d.noticed_on,
    problem_text: d.problem_text, before_text: d.before_text, after_text: d.after_text,
    benefits_text: d.benefits_text, conclusion_text: d.conclusion_text,
    wastes: d.wastes === undefined ? undefined : JSON.stringify(d.wastes),
    effects: d.effects === undefined ? undefined : JSON.stringify(d.effects),
    impl_status: d.impl_status, implemented_on: d.implemented_on, effort: d.effort, currency: d.currency,
    cost_amount: d.cost_amount, saving_month_amount: d.saving_month_amount, participants: d.participants,
  };
  const keys = Object.keys(columns).filter((c) => columns[c] !== undefined && Object.hasOwn(req.body, c));

  inTransaction(() => {
    if (keys.length) {
      db.prepare(`UPDATE kaizens SET ${keys.map((c) => `${c} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`).run(
        ...keys.map((c) => columns[c]),
        k.id
      );
    }
    if (d.measures !== undefined) {
      replaceMeasures(k.id, d.measures);
      db.prepare("UPDATE kaizens SET updated_at = datetime('now') WHERE id = ?").run(k.id);
    }
  });
  res.json({ kaizen: serialize(loadKaizen(k.id), me) });
});

const statusSchema = z.object({ status: z.enum(config.STATUSES), comment: text(1000).nullish() });

router.put("/:id/status", (req, res) => {
  const me = req.currentUser;
  if (!canManage(me)) return fail(res, 403, "forbidden", "У вас нет прав изменять статус кайдзенов");
  const parsed = statusSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 400, "invalid_status", "Недопустимый статус или слишком длинный комментарий");
  const k = loadKaizen(req.params.id);
  if (!k || k.deleted_at) return fail(res, 404, "kaizen_not_found", "Кайдзен не найден");

  const { status, comment } = parsed.data;
  inTransaction(() => {
    db.prepare("UPDATE kaizens SET status = ?, admin_comment = COALESCE(?, admin_comment), updated_at = datetime('now') WHERE id = ?").run(
      status,
      comment || null,
      k.id
    );
    addHistory(k.id, status, me.id, comment);
  });
  res.json({ kaizen: serialize(loadKaizen(k.id), me) });
});

router.post("/:id/allow-edit", (req, res) => {
  const me = req.currentUser;
  if (!canManage(me)) return fail(res, 403, "forbidden", "У вас нет прав разрешать редактирование");
  const hours = req.body?.hours;
  if (!Number.isInteger(hours) || hours < 1 || hours > config.MAX_EXTRA_EDIT_HOURS) {
    return fail(res, 400, "invalid_hours", `Укажите число часов от 1 до ${config.MAX_EXTRA_EDIT_HOURS}`);
  }
  const k = loadKaizen(req.params.id);
  if (!k || k.deleted_at) return fail(res, 404, "kaizen_not_found", "Кайдзен не найден");
  db.prepare("UPDATE kaizens SET edit_allowed_until = ? WHERE id = ?").run(toSqlite(addHours(new Date(), hours)), k.id);
  res.json({ kaizen: serialize(loadKaizen(k.id), me) });
});

// A card is never physically removed: its number stays reserved and managers can still open it.
router.delete("/:id", (req, res) => {
  const me = req.currentUser;
  const k = loadKaizen(req.params.id);
  if (!k || k.deleted_at) return fail(res, 404, "kaizen_not_found", "Кайдзен не найден");
  const allowed = canManage(me) || (k.author_id === me.id && k.status === "sent" && canEdit(me, k));
  if (!allowed) return fail(res, 403, "forbidden", "Нет прав удалить этот кайдзен");
  db.prepare("UPDATE kaizens SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ?").run(me.id, k.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- photos

const SIGNATURES = [
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/webp", ext: "webp", test: (b) => b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" },
];

const rawImage = express.raw({ type: SIGNATURES.map((s) => s.mime), limit: config.MAX_PHOTO_BYTES + 1024 });

router.post("/:id/photos", rawImage, (req, res) => {
  const me = req.currentUser;
  const k = loadKaizen(req.params.id);
  if (!k || k.deleted_at) return fail(res, 404, "kaizen_not_found", "Кайдзен не найден");
  if (!canView(me, k)) return fail(res, 403, "forbidden", "У вас нет доступа к этому кайдзену");
  if (!canEdit(me, k)) return fail(res, 403, "edit_window_closed", "Срок редактирования истёк. Попросите администратора разрешить правку.");

  const block = String(req.query.block ?? "");
  if (!config.PHOTO_BLOCKS.includes(block)) return fail(res, 400, "photo_block_invalid", "Неизвестный блок для фото");
  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    return fail(res, 415, "photo_type_invalid", "Допустимы только фото JPEG, PNG или WebP");
  }
  if (body.length > config.MAX_PHOTO_BYTES) return fail(res, 413, "photo_too_large", "Фото слишком большое (максимум 5 МБ)");
  const sig = SIGNATURES.find((s) => s.test(body));
  if (!sig) return fail(res, 415, "photo_type_invalid", "Допустимы только фото JPEG, PNG или WebP");

  const count = db.prepare("SELECT COUNT(*) c FROM kaizen_photos WHERE kaizen_id = ? AND block = ?").get(k.id, block).c;
  if (count >= config.MAX_PHOTOS_PER_BLOCK) {
    return fail(res, 409, "photo_limit_reached", `В блок можно добавить не больше ${config.MAX_PHOTOS_PER_BLOCK} фото`);
  }
  const caption = String(req.query.caption ?? "").trim().slice(0, 200) || null;

  fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
  const fileName = `${crypto.randomBytes(16).toString("hex")}.${sig.ext}`;
  fs.writeFileSync(path.join(config.UPLOAD_DIR, fileName), body);
  const info = db
    .prepare("INSERT INTO kaizen_photos (kaizen_id, block, position, caption, mime, size, file_name, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(k.id, block, count, caption, sig.mime, body.length, fileName, me.id);
  db.prepare("UPDATE kaizens SET updated_at = datetime('now') WHERE id = ?").run(k.id);
  res.status(201).json({ photo: photoMeta(db.prepare("SELECT * FROM kaizen_photos WHERE id = ?").get(info.lastInsertRowid)) });
});

function loadPhoto(kaizenId, photoId) {
  if (!/^\d+$/.test(String(photoId))) return null;
  return db.prepare("SELECT * FROM kaizen_photos WHERE id = ? AND kaizen_id = ?").get(Number(photoId), kaizenId) || null;
}

// Photos are served only through the API (with the login token), never as public static files.
router.get("/:id/photos/:photoId", (req, res) => {
  const me = req.currentUser;
  const k = loadKaizen(req.params.id);
  if (!k || (k.deleted_at && !canManage(me))) return fail(res, 404, "kaizen_not_found", "Кайдзен не найден");
  if (!canView(me, k)) return fail(res, 403, "forbidden", "У вас нет доступа к этому кайдзену");
  const p = loadPhoto(k.id, req.params.photoId);
  if (!p) return fail(res, 404, "photo_not_found", "Фото не найдено");
  const file = path.join(config.UPLOAD_DIR, p.file_name);
  if (!fs.existsSync(file)) return fail(res, 404, "photo_not_found", "Фото не найдено");
  res.set({ "Content-Type": p.mime, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" });
  res.sendFile(file);
});

router.delete("/:id/photos/:photoId", (req, res) => {
  const me = req.currentUser;
  const k = loadKaizen(req.params.id);
  if (!k || k.deleted_at) return fail(res, 404, "kaizen_not_found", "Кайдзен не найден");
  if (!canView(me, k)) return fail(res, 403, "forbidden", "У вас нет доступа к этому кайдзену");
  if (!canEdit(me, k)) return fail(res, 403, "edit_window_closed", "Срок редактирования истёк. Попросите администратора разрешить правку.");
  const p = loadPhoto(k.id, req.params.photoId);
  if (!p) return fail(res, 404, "photo_not_found", "Фото не найдено");
  db.prepare("DELETE FROM kaizen_photos WHERE id = ?").run(p.id);
  fs.rmSync(path.join(config.UPLOAD_DIR, p.file_name), { force: true });
  res.json({ ok: true });
});

module.exports = router;
