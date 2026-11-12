// The server stores timestamps with SQLite's datetime('now'): "YYYY-MM-DD HH:MM:SS" in UTC, no timezone marker.
// Parse as UTC explicitly and show in the factory's timezone (GMT+5).
export const APP_TIME_ZONE = "Asia/Tashkent";

const LOCALES = { ru: "ru-RU", uz: "uz-Latn-UZ", en: "en-GB" };
const cache = {};

function formatterFor(lang) {
  const locale = LOCALES[lang] || LOCALES.ru;
  return (cache[locale] ||= new Intl.DateTimeFormat(locale, {
    timeZone: APP_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }));
}

export function formatDateTime(sqliteUtc, lang = "ru") {
  if (!sqliteUtc) return "—";
  const iso = String(sqliteUtc).includes("T") ? String(sqliteUtc) : `${String(sqliteUtc).replace(" ", "T")}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(sqliteUtc);
  return formatterFor(lang).format(date);
}
