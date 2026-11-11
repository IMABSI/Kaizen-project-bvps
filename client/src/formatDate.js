// The server stores timestamps with SQLite's datetime('now'): "YYYY-MM-DD HH:MM:SS" in UTC,
// with no timezone marker. Parse it as UTC explicitly and show it in the factory's timezone (GMT+5).
export const APP_TIME_ZONE = "Asia/Tashkent";

const formatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatDateTime(sqliteUtc) {
  if (!sqliteUtc) return "—";
  const iso = String(sqliteUtc).includes("T") ? String(sqliteUtc) : `${String(sqliteUtc).replace(" ", "T")}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(sqliteUtc);
  return formatter.format(date);
}
