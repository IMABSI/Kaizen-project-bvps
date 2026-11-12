import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api";
import { useI18n } from "../i18n";
import { buildTree, flattenTree, subtreeIds } from "../teamTree";

function ParentSelect({ tree, value, onChange, exclude, t }) {
  const options = flattenTree(tree).filter(({ member }) => !exclude?.has(member.id));
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}>
      <option value="">{t("team.root")}</option>
      {options.map(({ member, depth }) => (
        <option key={member.id} value={member.id}>{"— ".repeat(depth)}{member.full_name} (№{member.tabel_number})</option>
      ))}
    </select>
  );
}

export default function Team() {
  const { t, errorText } = useI18n();
  const [params] = useSearchParams();
  const ownerId = params.get("owner");
  const ownerQuery = ownerId ? `?owner_id=${ownerId}` : "";

  const [data, setData] = useState({ owner: null, members: [] });
  const [error, setError] = useState("");
  const [form, setForm] = useState({ tabel_number: "", full_name: "", post_title: "", parent_id: null });
  const [editing, setEditing] = useState(null);

  const tree = useMemo(() => buildTree(data.members), [data.members]);

  const load = () => api.get(`/team${ownerQuery}`).then((r) => setData(r.data)).catch((e) => setError(errorText(e)));
  useEffect(() => { load(); }, [ownerId]); // eslint-disable-line

  const run = async (fn) => {
    setError("");
    try {
      await fn();
      await load();
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    }
  };

  const add = async (e) => {
    e.preventDefault();
    const ok = await run(() => api.post("/team", { ...form, owner_id: ownerId ? Number(ownerId) : undefined }));
    if (ok) setForm({ tabel_number: "", full_name: "", post_title: "", parent_id: null });
  };
  const save = async () => {
    const ok = await run(() =>
      api.put(`/team/${editing.id}${ownerQuery}`, {
        tabel_number: editing.tabel_number,
        full_name: editing.full_name,
        post_title: editing.post_title,
        parent_id: editing.parent_id,
      })
    );
    if (ok) setEditing(null);
  };
  const remove = (m) => {
    if (window.confirm(`${t("common.confirmDelete")}\n${t("team.removeNote")}`)) run(() => api.delete(`/team/${m.id}${ownerQuery}`));
  };

  const renderNode = (node) => (
    <li key={node.id} className="tree-node">
      {editing?.id === node.id ? (
        <div className="edit-box">
          <div className="row">
            <input aria-label={t("common.tabel")} inputMode="numeric" className="narrow-input" value={editing.tabel_number} onChange={(e) => setEditing({ ...editing, tabel_number: e.target.value })} />
            <input aria-label={t("common.fullName")} value={editing.full_name} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} />
            <input aria-label={t("common.post")} value={editing.post_title} onChange={(e) => setEditing({ ...editing, post_title: e.target.value })} />
          </div>
          <div className="row">
            <ParentSelect tree={tree} t={t} value={editing.parent_id} exclude={subtreeIds(tree, node.id)} onChange={(v) => setEditing({ ...editing, parent_id: v })} />
            <button className="btn btn-primary" onClick={save}>{t("common.save")}</button>
            <button className="btn" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
          </div>
        </div>
      ) : (
        <div className="node-line">
          <span><span className="tabel">№{node.tabel_number}</span> <strong>{node.full_name}</strong> <span className="muted small">· {node.post_title}</span></span>
          <span className="row">
            <button className="btn btn-sm" onClick={() => setEditing({ id: node.id, tabel_number: String(node.tabel_number), full_name: node.full_name, post_title: node.post_title, parent_id: node.parent_id })}>{t("common.edit")}</button>
            <button className="btn btn-sm btn-danger" onClick={() => remove(node)}>{t("common.delete")}</button>
          </span>
        </div>
      )}
      {node.children.length > 0 && <ul className="tree">{node.children.map(renderNode)}</ul>}
    </li>
  );

  return (
    <div className="grid-2">
      <section className="card">
        <h2>{ownerId && data.owner ? t("team.ownerTeam", { name: data.owner.full_name }) : t("team.title")}</h2>
        <p className="muted small">{t("team.intro")}</p>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {tree.length === 0 ? <p className="muted">{t("team.empty")}</p> : <ul className="tree root">{tree.map(renderNode)}</ul>}
      </section>
      <section className="card">
        <h2>{t("team.add")}</h2>
        <form onSubmit={add}>
          <label>{t("common.tabel")}<input inputMode="numeric" value={form.tabel_number} onChange={(e) => setForm({ ...form, tabel_number: e.target.value })} required /></label>
          <label>{t("common.fullName")}<input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></label>
          <label>{t("common.post")}<input value={form.post_title} onChange={(e) => setForm({ ...form, post_title: e.target.value })} required /></label>
          <label>{t("team.parent")}<ParentSelect tree={tree} t={t} value={form.parent_id} onChange={(v) => setForm({ ...form, parent_id: v })} /></label>
          <button className="btn btn-primary" type="submit">{t("common.add")}</button>
        </form>
      </section>
    </div>
  );
}
