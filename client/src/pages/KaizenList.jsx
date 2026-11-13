import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { useI18n } from "../i18n";
import { formatDateTime } from "../formatDate";
import { CATEGORIES, STATUSES } from "../kaizenMeta";

export default function KaizenList() {
  const { t, lang, errorText } = useI18n();
  const [scope, setScope] = useState("mine");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = {};
    if (scope === "mine") params.mine = "1";
    if (q.trim()) params.q = q.trim();
    if (status) params.status = status;
    if (category) params.category = category;
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .get("/kaizens", { params })
        .then((r) => { setItems(r.data.kaizens); setError(""); })
        .catch((e) => setError(errorText(e)))
        .finally(() => setLoading(false));
    }, q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [scope, q, status, category]); // eslint-disable-line

  return (
    <section className="card">
      <div className="item-head">
        <h2>{t("kz.list.title")}</h2>
        <Link className="btn btn-primary" to="/kaizens/new">+ {t("kz.list.new")}</Link>
      </div>
      <div className="row">
        <div className="seg seg-light" role="group">
          <button type="button" className={scope === "mine" ? "on" : ""} onClick={() => setScope("mine")}>{t("kz.list.mine")}</button>
          <button type="button" className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>{t("kz.list.all")}</button>
        </div>
        <input type="search" placeholder={t("kz.list.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={t("common.status")} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("common.status")}: {t("common.all")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`kz.status.${s}`)}</option>)}
        </select>
        <select aria-label={t("kz.form.category")} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{t("kz.form.category")}: {t("common.all")}</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{t(`kz.cat.${c}`)}</option>)}
        </select>
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {loading && <p className="muted">{t("common.loading")}</p>}
      {!loading && items.length === 0 && <p className="muted">{t("kz.list.empty")}</p>}
      <ul className="list">
        {items.map((k) => (
          <li key={k.id} className="item">
            <Link className="item-link" to={`/kaizens/${k.id}`}>
              <div className="item-head">
                <div>
                  <span className="tabel">№{k.number}</span> <strong>{k.title}</strong>
                  {k.deleted_at && <span className="pill pill-rejected" style={{ marginLeft: 8 }}>{t("kz.list.deleted")}</span>}
                </div>
                <span className={`pill pill-${k.status}`}>{t(`kz.status.${k.status}`)}</span>
              </div>
              <div className="muted small">
                {t(`kz.cat.${k.category}`)} · {t("kz.list.operator")}: {k.operator_name} (<span className="mono">№{k.operator_tabel}</span>)
                {k.department_name ? ` · ${k.department_name}` : ""} · {formatDateTime(k.created_at, lang)}
                {k.photo_count > 0 ? ` · 📷 ${k.photo_count}` : ""}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
