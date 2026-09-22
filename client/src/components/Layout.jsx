import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = () => {
    logout();
    navigate("/login");
  };

  const canStructure = user?.is_super_admin || user?.perm_manage_structure;
  const canUsers = user?.is_super_admin || user?.perm_manage_users || user?.perm_manage_admins;
  const canKaizens = user?.is_super_admin || user?.perm_manage_kaizens;

  const roleBadge = user?.is_super_admin ? "Супер админ" : user?.role_title || null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">Kaizen Platform</div>
        <nav>
          <NavLink to="/" end>
            Мои предложения
          </NavLink>
          <NavLink to="/approvals">Заявки на подтверждение</NavLink>
          {canStructure && <NavLink to="/admin/structure">Структура компании</NavLink>}
          {canUsers && <NavLink to="/admin/users">Пользователи</NavLink>}
          {canKaizens && <NavLink to="/admin/kaizens">Все предложения</NavLink>}
        </nav>
        <div className="user-box">
          <span>
            {user?.full_name} {roleBadge && <span className="badge">{roleBadge}</span>}
          </span>
          <button className="link-btn" onClick={onLogout}>
            Выйти
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
