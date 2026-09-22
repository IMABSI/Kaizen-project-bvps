const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const db = require("../db");
const { signToken, authMiddleware } = require("../auth");

const router = express.Router();

const registerSchema = z.object({
  login: z.string().min(3).max(64),
  password: z.string().min(6).max(128),
  full_name: z.string().min(2).max(128),
  department_id: z.number().int(),
  position_id: z.number().int(),
});

function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

router.post("/register", (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Некорректные данные регистрации", details: parsed.error.flatten() });
  }
  const { login, password, full_name, department_id, position_id } = parsed.data;

  const existing = db.prepare("SELECT id FROM users WHERE login = ?").get(login);
  if (existing) return res.status(409).json({ error: "Такой логин уже занят" });

  const department = db.prepare("SELECT * FROM departments WHERE id = ?").get(department_id);
  if (!department) return res.status(400).json({ error: "Отдел не найден" });

  const position = db.prepare("SELECT * FROM positions WHERE id = ? AND department_id = ?").get(position_id, department_id);
  if (!position) return res.status(400).json({ error: "Должность не найдена в выбранном отделе" });

  const password_hash = bcrypt.hashSync(password, 10);

  const info = db
    .prepare(
      `INSERT INTO users (login, password_hash, full_name, department_id, position_id, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    )
    .run(login, password_hash, full_name, department_id, position_id);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  return res.status(201).json({
    message: "Заявка на регистрацию отправлена. Ожидайте подтверждения от вышестоящего сотрудника.",
    user: publicUser(user),
  });
});

router.post("/login", (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: "Введите логин и пароль" });

  const user = db.prepare("SELECT * FROM users WHERE login = ?").get(login);
  if (!user) return res.status(401).json({ error: "Неверный логин или пароль" });

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Неверный логин или пароль" });

  if (user.status === "pending") {
    return res.status(403).json({ error: "Ваша учётная запись ещё не подтверждена", status: "pending" });
  }
  if (user.status === "rejected") {
    return res.status(403).json({ error: "Ваша заявка на регистрацию была отклонена", status: "rejected", reason: user.rejection_reason });
  }
  if (user.status === "disabled") {
    return res.status(403).json({ error: "Ваша учётная запись отключена администратором", status: "disabled" });
  }

  const token = signToken(user);
  return res.json({ token, user: publicUser(user) });
});

router.get("/me", authMiddleware, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  if (!user) return res.status(404).json({ error: "Пользователь не найден" });
  return res.json({ user: publicUser(user) });
});

module.exports = router;
