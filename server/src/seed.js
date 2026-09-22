require("dotenv").config();
const bcrypt = require("bcryptjs");
const db = require("./db");

const ADMIN_LOGIN = process.env.SEED_ADMIN_LOGIN || "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "admin12345";

const DEPARTMENTS = [
  { name: "Покраска", positions: ["Мастер", "Бригадир", "Оператор"] },
  { name: "Сварка", positions: ["Мастер", "Бригадир", "Оператор"] },
  { name: "Общая сборка", positions: ["Мастер", "Бригадир", "Оператор"] },
  { name: "Логистика", positions: ["Мастер", "Бригадир", "Оператор"] },
];

function run() {
  const existingAdmin = db.prepare("SELECT id FROM users WHERE login = ?").get(ADMIN_LOGIN);
  if (!existingAdmin) {
    const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    db.prepare(
      `INSERT INTO users (login, password_hash, full_name, is_super_admin, role_title, status, approved_at)
       VALUES (?, ?, ?, 1, 'Супер администратор', 'approved', datetime('now'))`
    ).run(ADMIN_LOGIN, hash, "Супер администратор платформы");
    console.log(`Создан супер-администратор: login="${ADMIN_LOGIN}" password="${ADMIN_PASSWORD}"`);
  } else {
    console.log("Супер-администратор уже существует, пропускаем.");
  }

  const insertDept = db.prepare("INSERT OR IGNORE INTO departments (name) VALUES (?)");
  const getDept = db.prepare("SELECT * FROM departments WHERE name = ?");
  const insertPos = db.prepare("INSERT OR IGNORE INTO positions (department_id, parent_id, name) VALUES (?, ?, ?)");
  const getPos = db.prepare("SELECT * FROM positions WHERE department_id = ? AND name = ? AND parent_id IS ?");

  for (const dep of DEPARTMENTS) {
    insertDept.run(dep.name);
    const department = getDept.get(dep.name);
    let parentId = null;
    for (const posName of dep.positions) {
      insertPos.run(department.id, parentId, posName);
      const pos = getPos.get(department.id, posName, parentId);
      parentId = pos.id;
    }
    console.log(`Отдел готов: ${dep.name} (${dep.positions.join(" -> ")})`);
  }

  console.log("Сидирование завершено.");
}

run();
