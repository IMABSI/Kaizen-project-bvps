/**
 * Every error response carries a stable machine-readable `code` next to the Russian `error` text.
 * The client translates by `code` (ru / uz / en) and falls back to `error` if it has no translation.
 */
function fail(res, status, code, message, extra = {}) {
  return res.status(status).json({ error: message, code, ...extra });
}

module.exports = { fail };
