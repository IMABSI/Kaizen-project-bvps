const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const db = require("../db");
const config = require("../config");
const { signToken, authMiddleware } = require("../auth");
const { fail } = require("../errors");
const { publicUser, parseTabel } = require("../models");
const { verifyCode, isExpired } = require("../activation");

const router = express.Router();

const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 10);

const passwordSchema = z.string().min(config.PASSWORD_MIN).max(config.PASSWORD_MAX);

/**
 * Login = tabel number + password.
 * An unknown tabel number and a wrong password look identical (and take the same time).
 */
router.post("/login", (req, res) => {
  const { tabel_number, password } = req.body || {};
  const tabel = parseTabel(tabel_number);
  if (typeof password !== "string" || password.length === 0 || tabel === null) {
    return fail(res, 400, "login_invalid_input", "Введите табельный номер и пароль");
  }

  const user = db.prepare("SELECT * FROM users WHERE tabel_number = ?").get(tabel);
  const ok = bcrypt.compareSync(password, user?.password_hash || DUMMY_HASH);

  if (user && !user.password_hash) {
    // No password yet (new account, or an admin reset it): tell the person what to do.
    return fail(res, 403, "needs_activation", "Пароль ещё не задан. Используйте код активации, выданный администратором.", {
      status: "needs_activation",
    });
  }
  if (!user || !ok) return fail(res, 401, "invalid_credentials", "Неверный табельный номер или пароль");

  if (user.status === "disabled") {
    return fail(res, 403, "account_disabled", "Ваша учётная запись отключена администратором", { status: "disabled" });
  }

  return res.json({ token: signToken(user), user: publicUser(user) });
});

/**
 * First login / password reset: tabel number + one-time activation code from the admin + a new password.
 * The code is single-use, expires, and is voided after too many wrong attempts.
 */
router.post("/activate", (req, res) => {
  const { tabel_number, activation_code, new_password } = req.body || {};
  const tabel = parseTabel(tabel_number);
  const pw = passwordSchema.safeParse(new_password);
  if (tabel === null || typeof activation_code !== "string" || !activation_code.trim()) {
    return fail(res, 400, "activation_invalid_input", "Введите табельный номер и код активации");
  }
  if (!pw.success) {
    return fail(res, 400, "password_policy", `Пароль должен содержать от ${config.PASSWORD_MIN} до ${config.PASSWORD_MAX} символов`);
  }

  const user = db.prepare("SELECT * FROM users WHERE tabel_number = ?").get(tabel);
  const generic = () => fail(res, 400, "activation_failed", "Неверный или просроченный код активации");

  if (!user || !user.activation_code_hash || isExpired(user.activation_expires_at)) {
    // Spend the same time as a real check so the response doesn't reveal which accounts have codes.
    bcrypt.compareSync(activation_code, DUMMY_HASH);
    return generic();
  }
  if (user.activation_attempts >= config.ACTIVATION_MAX_ATTEMPTS) return generic();

  if (!verifyCode(activation_code, user.activation_code_hash)) {
    const attempts = user.activation_attempts + 1;
    if (attempts >= config.ACTIVATION_MAX_ATTEMPTS) {
      // Too many guesses: void the code. The admin has to issue a new one.
      db.prepare(
        "UPDATE users SET activation_attempts = ?, activation_code_hash = NULL, activation_expires_at = NULL WHERE id = ?"
      ).run(attempts, user.id);
    } else {
      db.prepare("UPDATE users SET activation_attempts = ? WHERE id = ?").run(attempts, user.id);
    }
    return generic();
  }

  if (user.status === "disabled") {
    return fail(res, 403, "account_disabled", "Ваша учётная запись отключена администратором", { status: "disabled" });
  }

  db.prepare(
    `UPDATE users SET password_hash = ?, activation_code_hash = NULL, activation_expires_at = NULL,
       activation_attempts = 0, token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?`
  ).run(bcrypt.hashSync(new_password, 10), user.id);

  const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
  return res.json({ token: signToken(fresh), user: publicUser(fresh) });
});

router.get("/me", authMiddleware, (req, res) => {
  return res.json({ user: publicUser(req.currentUser) });
});

// Change your own password. All other sessions end (token_version bump); this one gets a fresh token.
router.put("/me/password", authMiddleware, (req, res) => {
  const { current_password, new_password } = req.body || {};
  const me = req.currentUser;
  if (typeof current_password !== "string" || !bcrypt.compareSync(current_password, me.password_hash)) {
    return fail(res, 400, "current_password_wrong", "Текущий пароль указан неверно");
  }
  if (!passwordSchema.safeParse(new_password).success) {
    return fail(res, 400, "password_policy", `Пароль должен содержать от ${config.PASSWORD_MIN} до ${config.PASSWORD_MAX} символов`);
  }
  db.prepare(
    "UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?"
  ).run(bcrypt.hashSync(new_password, 10), me.id);
  const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(me.id);
  return res.json({ token: signToken(fresh), user: publicUser(fresh) });
});

// Interface language and theme, remembered per account.
router.put("/me/preferences", authMiddleware, (req, res) => {
  const { language, theme } = req.body || {};
  if (language !== undefined && !config.LANGUAGES.includes(language)) {
    return fail(res, 400, "invalid_language", "Недопустимый язык");
  }
  if (theme !== undefined && !config.THEMES.includes(theme)) {
    return fail(res, 400, "invalid_theme", "Недопустимая тема");
  }
  db.prepare("UPDATE users SET language = COALESCE(?, language), theme = COALESCE(?, theme) WHERE id = ?").run(
    language ?? null,
    theme ?? null,
    req.currentUser.id
  );
  return res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.currentUser.id)) });
});

module.exports = router;
