import { useEffect, useState } from "react";
import api from "../api";
import { useI18n } from "../i18n";
import { formatDateTime } from "../formatDate";

const STATUS_ORDER = ["new", "in_review", "accepted", "rejected", "implemented"];

export default function AdminKaizens() {
  const { t, lang, errorText } = useI18n();
  const [kaizens, setKaizens] = useState([]);
  const [error, setError] = useState("");
  const [comments, setComments] = useState({});

  const load = () => api.get("/kaizens").then((res) => setKaizens(res.data.kaizens)).catch((err) => setError(errorText(err)));
  useEffect(() => { load(); }, []); // eslint-disable-line

  const updateStatus = async (id, status) => {
    setError("");
    try {
      await api.put(`/kaizens/${id}/status`, { status, comment: comments[id] || undefined });
      load();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <section className="card">
      <h2>{t("all.title")}</h2>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <ul className="list">
        {kaizens.map((k) => (
          <li key={k.id} className="item">
            <div className="item-head">
              <strong>{k.title}</strong>
              <span className={`pill pill-${k.status}`}>{t(`status.${k.status}`)}</span>
            </div>
            <div className="muted small">
              {t("dash.author")}: {k.author?.full_name} (<span className="mono">№{k.author?.tabel_number}</span>) · {k.department?.name || t("common.none")} · {formatDateTime(k.created_at, lang)}
            </div>
            {k.category && <div className="muted small">{k.category}</div>}
            <p>{k.description}</p>
            <div className="row">
              <select aria-label={t("all.changeStatus")} value="" onChange={(e) => e.target.value && updateStatus(k.id, e.target.value)}>
                <option value="">{t("all.changeStatus")}</option>
                {STATUS_ORDER.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
              </select>
              <input placeholder={t("all.comment")} value={comments[k.id] || ""} onChange={(e) => setComments({ ...comments, [k.id]: e.target.value })} />
            </div>
            {k.history?.length > 0 && (
              <details className="small muted">
                <summary>{t("all.history")} ({k.history.length})</summary>
                <ul>
                  {k.history.map((h) => (
                    <li key={h.id}>{formatDateTime(h.changed_at, lang)}: {t(`status.${h.status}`)} {h.comment ? `— ${h.comment}` : ""}</li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
