import { useEffect, useState } from "react";
import api, { apiErrorMessage } from "../api";

export default function Approvals() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    setLoading(true);
    api
      .get("/users/pending-for-me")
      .then((res) => setPending(res.data.pending))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const approve = async (id) => {
    setBusyId(id);
    try {
      await api.post(`/users/${id}/approve`);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id) => {
    const reason = window.prompt("Причина отклонения (необязательно):") || "";
    setBusyId(id);
    try {
      await api.post(`/users/${id}/reject`, { reason });
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="card">
      <h2>Заявки на подтверждение регистрации</h2>
      <p className="muted">
        Здесь отображаются заявки сотрудников, регистрирующихся на должность, непосредственно подчинённую вашей, в
        вашем отделе.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p className="muted">Загрузка...</p>}
      {!loading && pending.length === 0 && <p className="muted">Нет заявок, ожидающих вашего решения.</p>}
      <ul className="kaizen-list">
        {pending.map((u) => (
          <li key={u.id} className="kaizen-item">
            <div className="kaizen-item-head">
              <strong>{u.full_name}</strong>
              <span className="muted small">@{u.login}</span>
            </div>
            <div className="muted small">
              Отдел: {u.department?.name || "—"} · Должность: {u.position?.name || "—"}
            </div>
            <div className="row-actions">
              <button disabled={busyId === u.id} onClick={() => approve(u.id)}>
                Подтвердить
              </button>
              <button className="btn-secondary" disabled={busyId === u.id} onClick={() => reject(u.id)}>
                Отклонить
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
