// Backup: a consistent copy of the database (VACUUM INTO) plus the uploaded photos.
// Usage: npm run backup   (optionally BACKUP_DIR=..., BACKUP_KEEP=14)
require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const db = require("./db");
const config = require("./config");

function stamp(d = new Date()) {
  return d.toISOString().replace(/[:T]/g, "-").slice(0, 19);
}

function runBackup({ dir = process.env.BACKUP_DIR || path.join(__dirname, "..", "backups"), keep = Number(process.env.BACKUP_KEEP) || 14 } = {}) {
  if (db.IN_MEMORY) throw new Error("Резервная копия базы в памяти не имеет смысла");
  const target = path.join(dir, stamp());
  fs.mkdirSync(target, { recursive: true });
  db.exec(`VACUUM INTO '${path.join(target, "kaizen.db").replace(/'/g, "''")}'`);
  if (fs.existsSync(config.UPLOAD_DIR)) fs.cpSync(config.UPLOAD_DIR, path.join(target, "uploads"), { recursive: true });

  // keep only the newest `keep` backups
  const all = fs.readdirSync(dir).filter((n) => /^\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d$/.test(n)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(dir, old), { recursive: true, force: true });
  return target;
}

if (require.main === module) {
  try {
    console.log("Резервная копия сохранена:", runBackup());
  } catch (e) {
    console.error("Не удалось сделать резервную копию:", e.message);
    process.exit(1);
  }
}

module.exports = { runBackup };
