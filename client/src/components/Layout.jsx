import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n";
import Switchers from "./Switchers";

export default function Layout() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const onLogout = () => {
    logout();
    navigate("/login");
  };
  const close = () => setOpen(false);

  const sa = user?.is_super_admin;
  const canStructure = sa || user?.perm_manage_structure;
  const canUsers = sa || user?.perm_manage_users || user?.perm_manage_admins;
  const canKaizens = sa || user?.perm_manage_kaizens;
  const roleBadge = sa ? t("role.superAdmin") : user?.role_title || null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-row">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            Kaizen
          </div>
          <button className="menu-btn" aria-expanded={open} aria-label={t("nav.menu")} onClick={() => setOpen(!open)}>
            ☰
          </button>
        </div>
        <div className={`topbar-collapse ${open ? "open" : ""}`}>
          <nav onClick={close}>
            <NavLink to="/" end>{t("nav.myKaizens")}</NavLink>
            <NavLink to="/team">{t("nav.team")}</NavLink>
            {canKaizens && <NavLink to="/admin/kaizens">{t("nav.allKaizens")}</NavLink>}
            {canUsers && <NavLink to="/admin/users">{t("nav.users")}</NavLink>}
            {canStructure && <NavLink to="/admin/structure">{t("nav.structure")}</NavLink>}
          </nav>
          <div className="user-box">
            <Switchers />
            <NavLink to="/profile" className="user-name" onClick={close}>
              <span className="tabel">№{user?.tabel_number}</span> {user?.full_name}
              {roleBadge && <span className="badge">{roleBadge}</span>}
            </NavLink>
            <button className="btn btn-ghost" onClick={onLogout}>{t("nav.logout")}</button>
          </div>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
