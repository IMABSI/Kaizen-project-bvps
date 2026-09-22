import { useEffect, useState } from "react";
import api, { apiErrorMessage } from "../api";
import { STATUS_LABELS } from "../statusLabels";

export default function Dashboard() {
  const [kaizens, setKaizens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: "", description: "", category: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .get("/kaizens")
      .then((res) => setKaizens(res.data.kaizens))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      await api.post("/kaizens", form);
      setForm({ title: "", description: "", category: "" });
      setSuccess("Предложение отправлено!");
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid-2">
      <section className="card">
        <h2>Новое кайдзен-предложение</h2>
        <form onSubmit={onSubmit}>
          <label>
            Название
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </label>
          <label>
            Категория (необязательно)
            <input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="например: безопасность, качество, эргономика"
            />
          </label>
          <label>
            Описание предложения
            <textarea
              rows={6}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              required
            />
          </label>
          {error && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}
          <button type="submit" disabled={busy}>
            {busy ? "Отправляем..." : "Отправить"}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Мои предложения</h2>
        {loading && <p className="muted">Загрузка...</p>}
        {!loading && kaizens.length === 0 && <p className="muted">Пока нет предложений.</p>}
        <ul className="kaizen-list">
          {kaizens.map((k) => (
            <li key={k.id} className="kaizen-item">
              <div className="kaizen-item-head">
                <strong>{k.title}</strong>
                <span className={`status-pill status-${k.status}`}>{STATUS_LABELS[k.status]}</span>
              </div>
              {k.category && <div className="muted small">Категория: {k.category}</div>}
              <p>{k.description}</p>
              {k.admin_comment && (
                <div className="alert alert-info small">Комментарий администратора: {k.admin_comment}</div>
              )}
              <div className="muted small">Создано: {k.created_at}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
