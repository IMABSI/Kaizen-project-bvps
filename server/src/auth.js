const jwt = require("jsonwebtoken");
const db = require("./db");

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
  return jwt.sign({ sub: user.id, login: user.login }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verifies the token AND re-reads the user on every request, so a disabled, rejected or
 * deleted account loses access immediately instead of when the token expires.
 * Attaches the fresh user row to req.currentUser (and the id to req.userId).
 */
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Требуется авторизация" });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: "Недействительный или истёкший токен" });
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub);
  if (!user || user.status !== "approved") {
    return res.status(401).json({ error: "Учётная запись недоступна. Войдите заново." });
  }

  req.userId = user.id;
  req.currentUser = user;
  next();
}

/**
 * Grants access to super admins unconditionally, or to users who hold the given granular
 * permission (e.g. "perm_manage_structure"). Must run after authMiddleware.
 */
function requirePermission(permKey) {
  return function (req, res, next) {
    const user = req.currentUser;
    if (!user) return res.status(401).json({ error: "Требуется авторизация" });
    if (!user.is_super_admin && !user[permKey]) {
      return res.status(403).json({ error: "У вас нет прав для этого действия" });
    }
    next();
  };
}

function requireSuperAdmin(req, res, next) {
  const user = req.currentUser;
  if (!user) return res.status(401).json({ error: "Требуется авторизация" });
  if (!user.is_super_admin) {
    return res.status(403).json({ error: "Требуются права супер-администратора" });
  }
  next();
}

module.exports = { signToken, authMiddleware, requirePermission, requireSuperAdmin, JWT_SECRET };
