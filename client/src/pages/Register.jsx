import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api, { apiErrorMessage } from "../api";
import { flattenTree, indentLabel } from "../positionTree";

export default function Register() {
  const navigate = useNavigate();
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState({
    login: "",
    password: "",
    full_name: "",
    department_id: "",
    position_id: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/structure/public").then((res) => setDepartments(res.data.departments));
  }, []);

  const selectedDept = departments.find((d) => String(d.id) === String(form.department_id));
  const flatPositions = selectedDept ? flattenTree(selectedDept.positions) : [];

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      await api.post("/auth/register", {
        login: form.login.trim(),
        password: form.password,
        full_name: form.full_name.trim(),
        department_id: Number(form.department_id),
        position_id: Number(form.position_id),
      });
      setSuccess("Заявка отправлена. После подтверждения вышестоящим сотрудником (или администратором) вы сможете войти.");
      setForm({ login: "", password: "", full_name: "", department_id: "", position_id: "" });
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось зарегистрироваться"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1>Регистрация</h1>
        <p className="muted">
          Выберите ваш отдел и должность/подразделение. Заявка будет отправлена на подтверждение тому, кто стоит на
          пункт выше по структуре отдела (для самого верхнего пункта — администратору).
        </p>

        <label>
          ФИО
          <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
        </label>
        <label>
          Логин
          <input value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} required minLength={3} />
        </label>
        <label>
          Пароль
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            minLength={6}
          />
        </label>
        <label>
          Отдел
          <select
            value={form.department_id}
            onChange={(e) => setForm({ ...form, department_id: e.target.value, position_id: "" })}
            required
          >
            <option value="">— выберите отдел —</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Должность
          <select
            value={form.position_id}
            onChange={(e) => setForm({ ...form, position_id: e.target.value })}
            required
            disabled={!selectedDept}
          >
            <option value="">— выберите должность —</option>
            {flatPositions.map((p) => (
              <option key={p.id} value={p.id}>
                {indentLabel(p)}
              </option>
            ))}
          </select>
        </label>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <button type="submit" disabled={busy}>
          {busy ? "Отправляем..." : "Отправить заявку"}
        </button>

        <p className="muted small">
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </p>
      </form>
    </div>
  );
}
