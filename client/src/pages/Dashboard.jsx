import { useEffect, useState } from "react";
import api from "../api";
import { useI18n } from "../i18n";
import { formatDateTime } from "../formatDate";

export default function Dashboard() {
  const { t, lang, errorText } = useI18n();
  const [kaizens, setKaizens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: "", description: "", category: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api.get("/kaizens").then((res) => setKaizens(res.data.kaizens)).catch((err) => setError(errorText(err))).finally(() => setLoading(false));
  };
  useEffect(load, []); // eslint-disable-line

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      await api.post("/kaizens", form);
      setForm({ title: "", description: "", category: "" });
      setSuccess(t("dash.sent"));
      load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid-2">
      <section className="card">
        <h2>{t("dash.new")}</h2>
        <form onSubmit={onSubmit}>
          <label>{t("dash.title")}<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
          <label>{t("dash.category")}<input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
          <label>{t("dash.description")}<textarea rows={6} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required /></label>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          {success && <div className="alert alert-success" role="status">{success}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? t("dash.sending") : t("dash.send")}</button>
        </form>
      </section>
      <section className="card">
        <h2>{t("dash.mine")}</h2>
        {loading && <p className="muted">{t("common.loading")}</p>}
        {!loading && kaizens.length === 0 && <p className="muted">{t("dash.empty")}</p>}
        <ul className="list">
          {kaizens.map((k) => (
            <li key={k.id} className="item">
              <div className="item-head">
                <strong>{k.title}</strong>
                <span className={`pill pill-${k.status}`}>{t(`status.${k.status}`)}</span>
              </div>
              {k.category && <div className="muted small">{k.category}</div>}
              <p>{k.description}</p>
              {k.admin_comment && <div className="alert alert-info small">{t("dash.adminComment")}: {k.admin_comment}</div>}
              <div className="muted small">{formatDateTime(k.created_at, lang)}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
