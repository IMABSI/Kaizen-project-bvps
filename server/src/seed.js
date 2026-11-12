require("dotenv").config();
const bcrypt = require("bcryptjs");
const db = require("./db");
const { parseTabel } = require("./models");
const config = require("./config");

const ADMIN_TABEL = parseTabel(process.env.SEED_ADMIN_TABEL || "1");
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "admin12345";
const ADMIN_NAME = process.env.SEED_ADMIN_NAME || "Главный администратор";

// The plant structure is agreed with management later; admins edit departments in the UI at any time.
const DEPARTMENTS = ["Логистика"];

function run() {
  if (ADMIN_TABEL === null) {
    console.error(`SEED_ADMIN_TABEL должен быть целым числом от ${config.TABEL_MIN} до ${config.TABEL_MAX}`);
    process.exit(1);
  }

  const existingAdmin = db.prepare("SELECT id FROM users WHERE tabel_number = ?").get(ADMIN_TABEL);
  if (!existingAdmin) {
    db.prepare(
      `INSERT INTO users (tabel_number, full_name, post_title, password_hash, is_super_admin, role_title)
       VALUES (?, ?, 'Администратор платформы', ?, 1, 'Супер администратор')`
    ).run(ADMIN_TABEL, ADMIN_NAME, bcrypt.hashSync(ADMIN_PASSWORD, 10));
    console.log(`Создан супер-администратор: табельный номер ${ADMIN_TABEL}, пароль "${ADMIN_PASSWORD}"`);
    console.log("Обязательно смените пароль после первого входа и укажите свой настоящий табельный номер в SEED_ADMIN_TABEL.");
  } else {
    console.log("Пользователь с таким табельным номером уже существует, пропускаем.");
  }

  const insertDept = db.prepare("INSERT OR IGNORE INTO departments (name) VALUES (?)");
  for (const name of DEPARTMENTS) {
    insertDept.run(name);
    console.log(`Отдел готов: ${name}`);
  }
  console.log("Сидирование завершено.");
}

run();
