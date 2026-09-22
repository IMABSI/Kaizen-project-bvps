const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me-in-production";
const JWT_EXPIRES_IN = "12h";

function signToken(user) {
  return jwt.sign({ sub: user.id, login: user.login }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Требуется авторизация" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Недействительный или истёкший токен" });
  }
}

/**
 * Grants access to super admins unconditionally, or to approved users who hold the
 * given granular permission (e.g. "perm_manage_structure"). Attaches the loaded user
 * to req.currentUser either way.
 */
function requirePermission(permKey) {
  return function (req, res, next) {
    const db = require("./db");
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
    if (!user || user.status !== "approved") {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    if (!user.is_super_admin && !user[permKey]) {
      return res.status(403).json({ error: "У вас нет прав для этого действия" });
    }
    req.currentUser = user;
    next();
  };
}

function requireSuperAdmin(req, res, next) {
  const db = require("./db");
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  if (!user || user.status !== "approved" || !user.is_super_admin) {
    return res.status(403).json({ error: "Требуются права супер-администратора" });
  }
  req.currentUser = user;
  next();
}

module.exports = { signToken, authMiddleware, requirePermission, requireSuperAdmin, JWT_SECRET };
