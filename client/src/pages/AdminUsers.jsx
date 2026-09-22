import { Fragment, useEffect, useState } from "react";
import api, { apiErrorMessage } from "../api";
import { useAuth } from "../context/AuthContext";
import { buildTreeFromFlat, flattenTree, indentLabel } from "../positionTree";

const STATUS_LABELS = { pending: "Ожидает", approved: "Подтверждён", rejected: "Отклонён", disabled: "Отключён" };

const PERMISSIONS = [
  { key: "perm_manage_structure", label: "Структура компании" },
  { key: "perm_manage_users", label: "Пользователи" },
  { key: "perm_manage_admins", label: "Назначение прав" },
  { key: "perm_approve_any", label: "Подтверждать любые заявки" },
  { key: "perm_manage_kaizens", label: "Все кайдзен-предложения" },
];

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [positions, setPositions] = useState([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [openPerms, setOpenPerms] = useState(null); // user id currently editing permissions
  const [roleTitleDraft, setRoleTitleDraft] = useState("");

  const load = () => {
    const params = filter ? { status: filter } : {};
    Promise.all([
      api.get("/users", { params }),
      api.get("/structure/departments"),
      api.get("/structure/positions"),
    ])
      .then(([u, d, p]) => {
        setUsers(u.data.users);
        setDepartments(d.data.departments);
        setPositions(p.data.positions);
      })
      .catch((err) => setError(apiErrorMessage(err)));
  };

  useEffect(load, [filter]);

  const act = async (fn) => {
    setError("");
    try {
      await fn();
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  };

  const approve = (id) => act(() => api.post(`/users/${id}/approve`));
  const reject = (id) => act(() => api.post(`/users/${id}/reject`, { reason: window.prompt("Причина отклонения:") || "" }));
  const toggleDisabled = (u) =>
    act(() => api.put(`/users/${u.id}`, { status: u.status === "disabled" ? "approved" : "disabled" }));
  const removeUser = (id) => {
    if (!window.confirm("Удалить пользователя безвозвратно?")) return;
    act(() => api.delete(`/users/${id}`));
  };
  const resetPassword = (id) => {
    const pass = window.prompt("Новый пароль (мин. 6 символов):");
    if (!pass) return;
    act(() => api.post(`/users/${id}/reset-password`, { new_password: pass }));
  };
  const reassign = (u, department_id, position_id) =>
    act(() => api.put(`/users/${u.id}`, { department_id: Number(department_id), position_id: Number(position_id) }));

  const openPermEditor = (u) => {
    setOpenPerms(openPerms === u.id ? null : u.id);
    setRoleTitleDraft(u.role_title || "");
  };

  const togglePerm = (u, key) => act(() => api.put(`/users/${u.id}/permissions`, { [key]: !u[key] }));
  const saveRoleTitle = (u) => act(() => api.put(`/users/${u.id}/permissions`, { role_title: roleTitleDraft }));
  const toggleSuperAdmin = (u) => {
    if (!window.confirm(u.is_super_admin ? "Снять статус супер-администратора?" : "Назначить супер-администратором?")) return;
    act(() => api.put(`/users/${u.id}/permissions`, { is_super_admin: !u.is_super_admin }));
  };

  return (
    <div className="card">
      <div className="kaizen-item-head">
        <h2>Пользователи</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Все статусы</option>
          <option value="pending">Ожидают подтверждения</option>
          <option value="approved">Подтверждённые</option>
          <option value="rejected">Отклонённые</option>
          <option value="disabled">Отключённые</option>
        </select>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <table className="table">
        <thead>
          <tr>
            <th>ФИО</th>
            <th>Логин</th>
            <th>Отдел / Должность</th>
            <th>Статус</th>
            <th>Роль</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const flatPositions = flattenTree(buildTreeFromFlat(positions, u.department_id ?? u.department?.id, null));
            return (
              <Fragment key={u.id}>
                <tr>
                  <td>{u.full_name}</td>
                  <td>@{u.login}</td>
                  <td>
                    <select value={u.department_id || ""} onChange={(e) => reassign(u, e.target.value, u.position_id || "")}>
                      <option value="">—</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <select value={u.position_id || ""} onChange={(e) => reassign(u, u.department_id || "", e.target.value)}>
                      <option value="">—</option>
                      {flatPositions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {indentLabel(p)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className={`status-pill status-${u.status}`}>{STATUS_LABELS[u.status]}</span>
                  </td>
                  <td>
                    {u.is_super_admin ? (
                      <span className="badge">Супер админ</span>
                    ) : u.role_title || PERMISSIONS.some((p) => u[p.key]) ? (
                      <span className="badge">{u.role_title || "Права назначены"}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="row-actions">
                    {u.status === "pending" && (
                      <>
                        <button onClick={() => approve(u.id)}>Подтвердить</button>
                        <button className="btn-secondary" onClick={() => reject(u.id)}>
                          Отклонить
                        </button>
                      </>
                    )}
                    <button className="btn-secondary" onClick={() => openPermEditor(u)}>
                      {openPerms === u.id ? "Скрыть права" : "Права..."}
                    </button>
                    <button className="btn-secondary" onClick={() => toggleDisabled(u)}>
                      {u.status === "disabled" ? "Включить" : "Отключить"}
                    </button>
                    <button className="btn-secondary" onClick={() => resetPassword(u.id)}>
                      Сбросить пароль
                    </button>
                    <button className="btn-danger" onClick={() => removeUser(u.id)}>
                      Удалить
                    </button>
                  </td>
                </tr>
                {openPerms === u.id && (
                  <tr>
                    <td colSpan={6}>
                      <div className="card" style={{ margin: 0, background: "#f9fafb" }}>
                        <div className="inline-form">
                          <input
                            placeholder="Название роли (например: Модератор кайдзенов)"
                            value={roleTitleDraft}
                            onChange={(e) => setRoleTitleDraft(e.target.value)}
                          />
                          <button onClick={() => saveRoleTitle(u)}>Сохранить название</button>
                        </div>
                        <div className="perm-grid">
                          {PERMISSIONS.map((p) => (
                            <label key={p.key}>
                              <input type="checkbox" checked={!!u[p.key]} onChange={() => togglePerm(u, p.key)} />
                              {p.label}
                            </label>
                          ))}
                        </div>
                        {me?.is_super_admin && (
                          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <input type="checkbox" style={{ width: "auto" }} checked={!!u.is_super_admin} onChange={() => toggleSuperAdmin(u)} />
                            Супер-администратор (все права без ограничений)
                          </label>
                        )}
                        <p className="muted small">
                          Право «Назначение прав» и статус супер-администратора может менять только супер-администратор.
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
