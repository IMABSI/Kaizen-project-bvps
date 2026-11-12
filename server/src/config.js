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
};
