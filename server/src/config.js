// Central place for business constants, so they are changed in one spot.
module.exports = {
  // Tabel (employee) numbers are whole numbers in this range. Raise TABEL_MAX via env if the plant grows.
  TABEL_MIN: 1,
  TABEL_MAX: Number(process.env.TABEL_MAX) || 3000,

  // One-time code an admin hands to a new employee so they can set their own password.
  ACTIVATION_TTL_DAYS: 7,
  ACTIVATION_MAX_ATTEMPTS: 5,
  ACTIVATION_CODE_LENGTH: 8,

  PASSWORD_MIN: 8,
  PASSWORD_MAX: 128,

  LANGUAGES: ["ru", "uz", "en"],
  THEMES: ["light", "dark", "system"],

  // ---- kaizen card ----
  // These lists are mirrored in client/src/kaizenMeta.js (a client test checks they stay identical).
  CATEGORIES: ["cost", "quality", "safety_5s", "efficiency", "other"],
  WASTES: ["overproduction", "waiting", "transport", "overprocessing", "inventory", "motion", "defects"],
  EFFECTS: ["time", "money", "quality", "safety", "ergonomics", "ecology", "order_5s"],
  IMPL_STATUSES: ["idea", "pilot", "implemented"],
  EFFORTS: ["low", "medium", "high"],
  CURRENCIES: ["UZS", "USD", "EUR", "CNY"],
  BETTER: ["lower", "higher"],
  STATUSES: ["sent", "accepted", "rejected"],
  PHOTO_BLOCKS: ["problem", "before", "after", "benefits", "conclusion"],
  MAX_PHOTOS_PER_BLOCK: 4,
  MAX_PHOTO_BYTES: 5 * 1024 * 1024,
  MAX_MEASURES: 20,
  EDIT_WINDOW_HOURS: 24,
  MAX_EXTRA_EDIT_HOURS: 24 * 14,
  VISIBILITY_MODES: ["all", "restricted"],
  UPLOAD_DIR: process.env.UPLOAD_DIR || require("node:path").join(__dirname, "..", "data", "uploads"),
};
