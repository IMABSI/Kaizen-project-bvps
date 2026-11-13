const express = require("express");
const db = require("../db");
const config = require("../config");
const { authMiddleware, requireSuperAdmin } = require("../auth");
const { fail } = require("../errors");

const router = express.Router();
router.use(authMiddleware);

function getVisibility() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'kaizen_visibility'").get();
  return row && config.VISIBILITY_MODES.includes(row.value) ? row.value : "all";
}

router.get("/", (req, res) => res.json({ kaizen_visibility: getVisibility() }));

router.put("/", requireSuperAdmin, (req, res) => {
  const v = req.body?.kaizen_visibility;
  if (!config.VISIBILITY_MODES.includes(v)) return fail(res, 400, "invalid_setting", "Недопустимое значение настройки");
  db.prepare("INSERT INTO settings (key, value) VALUES ('kaizen_visibility', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(v);
  res.json({ kaizen_visibility: v });
});

module.exports = router;
module.exports.getVisibility = getVisibility;
