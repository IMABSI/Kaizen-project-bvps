import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Approvals from "./pages/Approvals";
import AdminStructure from "./pages/AdminStructure";
import AdminUsers from "./pages/AdminUsers";
import AdminKaizens from "./pages/AdminKaizens";
import "./App.css";

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-page">Загрузка...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function RequirePermission({ perms, children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-page">Загрузка...</div>;
  if (!user) return <Navigate to="/login" replace />;
  const allowed = user.is_super_admin || perms.some((p) => user[p]);
  if (!allowed) return <Navigate to="/" replace />;
  return children;
}

function RedirectIfAuthed({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-page">Загрузка...</div>;
  if (user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route
            path="/login"
            element={
              <RedirectIfAuthed>
                <Login />
              </RedirectIfAuthed>
            }
          />
          <Route
            path="/register"
            element={
              <RedirectIfAuthed>
                <Register />
              </RedirectIfAuthed>
            }
          />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="approvals" element={<Approvals />} />
            <Route
              path="admin/structure"
              element={
                <RequirePermission perms={["perm_manage_structure"]}>
                  <AdminStructure />
                </RequirePermission>
              }
            />
            <Route
              path="admin/users"
              element={
                <RequirePermission perms={["perm_manage_users", "perm_manage_admins"]}>
                  <AdminUsers />
                </RequirePermission>
              }
            />
            <Route
              path="admin/kaizens"
              element={
                <RequirePermission perms={["perm_manage_kaizens"]}>
                  <AdminKaizens />
                </RequirePermission>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
