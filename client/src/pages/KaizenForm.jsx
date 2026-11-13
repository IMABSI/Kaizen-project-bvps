import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n";
import PhotoBlock from "../components/PhotoBlock";
import { prepareImage, fitsLimit } from "../imageUtils";
import { flattenTree, buildTree } from "../teamTree";
import {
  BETTER, CATEGORIES, CURRENCIES, EFFECTS, EFFORTS, IMPL_STATUSES, MAX_MEASURES, MAX_PHOTOS_PER_BLOCK, PHOTO_BLOCKS, WASTES,
  changePct, isImproved,
} from "../kaizenMeta";

const EMPTY = {
  title: "", category: "efficiency", area: "", equipment: "", noticed_on: "",
  problem_text: "", before_text: "", after_text: "", benefits_text: "", conclusion_text: "",
  wastes: [], effects: [], impl_status: "idea", implemented_on: "", effort: "", currency: "UZS",
  cost_amount: "", saving_month_amount: "", participants: "", member_id: "",
};
const BLOCK_FIELD = { problem: "problem_text", before: "before_text", after: "after_text", benefits: "benefits_text", conclusion: "conclusion_text" };
const REQUIRED = { problem: true, after: true };

let keyCounter = 0;
const num = (s) => (s === "" || s === null || s === undefined ? null : Number(s));
const orNull = (s) => (s === "" ? null : s);

function Chips({ options, value, onChange, labelOf }) {
  const toggle = (o) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  return (
    <div className="chips">
      {options.map((o) => (
        <label key={o} className={`chip ${value.includes(o) ? "on" : ""}`}>
          <input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} />
          {labelOf(o)}
        </label>
      ))}
    </div>
  );
}

export default function KaizenForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, errorText } = useI18n();

  const [form, setForm] = useState(EMPTY);
  const [measures, setMeasures] = useState([]);
  const [savedPhotos, setSavedPhotos] = useState([]);
  const [queued, setQueued] = useState(() => Object.fromEntries(PHOTO_BLOCKS.map((b) => [b, []])));
  const [members, setMembers] = useState([]);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(editing);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const memberOptions = useMemo(() => flattenTree(buildTree(members)), [members]);

  useEffect(() => {
    api.get("/team").then((r) => setMembers(r.data.members)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!editing) return;
    api
      .get(`/kaizens/${id}`)
      .then((r) => {
        const k = r.data.kaizen;
        if (!k.can_edit) return navigate(`/kaizens/${id}`, { replace: true });
        setForm({
          ...EMPTY,
          ...Object.fromEntries(Object.keys(EMPTY).map((f) => [f, k[f] ?? EMPTY[f]])),
          cost_amount: k.cost_amount ?? "", saving_month_amount: k.saving_month_amount ?? "", member_id: "",
        });
        setMeasures(k.measures.map((m) => ({ name: m.name, unit: m.unit || "", before_value: String(m.before_value), after_value: String(m.after_value), better: m.better })));
        setSavedPhotos(k.photos);
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false));
  }, [id]); // eslint-disable-line

  const addFiles = async (block, files) => {
    setError("");
    const room = MAX_PHOTOS_PER_BLOCK - savedPhotos.filter((p) => p.block === block).length - queued[block].length;
    const accepted = [];
    for (const f of files.slice(0, Math.max(room, 0))) {
      const prepared = await prepareImage(f);
      if (!/^image\/(jpeg|png|webp)$/.test(prepared.type)) return setError(t("err.photo_type_invalid"));
      if (!fitsLimit(prepared)) return setError(t("err.photo_too_large"));
      accepted.push({ key: ++keyCounter, file: prepared, caption: "" });
    }
    setQueued((q) => ({ ...q, [block]: [...q[block], ...accepted] }));
  };
  const removeQueued = (block, key) => setQueued((q) => ({ ...q, [block]: q[block].filter((x) => x.key !== key) }));
  const setCaption = (block, key, caption) => setQueued((q) => ({ ...q, [block]: q[block].map((x) => (x.key === key ? { ...x, caption } : x)) }));
  const removeSaved = async (photo) => {
    try {
      await api.delete(`/kaizens/${id}/photos/${photo.id}`);
      setSavedPhotos((p) => p.filter((x) => x.id !== photo.id));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const updateMeasure = (i, k, v) => setMeasures(measures.map((m, j) => (j === i ? { ...m, [k]: v } : m)));

  const buildBody = () => {
    const body = {
      title: form.title, category: form.category,
      area: orNull(form.area), equipment: orNull(form.equipment), noticed_on: orNull(form.noticed_on),
      problem_text: form.problem_text, before_text: orNull(form.before_text), after_text: form.after_text,
      benefits_text: orNull(form.benefits_text), conclusion_text: orNull(form.conclusion_text),
      wastes: form.wastes, effects: form.effects,
      impl_status: form.impl_status, implemented_on: form.impl_status === "implemented" ? orNull(form.implemented_on) : null,
      effort: orNull(form.effort), currency: form.currency,
      cost_amount: num(form.cost_amount), saving_month_amount: num(form.saving_month_amount),
      participants: orNull(form.participants),
      measures: measures.map((m) => ({ name: m.name, unit: orNull(m.unit), before_value: Number(m.before_value), after_value: Number(m.after_value), better: m.better })),
    };
    if (!editing && form.member_id !== "") body.member_id = Number(form.member_id);
    return body;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setFieldError(null);
    setBusy(true);
    let kaizenId = id;
    try {
      const res = editing ? await api.put(`/kaizens/${id}`, buildBody()) : await api.post("/kaizens", buildBody());
      kaizenId = res.data.kaizen.id;
    } catch (err) {
      setFieldError(err?.response?.data?.field || null);
      setError(errorText(err) + (err?.response?.data?.field ? ` (${err.response.data.field})` : ""));
      setBusy(false);
      return;
    }
    // The card is saved; now the queued photos, one by one.
    let failed = 0;
    for (const block of PHOTO_BLOCKS) {
      for (const q of queued[block]) {
        try {
          await api.post(`/kaizens/${kaizenId}/photos`, q.file, {
            params: { block, caption: q.caption || undefined },
            headers: { "Content-Type": q.file.type },
            transformRequest: [(d) => d],
          });
        } catch {
          failed += 1;
        }
      }
    }
    navigate(`/kaizens/${kaizenId}`, { state: failed ? { uploadFailed: failed } : null });
  };

  if (loading) return <p className="muted">{t("common.loading")}</p>;

  const textBlock = (block, labelKey) => (
    <section className="card" key={block}>
      <h2>{t(labelKey)}{REQUIRED[block] ? " *" : ""}</h2>
      <textarea
        rows={5}
        aria-label={t(labelKey)}
        required={!!REQUIRED[block]}
        maxLength={5000}
        value={form[BLOCK_FIELD[block]]}
        onChange={set(BLOCK_FIELD[block])}
        aria-invalid={fieldError === BLOCK_FIELD[block]}
      />
      <PhotoBlock
        kaizenId={id}
        saved={savedPhotos.filter((p) => p.block === block)}
        queued={queued[block]}
        onAdd={(files) => addFiles(block, files)}
        onRemoveQueued={(key) => removeQueued(block, key)}
        onRemoveSaved={removeSaved}
        onCaption={(key, c) => setCaption(block, key, c)}
      />
    </section>
  );

  return (
    <form className="stack" onSubmit={onSubmit}>
      <h1>{editing ? t("kz.form.titleEdit", { n: id }) : t("kz.form.titleNew")}</h1>

      <section className="card">
        <h2>{t("kz.form.general")}</h2>
        <label>{t("kz.form.title")} *<input value={form.title} onChange={set("title")} required minLength={3} maxLength={200} /></label>
        <div className="grid-2 tight">
          <label>{t("kz.form.category")} *
            <select value={form.category} onChange={set("category")}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t(`kz.cat.${c}`)}</option>)}
            </select>
          </label>
          <label>{t("kz.form.noticed")}<input type="date" value={form.noticed_on} onChange={set("noticed_on")} /></label>
          <label>{t("kz.form.area")}<input value={form.area} onChange={set("area")} maxLength={150} /></label>
          <label>{t("kz.form.equipment")}<input value={form.equipment} onChange={set("equipment")} maxLength={150} /></label>
        </div>
        {!editing && (
          <label>{t("kz.form.author")}
            <select value={form.member_id} onChange={set("member_id")}>
              <option value="">{t("kz.form.authorSelf", { name: `№${user.tabel_number} ${user.full_name}` })}</option>
              {memberOptions.map(({ member, depth }) => (
                <option key={member.id} value={member.id}>{"— ".repeat(depth)}№{member.tabel_number} {member.full_name} · {member.post_title}</option>
              ))}
            </select>
          </label>
        )}
        <fieldset className="plain">
          <legend>{t("kz.form.wastes")}</legend>
          <Chips options={WASTES} value={form.wastes} onChange={(v) => setForm({ ...form, wastes: v })} labelOf={(o) => t(`kz.waste.${o}`)} />
        </fieldset>
        <fieldset className="plain">
          <legend>{t("kz.form.effects")}</legend>
          <Chips options={EFFECTS} value={form.effects} onChange={(v) => setForm({ ...form, effects: v })} labelOf={(o) => t(`kz.effect.${o}`)} />
        </fieldset>
      </section>

      {textBlock("problem", "kz.form.problem")}
      {textBlock("before", "kz.form.before")}
      {textBlock("after", "kz.form.after")}
      {textBlock("benefits", "kz.form.benefits")}

      <section className="card">
        <h2>{t("kz.form.measures")}</h2>
        <p className="muted small">{t("kz.form.measuresHint")}</p>
        {measures.map((m, i) => {
          const pct = changePct(m.before_value, m.after_value);
          const good = isImproved(m.before_value, m.after_value, m.better);
          return (
            <div key={i} className="measure-row">
              <input aria-label={t("kz.form.measureName")} placeholder={t("kz.form.measureName")} value={m.name} onChange={(e) => updateMeasure(i, "name", e.target.value)} required maxLength={120} />
              <input aria-label={t("kz.form.measureUnit")} placeholder={t("kz.form.measureUnit")} className="narrow-input" value={m.unit} onChange={(e) => updateMeasure(i, "unit", e.target.value)} maxLength={30} />
              <input aria-label={t("kz.form.measureBefore")} placeholder={t("kz.form.measureBefore")} type="number" step="any" inputMode="decimal" className="narrow-input" value={m.before_value} onChange={(e) => updateMeasure(i, "before_value", e.target.value)} required />
              <input aria-label={t("kz.form.measureAfter")} placeholder={t("kz.form.measureAfter")} type="number" step="any" inputMode="decimal" className="narrow-input" value={m.after_value} onChange={(e) => updateMeasure(i, "after_value", e.target.value)} required />
              <select aria-label="better" value={m.better} onChange={(e) => updateMeasure(i, "better", e.target.value)}>
                {BETTER.map((b) => <option key={b} value={b}>{t(`kz.better.${b}`)}</option>)}
              </select>
              <span className={`delta ${good === true ? "good" : good === false ? "bad" : ""}`}>{pct === null ? "" : `${pct > 0 ? "+" : ""}${pct}%`}</span>
              <button type="button" className="btn btn-sm btn-danger" aria-label={t("kz.form.measureRemove")} onClick={() => setMeasures(measures.filter((_, j) => j !== i))}>×</button>
            </div>
          );
        })}
        <button type="button" className="btn btn-sm" disabled={measures.length >= MAX_MEASURES} onClick={() => setMeasures([...measures, { name: "", unit: "", before_value: "", after_value: "", better: "lower" }])}>+ {t("kz.form.measureAdd")}</button>
      </section>

      <section className="card">
        <h2>{t("kz.form.impl")}</h2>
        <div className="grid-2 tight">
          <label>{t("kz.form.implStatus")}
            <select value={form.impl_status} onChange={set("impl_status")}>
              {IMPL_STATUSES.map((s) => <option key={s} value={s}>{t(`kz.impl.${s}`)}</option>)}
            </select>
          </label>
          {form.impl_status === "implemented" && <label>{t("kz.form.implementedOn")}<input type="date" value={form.implemented_on} onChange={set("implemented_on")} /></label>}
          <label>{t("kz.form.effort")}
            <select value={form.effort} onChange={set("effort")}>
              <option value="">{t("common.none")}</option>
              {EFFORTS.map((s) => <option key={s} value={s}>{t(`kz.effort.${s}`)}</option>)}
            </select>
          </label>
          <label>{t("kz.form.currency")}
            <select value={form.currency} onChange={set("currency")}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
          <label>{t("kz.form.cost")}<input type="number" min="0" step="any" inputMode="decimal" value={form.cost_amount} onChange={set("cost_amount")} /></label>
          <label>{t("kz.form.saving")}<input type="number" min="0" step="any" inputMode="decimal" value={form.saving_month_amount} onChange={set("saving_month_amount")} /></label>
        </div>
        <label>{t("kz.form.participants")}<input value={form.participants} onChange={set("participants")} maxLength={500} /></label>
      </section>

      {textBlock("conclusion", "kz.form.conclusion")}

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <div className="row sticky-actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? t("kz.form.saving.progress") : editing ? t("kz.form.save") : t("kz.form.submit")}</button>
        <button className="btn" type="button" onClick={() => navigate(-1)}>{t("common.cancel")}</button>
      </div>
    </form>
  );
}
