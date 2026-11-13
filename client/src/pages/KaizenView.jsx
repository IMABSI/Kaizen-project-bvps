import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n";
import { formatDateTime } from "../formatDate";
import AuthImage from "../components/AuthImage";
import { STATUSES } from "../kaizenMeta";

/** Faint diagonal tabel number of the idea's author, repeated over the whole sheet. */
export function Watermark({ text }) {
  const cells = useMemo(() => Array.from({ length: 160 }, (_, i) => i), []);
  return (
    <div className="watermark" aria-hidden="true" data-testid="watermark">
      {cells.map((i) => <span key={i}>{text}</span>)}
    </div>
  );
}

function Block({ title, text, photos, kaizenId, notFilled }) {
  return (
    <section className="sheet-block">
      <h3>{title}</h3>
      {text ? <p className="sheet-text">{text}</p> : <p className="muted small">{notFilled}</p>}
      {photos.length > 0 && (
        <div className="photo-grid">
          {photos.map((p) => (
            <figure key={p.id} className="photo">
              <AuthImage kaizenId={kaizenId} photoId={p.id} alt={p.caption || ""} />
              {p.caption && <figcaption>{p.caption}</figcaption>}
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}

export default function KaizenView() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t, lang, errorText } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [k, setK] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [comment, setComment] = useState("");
  const [hours, setHours] = useState("24");

  const manager = user.is_super_admin || user.perm_manage_kaizens;
  const load = () => api.get(`/kaizens/${id}`).then((r) => { setK(r.data.kaizen); setStatus(r.data.kaizen.status); }).catch((e) => setError(errorText(e)));
  useEffect(() => { load(); }, [id]); // eslint-disable-line

  const act = async (fn) => {
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (error && !k) return <div className="alert alert-error" role="alert">{error}</div>;
  if (!k) return <p className="muted">{t("common.loading")}</p>;

  const photosOf = (b) => k.photos.filter((p) => p.block === b);
  const nf = t("kz.view.notFilled");
  const fmtMoney = (v) => (v === null || v === undefined ? null : `${new Intl.NumberFormat(lang === "uz" ? "uz-Latn-UZ" : lang === "en" ? "en-GB" : "ru-RU").format(v)} ${k.currency}`);

  return (
    <div className="stack">
      <div className="row no-print">
        <Link className="btn" to="/">← {t("nav.kaizens")}</Link>
        <button className="btn" onClick={() => window.print()}>🖨 {t("kz.view.print")}</button>
        {k.can_edit && !k.deleted_at && <Link className="btn" to={`/kaizens/${k.id}/edit`}>{t("kz.view.edit")}</Link>}
        {k.can_edit && !k.deleted_at && (
          <button className="btn btn-danger" onClick={() => window.confirm(t("kz.view.confirmDelete")) && act(async () => { await api.delete(`/kaizens/${k.id}`); navigate("/"); })}>{t("kz.view.delete")}</button>
        )}
        {!manager && k.edit_deadline && (
          <span className="muted small">{k.can_edit ? t("kz.view.editUntil", { date: formatDateTime(k.edit_deadline, lang) }) : t("kz.view.editClosed")}</span>
        )}
      </div>

      {location.state?.uploadFailed > 0 && <div className="alert alert-error no-print" role="alert">{t("kz.form.uploadFailed", { n: location.state.uploadFailed })}</div>}
      {error && <div className="alert alert-error no-print" role="alert">{error}</div>}
      {k.deleted_at && <div className="alert alert-error no-print">{t("kz.view.deletedBanner")}</div>}

      <article className="sheet" data-testid="sheet">
        <Watermark text={`№${k.operator_tabel}`} />
        <header className="sheet-head">
          <div>
            <div className="sheet-number">{t("kz.view.number", { n: k.number })}</div>
            <h1>{k.title}</h1>
          </div>
          <span className={`pill pill-${k.status}`}>{t(`kz.status.${k.status}`)}</span>
        </header>

        <dl className="sheet-facts">
          <div><dt>{t("kz.view.operator")}</dt><dd>{k.operator_name} · <span className="mono">№{k.operator_tabel}</span>{k.operator_post ? ` · ${k.operator_post}` : ""}</dd></div>
          <div><dt>{t("kz.view.submitter")}</dt><dd>{k.submitter_name} · <span className="mono">№{k.submitter_tabel}</span></dd></div>
          <div><dt>{t("kz.view.department")}</dt><dd>{k.department_name || t("common.none")}</dd></div>
          <div><dt>{t("kz.view.created")}</dt><dd>{formatDateTime(k.created_at, lang)}</dd></div>
          <div><dt>{t("kz.form.category")}</dt><dd>{t(`kz.cat.${k.category}`)}</dd></div>
          {k.area && <div><dt>{t("kz.form.area")}</dt><dd>{k.area}</dd></div>}
          {k.equipment && <div><dt>{t("kz.form.equipment")}</dt><dd>{k.equipment}</dd></div>}
          {k.noticed_on && <div><dt>{t("kz.form.noticed")}</dt><dd>{k.noticed_on}</dd></div>}
          <div><dt>{t("kz.form.implStatus")}</dt><dd>{t(`kz.impl.${k.impl_status}`)}{k.implemented_on ? ` · ${k.implemented_on}` : ""}</dd></div>
          {k.effort && <div><dt>{t("kz.form.effort")}</dt><dd>{t(`kz.effort.${k.effort}`)}</dd></div>}
          {k.cost_amount !== null && <div><dt>{t("kz.view.cost")}</dt><dd>{fmtMoney(k.cost_amount)}</dd></div>}
          {k.saving_month_amount !== null && <div><dt>{t("kz.view.saving")}</dt><dd>{fmtMoney(k.saving_month_amount)}</dd></div>}
          {k.participants && <div><dt>{t("kz.form.participants")}</dt><dd>{k.participants}</dd></div>}
        </dl>

        {(k.wastes.length > 0 || k.effects.length > 0) && (
          <div className="sheet-tags">
            {k.wastes.map((w) => <span key={w} className="tag">{t(`kz.waste.${w}`)}</span>)}
            {k.effects.map((e) => <span key={e} className="tag tag-effect">{t(`kz.effect.${e}`)}</span>)}
          </div>
        )}

        <Block title={t("kz.form.problem")} text={k.problem_text} photos={photosOf("problem")} kaizenId={k.id} notFilled={nf} />
        <Block title={t("kz.form.before")} text={k.before_text} photos={photosOf("before")} kaizenId={k.id} notFilled={nf} />
        <Block title={t("kz.form.after")} text={k.after_text} photos={photosOf("after")} kaizenId={k.id} notFilled={nf} />

        {k.measures.length > 0 && (
          <section className="sheet-block">
            <h3>{t("kz.form.measures")}</h3>
            <table className="measure-table">
              <thead><tr><th>{t("kz.form.measureName")}</th><th>{t("kz.form.measureBefore")}</th><th>{t("kz.form.measureAfter")}</th><th>{t("kz.view.change")}</th></tr></thead>
              <tbody>
                {k.measures.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}{m.unit ? `, ${m.unit}` : ""}</td>
                    <td className="mono">{m.before_value}</td>
                    <td className="mono">{m.after_value}</td>
                    <td className={`mono delta ${m.improved === true ? "good" : m.improved === false ? "bad" : ""}`}>{m.change_pct === null ? "—" : `${m.change_pct > 0 ? "+" : ""}${m.change_pct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <Block title={t("kz.form.benefits")} text={k.benefits_text} photos={photosOf("benefits")} kaizenId={k.id} notFilled={nf} />
        <Block title={t("kz.form.conclusion")} text={k.conclusion_text} photos={photosOf("conclusion")} kaizenId={k.id} notFilled={nf} />
        {k.admin_comment && <p className="sheet-comment">💬 {k.admin_comment}</p>}
      </article>

      {manager && !k.deleted_at && (
        <section className="card no-print">
          <h2>{t("kz.view.manage")}</h2>
          <div className="row">
            <select aria-label={t("kz.view.setStatus")} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{t(`kz.status.${s}`)}</option>)}
            </select>
            <input placeholder={t("kz.view.comment")} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
            <button className="btn btn-primary" onClick={() => act(async () => { await api.put(`/kaizens/${k.id}/status`, { status, comment: comment || undefined }); setComment(""); })}>{t("kz.view.apply")}</button>
          </div>
          <div className="row">
            <label className="inline-label">{t("kz.view.allowEdit")}<input type="number" min="1" max="336" value={hours} onChange={(e) => setHours(e.target.value)} className="narrow-input" /></label>
            <button className="btn" onClick={() => act(() => api.post(`/kaizens/${k.id}/allow-edit`, { hours: Number(hours) }))}>{t("kz.view.allow")}</button>
          </div>
          <h3 className="small">{t("kz.view.history")}</h3>
          <ul className="small">
            {k.history.map((h) => <li key={h.id}>{formatDateTime(h.changed_at, lang)} — {t(`kz.status.${h.status}`)}{h.comment ? `: ${h.comment}` : ""}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
