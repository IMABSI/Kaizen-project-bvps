import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n";
import { formatDateTime } from "../formatDate";

const PERMS = ["manage_structure", "manage_users", "manage_admins", "manage_kaizens", "view_kaizens"];

function CodeBox({ issued, t, lang, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.activation_code);
      setCopied(true);
    } catch {
      /* clipboard blocked: the code is visible anyway */
    }
  };
  return (
    <div className="alert alert-success code-box" role="status">
      <strong>{t("users.createdTitle")}: {issued.user.full_name} (№{issued.user.tabel_number})</strong>
      <div className="code mono">{issued.activation_code}</div>
      <div className="small">{t("users.codeNote", { date: formatDateTime(issued.activation_expires_at, lang) })}</div>
      <div className="row">
        <button className="btn" onClick={copy}>{copied ? t("common.copied") : t("common.copy")}</button>
        <button className="btn btn-ghost" onClick={onClose}>{t("common.close")}</button>
      </div>
    </div>
  );
}

function UserRow({ u, me, departments, t, onChanged, onError, onIssued }) {
  const [edit, setEdit] = useState(null);
  const canPerms = me.is_super_admin || me.perm_manage_admins;
  const canUsers = me.is_super_admin || me.perm_manage_users;
  const call = async (fn) => {
    onError("");
    try {
      const res = await fn();
      await onChanged();
      return res;
    } catch (err) {
      onError(err);
    }
  };

  return (
    <li className="item">
      <div className="item-head">
        <div>
          <span className="tabel">№{u.tabel_number}</span> <strong>{u.full_name}</strong>
          <div className="muted small">{u.post_title || t("common.none")} · {u.department?.name || t("common.none")}</div>
        </div>
        <div className="row">
          {u.needs_activation && <span className="pill pill-in_review">{t("users.badge.needsActivation")}</span>}
          {u.status === "disabled" && <span className="pill pill-rejected">{t("users.badge.disabled")}</span>}
          {u.is_super_admin ? <span className="badge">{t("role.superAdmin")}</span> : u.role_title && <span className="badge">{u.role_title}</span>}
        </div>
      </div>
      {canUsers && (
        <div className="row actions">
          <button className="btn btn-sm" onClick={() => setEdit(edit ? null : { tabel_number: String(u.tabel_number), full_name: u.full_name, post_title: u.post_title || "", department_id: u.department_id })}>{t("common.edit")}</button>
          <Link className="btn btn-sm" to={`/team?owner=${u.id}`}>{t("users.team")}</Link>
          {u.status === "active" && (
            <button className="btn btn-sm" onClick={async () => {
              if (!window.confirm(t("users.newCodeConfirm"))) return;
              const res = await call(() => api.post(`/users/${u.id}/activation-code`));
              if (res) onIssued(res.data);
            }}>{t("users.newCode")}</button>
          )}
          {u.id !== me.id && <button className="btn btn-sm" onClick={() => call(() => api.put(`/users/${u.id}`, { status: u.status === "active" ? "disabled" : "active" }))}>{u.status === "active" ? t("users.disable") : t("users.enable")}</button>}
          {u.id !== me.id && <button className="btn btn-sm btn-danger" onClick={() => window.confirm(t("common.confirmDelete")) && call(() => api.delete(`/users/${u.id}`))}>{t("common.delete")}</button>}
        </div>
      )}
      {edit && (
        <div className="edit-box">
          <div className="row">
            <input aria-label={t("common.tabel")} inputMode="numeric" className="narrow-input" value={edit.tabel_number} onChange={(e) => setEdit({ ...edit, tabel_number: e.target.value })} />
            <input aria-label={t("common.fullName")} value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} />
            <input aria-label={t("common.post")} value={edit.post_title} onChange={(e) => setEdit({ ...edit, post_title: e.target.value })} />
            <select aria-label={t("common.department")} value={edit.department_id ?? ""} onChange={(e) => setEdit({ ...edit, department_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{t("common.none")}</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button className="btn btn-primary" onClick={async () => { const r = await call(() => api.put(`/users/${u.id}`, edit)); if (r) setEdit(null); }}>{t("common.save")}</button>
          </div>
        </div>
      )}
      {canPerms && (
        <details className="perms">
          <summary>{t("users.permissions")}</summary>
          <div className="perm-grid">
            {me.is_super_admin && (
              <label className="check"><input type="checkbox" checked={!!u.is_super_admin} onChange={(e) => call(() => api.put(`/users/${u.id}/permissions`, { is_super_admin: e.target.checked }))} /> {t("users.superAdmin")}</label>
            )}
            {PERMS.map((p) => {
              const disabled = !me.is_super_admin && (p === "manage_admins" || !me[`perm_${p}`]);
              return (
                <label key={p} className="check">
                  <input type="checkbox" disabled={disabled} checked={!!u[`perm_${p}`]} onChange={(e) => call(() => api.put(`/users/${u.id}/permissions`, { [`perm_${p}`]: e.target.checked }))} /> {t(`perm.${p}`)}
                </label>
              );
            })}
            <label>{t("users.roleTitle")}
              <input defaultValue={u.role_title || ""} onBlur={(e) => e.target.value !== (u.role_title || "") && call(() => api.put(`/users/${u.id}/permissions`, { role_title: e.target.value || null }))} />
            </label>
          </div>
        </details>
      )}
    </li>
  );
}

export default function AdminUsers() {
  const { user: me } = useAuth();
  const { t, lang, errorText } = useI18n();
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [issued, setIssued] = useState(null);
  const [form, setForm] = useState({ tabel_number: "", full_name: "", post_title: "", department_id: "" });
  const canCreate = me.is_super_admin || me.perm_manage_users;

  const load = async () => {
    const params = {};
    if (filter !== "all") params.status = filter;
    if (q.trim()) params.q = q.trim();
    try {
      setUsers((await api.get("/users", { params })).data.users);
    } catch (err) {
      setError(errorText(err));
    }
  };
  useEffect(() => { load(); }, [filter, q]); // eslint-disable-line
  useEffect(() => { api.get("/structure/departments").then((r) => setDepartments(r.data.departments)).catch(() => {}); }, []);

  const create = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const res = await api.post("/users", {
        tabel_number: form.tabel_number.trim(),
        full_name: form.full_name,
        post_title: form.post_title || undefined,
        department_id: form.department_id ? Number(form.department_id) : null,
      });
      setIssued(res.data);
      setForm({ tabel_number: "", full_name: "", post_title: "", department_id: "" });
      load();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="stack">
      {canCreate && (
        <section className="card">
          <h2>{t("users.create")}</h2>
          <form className="row form-row" onSubmit={create}>
            <input aria-label={t("common.tabel")} placeholder={t("common.tabel")} inputMode="numeric" className="narrow-input" value={form.tabel_number} onChange={(e) => setForm({ ...form, tabel_number: e.target.value })} required />
            <input aria-label={t("common.fullName")} placeholder={t("common.fullName")} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
            <input aria-label={t("users.postDefault")} placeholder={t("users.postDefault")} value={form.post_title} onChange={(e) => setForm({ ...form, post_title: e.target.value })} />
            <select aria-label={t("common.department")} value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
              <option value="">{t("common.department")}</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button className="btn btn-primary" type="submit">{t("common.add")}</button>
          </form>
          {issued && <CodeBox issued={issued} t={t} lang={lang} onClose={() => setIssued(null)} />}
        </section>
      )}
      <section className="card">
        <h2>{t("users.title")}</h2>
        <div className="row">
          <input type="search" placeholder={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label={t("common.status")} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">{t("users.filter.all")}</option>
            <option value="active">{t("users.filter.active")}</option>
            <option value="disabled">{t("users.filter.disabled")}</option>
            <option value="needs_activation">{t("users.filter.needs")}</option>
          </select>
        </div>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {users.length === 0 && <p className="muted">{t("users.empty")}</p>}
        <ul className="list">
          {users.map((u) => (
            <UserRow key={u.id} u={u} me={me} departments={departments} t={t} onChanged={load}
              onError={(e) => setError(e ? errorText(e) : "")} onIssued={setIssued} />
          ))}
        </ul>
      </section>
    </div>
  );
}
