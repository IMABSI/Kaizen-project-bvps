import { useEffect, useState } from "react";
import api, { apiErrorMessage } from "../api";
import { STATUS_LABELS, STATUS_ORDER } from "../statusLabels";

export default function AdminKaizens() {
  const [kaizens, setKaizens] = useState([]);
  const [error, setError] = useState("");
  const [comments, setComments] = useState({});

  const load = () => {
    api
      .get("/kaizens")
      .then((res) => setKaizens(res.data.kaizens))
      .catch((err) => setError(apiErrorMessage(err)));
  };

  useEffect(load, []);

  const updateStatus = async (id, status) => {
    setError("");
    try {
      await api.put(`/kaizens/${id}/status`, { status, comment: comments[id] || undefined });
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  };

  return (
    <div className="card">
      <h2>Все кайдзен-предложения</h2>
      {error && <div className="alert alert-error">{error}</div>}
      <ul className="kaizen-list">
        {kaizens.map((k) => (
          <li key={k.id} className="kaizen-item">
            <div className="kaizen-item-head">
              <strong>{k.title}</strong>
              <span className={`status-pill status-${k.status}`}>{STATUS_LABELS[k.status]}</span>
            </div>
            <div className="muted small">
              Автор: {k.author?.full_name} (@{k.author?.login}) · Отдел: {k.department?.name || "—"} · Создано:{" "}
              {k.created_at}
            </div>
            {k.category && <div className="muted small">Категория: {k.category}</div>}
            <p>{k.description}</p>

            <div className="inline-form">
              <select defaultValue="" onChange={(e) => e.target.value && updateStatus(k.id, e.target.value)}>
                <option value="">Изменить статус...</option>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <input
                placeholder="Комментарий (необязательно)"
                value={comments[k.id] || ""}
                onChange={(e) => setComments({ ...comments, [k.id]: e.target.value })}
              />
            </div>

            {k.history?.length > 0 && (
              <details className="small muted">
                <summary>История статусов ({k.history.length})</summary>
                <ul>
                  {k.history.map((h) => (
                    <li key={h.id}>
                      {h.changed_at}: {STATUS_LABELS[h.status]} {h.comment ? `— ${h.comment}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
