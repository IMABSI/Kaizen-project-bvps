import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiErrorMessage } from "../api";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ login: "", password: "" });
  const [error, setError] = useState("");
  const [statusInfo, setStatusInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setStatusInfo(null);
    setBusy(true);
    try {
      await login(form.login.trim(), form.password);
      navigate("/");
    } catch (err) {
      const data = err?.response?.data;
      if (data?.status === "pending") {
        setStatusInfo("Ваша заявка ещё ожидает подтверждения вышестоящим сотрудником.");
      } else if (data?.status === "rejected") {
        setStatusInfo(`Заявка отклонена. Причина: ${data.reason || "не указана"}`);
      } else if (data?.status === "disabled") {
        setStatusInfo("Учётная запись отключена администратором.");
      } else {
        setError(apiErrorMessage(err, "Не удалось войти"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1>Kaizen Platform</h1>
        <p className="muted">Вход в систему подачи и контроля кайдзен-предложений</p>

        <label>
          Логин
          <input value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} required autoFocus />
        </label>
        <label>
          Пароль
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
        </label>

        {error && <div className="alert alert-error">{error}</div>}
        {statusInfo && <div className="alert alert-info">{statusInfo}</div>}

        <button type="submit" disabled={busy}>
          {busy ? "Входим..." : "Войти"}
        </button>

        <p className="muted small">
          Нет учётной записи? <Link to="/register">Зарегистрироваться</Link>
        </p>
      </form>
    </div>
  );
}
