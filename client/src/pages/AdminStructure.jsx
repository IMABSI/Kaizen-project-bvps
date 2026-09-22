import { useEffect, useState } from "react";
import api, { apiErrorMessage } from "../api";
import { buildTreeFromFlat } from "../positionTree";

function PositionNode({ node, onAddChild, onRename, onDelete }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);

  const submitAdd = (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    onAddChild(node.id, newName.trim());
    setNewName("");
    setAdding(false);
  };

  const submitRename = (e) => {
    e.preventDefault();
    if (!renameValue.trim()) return;
    onRename(node.id, renameValue.trim());
    setRenaming(false);
  };

  return (
    <li className="tree-node">
      <div className="tree-node-row">
        {renaming ? (
          <form className="inline-form" onSubmit={submitRename}>
            <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
            <button type="submit">Сохранить</button>
            <button type="button" className="btn-secondary" onClick={() => setRenaming(false)}>
              Отмена
            </button>
          </form>
        ) : (
          <>
            <strong>{node.name}</strong>
            <span className="row-actions">
              <button className="link-btn" onClick={() => setAdding((v) => !v)}>
                + подпункт
              </button>
              <button className="link-btn" onClick={() => setRenaming(true)}>
                переименовать
              </button>
              <button className="link-btn" onClick={() => onDelete(node.id)}>
                удалить
              </button>
            </span>
          </>
        )}
      </div>

      {adding && (
        <form className="inline-form" onSubmit={submitAdd} style={{ marginLeft: 20 }}>
          <input
            placeholder="Название подпункта"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
          />
          <button type="submit">Добавить</button>
        </form>
      )}

      {node.children?.length > 0 && (
        <ul className="tree-children">
          {node.children.map((child) => (
            <PositionNode key={child.id} node={child} onAddChild={onAddChild} onRename={onRename} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function AdminStructure() {
  const [departments, setDepartments] = useState([]);
  const [positions, setPositions] = useState([]);
  const [error, setError] = useState("");
  const [newDeptName, setNewDeptName] = useState("");
  const [rootAdd, setRootAdd] = useState({}); // department_id -> name

  const load = () => {
    Promise.all([api.get("/structure/departments"), api.get("/structure/positions")])
      .then(([d, p]) => {
        setDepartments(d.data.departments);
        setPositions(p.data.positions);
      })
      .catch((err) => setError(apiErrorMessage(err)));
  };

  useEffect(load, []);

  const addDepartment = async (e) => {
    e.preventDefault();
    setError("");
    if (!newDeptName.trim()) return;
    try {
      await api.post("/structure/departments", { name: newDeptName.trim() });
      setNewDeptName("");
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  };

  const deleteDepartment = async (id) => {
    if (!window.confirm("Удалить отдел вместе со всей структурой должностей? Пользователи потеряют привязку.")) return;
    try {
      await api.delete(`/structure/departments/${id}`);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  };

  const addPosition = async (departmentId, parentId, name) => {
    setError("");
    try {
      await api.post("/structure/positions", { department_id: departmentId, parent_id: parentId, name });
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  };

  const addRoot = (departmentId) => {
    const name = (rootAdd[departmentId] || "").trim();
    if (!name) return;
    addPosition(departmentId, null, name);
    setRootAdd({ ...rootAdd, [departmentId]: "" });
  };

  const renamePosition = async (id, name) => {
    setError("");
    try {
      await api.put(`/structure/positions/${id}`, { name });
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  };

  const deletePosition = async (id) => {
    if (!window.confirm("Удалить пункт вместе со всеми вложенными подпунктами? Пользователи потеряют привязку.")) return;
    setError("");
    try {
      await api.delete(`/structure/positions/${id}`);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  };

  return (
    <div>
      <section className="card">
        <h2>Добавить отдел</h2>
        <form className="inline-form" onSubmit={addDepartment}>
          <input placeholder="Название отдела" value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} />
          <button type="submit">Добавить отдел</button>
        </form>
        {error && <div className="alert alert-error">{error}</div>}
      </section>

      <div className="dept-grid">
        {departments.map((d) => {
          const tree = buildTreeFromFlat(positions, d.id, null);
          return (
            <section className="card" key={d.id}>
              <div className="kaizen-item-head">
                <h3>{d.name}</h3>
                <button className="btn-secondary" onClick={() => deleteDepartment(d.id)}>
                  Удалить отдел
                </button>
              </div>
              <p className="muted small">
                Структура произвольной вложенности: у любого пункта можно добавить подпункт. Заявку на регистрацию
                подтверждает тот, кто стоит на пункт выше по этому дереву (либо администратор — для самого верхнего
                уровня).
              </p>

              {tree.length === 0 && <p className="muted">Пока нет ни одной должности/подразделения.</p>}
              <ul className="tree-children tree-root">
                {tree.map((node) => (
                  <PositionNode key={node.id} node={node} onAddChild={addPosition.bind(null, d.id)} onRename={renamePosition} onDelete={deletePosition} />
                ))}
              </ul>

              <div className="inline-form">
                <input
                  placeholder="Название пункта верхнего уровня"
                  value={rootAdd[d.id] || ""}
                  onChange={(e) => setRootAdd({ ...rootAdd, [d.id]: e.target.value })}
                />
                <button onClick={() => addRoot(d.id)}>Добавить пункт верхнего уровня</button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
