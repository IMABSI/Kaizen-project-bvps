// Mirrors server/src/config.js (a test checks that the two stay identical).
export const CATEGORIES = ["cost", "quality", "safety_5s", "efficiency", "other"];
export const WASTES = ["overproduction", "waiting", "transport", "overprocessing", "inventory", "motion", "defects"];
export const EFFECTS = ["time", "money", "quality", "safety", "ergonomics", "ecology", "order_5s"];
export const IMPL_STATUSES = ["idea", "pilot", "implemented"];
export const EFFORTS = ["low", "medium", "high"];
export const CURRENCIES = ["UZS", "USD", "EUR", "CNY"];
export const BETTER = ["lower", "higher"];
export const STATUSES = ["sent", "accepted", "rejected"];
export const PHOTO_BLOCKS = ["problem", "before", "after", "benefits", "conclusion"];
export const MAX_PHOTOS_PER_BLOCK = 4;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_MEASURES = 20;

/** Percent change of a measurement, rounded like the server does; null when "before" is 0. */
export function changePct(before, after) {
  const b = Number(before);
  const a = Number(after);
  if (!Number.isFinite(b) || !Number.isFinite(a) || b === 0) return null;
  return Math.round(((a - b) / Math.abs(b)) * 1000) / 10;
}

export function isImproved(before, after, better) {
  const b = Number(before);
  const a = Number(after);
  if (!Number.isFinite(b) || !Number.isFinite(a) || a === b) return null;
  return better === "higher" ? a > b : a < b;
}
