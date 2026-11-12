const jwt = require("jsonwebtoken");
const db = require("./db");
const { fail } = require("./errors");

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const DEV_FALLBACK_SECRET = "dev-secret-change-me-in-production";

// In production a missing secret is a hard error: a well-known fallback would let anyone forge tokens.
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === "replace-with-a-long-random-string") {
  if (IS_PRODUCTION) {
    throw new Error("JWT_SECRET must be set to a long random string when NODE_ENV=production");
  }
  JWT_SECRET = DEV_FALLBACK_SECRET;
  if (process.env.NODE_ENV !== "test") {
    console.warn("[auth] JWT_SECRET не задан — используется небезопасный ключ для разработки. Задайте его в server/.env");
  }
}
const JWT_EXPIRES_IN = "12h";

function signToken(user) {
  return jwt.sign({ sub: user.id, tv: user.token_version }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verifies the token AND re-reads the user on every request, so a disabled or deleted account — or one
 * whose password was changed/reset (token_version bumped) — loses access immediately instead of when the
 * token expires. Attaches the fresh user row to req.currentUser (and the id to req.userId).
 */
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return fail(res, 401, "auth_required", "Требуется авторизация");

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return fail(res, 401, "token_invalid", "Недействительный или истёкший токен");
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub);
  if (!user || user.status !== "active" || !user.password_hash || user.token_version !== payload.tv) {
    return fail(res, 401, "session_unavailable", "Сессия недействительна. Войдите заново.");
  }

  req.userId = user.id;
  req.currentUser = user;
  next();
}

/**
 * Grants access to super admins unconditionally, or to users who hold the given granular permission
 * (e.g. "perm_manage_structure"). Must run after authMiddleware.
 */
function requirePermission(...permKeys) {
  return function (req, res, next) {
    const user = req.currentUser;
    if (!user) return fail(res, 401, "auth_required", "Требуется авторизация");
    if (!user.is_super_admin && !permKeys.some((k) => user[k])) {
      return fail(res, 403, "forbidden", "У вас нет прав для этого действия");
    }
    next();
  };
}

function requireSuperAdmin(req, res, next) {
  const user = req.currentUser;
  if (!user) return fail(res, 401, "auth_required", "Требуется авторизация");
  if (!user.is_super_admin) return fail(res, 403, "super_admin_required", "Требуются права супер-администратора");
  next();
}

module.exports = { signToken, authMiddleware, requirePermission, requireSuperAdmin, JWT_SECRET };
