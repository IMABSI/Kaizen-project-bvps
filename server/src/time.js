// SQLite's datetime('now') is "YYYY-MM-DD HH:MM:SS" in UTC with no marker. These helpers keep all
// server-side time maths explicit about that.
function parseUtc(sqlite) {
  if (!sqlite) return null;
  const d = new Date(String(sqlite).replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

function toSqlite(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 3600 * 1000);
}

module.exports = { parseUtc, toSqlite, addHours };
