import { useEffect, useState } from "react";
import api from "../api";
import { useI18n } from "../i18n";

export default function AdminStructure() {
  const { t, errorText } = useI18n();
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState({ name: "", description: "" });
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");

  const load = () => api.get("/structure/departments").then((r) => setDepartments(r.data.departments)).catch((e) => setError(errorText(e)));
  useEffect(() => { load(); }, []); // eslint-disable-line

  const run = async (fn) => {
    setError("");
    try {
      await fn();
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const add = (e) => {
    e.preventDefault();
    run(async () => {
      await api.post("/structure/departments", { name: form.name, description: form.description || null });
      setForm({ name: "", description: "" });
    });
  };
  const save = () => run(async () => {
    await api.put(`/structure/departments/${editing.id}`, { name: editing.name, description: editing.description || null });
    setEditing(null);
  });
  const remove = (d) => {
    if (window.confirm(`${t("common.confirmDelete")}\n${t("structure.deleteNote")}`)) run(() => api.delete(`/structure/departments/${d.id}`));
  };

  return (
    <section className="card">
      <h2>{t("structure.title")}</h2>
      <form className="row" onSubmit={add}>
        <input placeholder={t("structure.name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input placeholder={t("structure.description")} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <button className="btn btn-primary" type="submit">{t("common.add")}</button>
      </form>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {departments.length === 0 && <p className="muted">{t("structure.empty")}</p>}
      <ul className="list">
        {departments.map((d) => (
          <li key={d.id} className="item">
            {editing?.id === d.id ? (
              <div className="row">
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                <input value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                <button className="btn btn-primary" onClick={save}>{t("common.save")}</button>
                <button className="btn" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
              </div>
            ) : (
              <div className="item-head">
                <div><strong>{d.name}</strong>{d.description && <div className="muted small">{d.description}</div>}</div>
                <div className="row">
                  <button className="btn" onClick={() => setEditing({ ...d })}>{t("common.edit")}</button>
                  <button className="btn btn-danger" onClick={() => remove(d)}>{t("common.delete")}</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
