import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { I18nProvider, useI18n } from "./i18n";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Activate from "./pages/Activate";
import Dashboard from "./pages/Dashboard";
import Team from "./pages/Team";
import Profile from "./pages/Profile";
import AdminStructure from "./pages/AdminStructure";
import AdminUsers from "./pages/AdminUsers";
import AdminKaizens from "./pages/AdminKaizens";
import "./App.css";

function Loading() {
  const { t } = useI18n();
  return <div className="center-page">{t("common.loading")}</div>;
}

export function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export function RequirePermission({ perms, children }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (!(user.is_super_admin || perms.some((p) => user[p]))) return <Navigate to="/" replace />;
  return children;
}

export function RedirectIfAuthed({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (user) return <Navigate to="/" replace />;
  return children;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<RedirectIfAuthed><Login /></RedirectIfAuthed>} />
      <Route path="/activate" element={<RedirectIfAuthed><Activate /></RedirectIfAuthed>} />
      <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="team" element={<Team />} />
        <Route path="profile" element={<Profile />} />
        <Route path="admin/structure" element={<RequirePermission perms={["perm_manage_structure"]}><AdminStructure /></RequirePermission>} />
        <Route path="admin/users" element={<RequirePermission perms={["perm_manage_users", "perm_manage_admins"]}><AdminUsers /></RequirePermission>} />
        <Route path="admin/kaizens" element={<RequirePermission perms={["perm_manage_kaizens"]}><AdminKaizens /></RequirePermission>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </I18nProvider>
  );
}
