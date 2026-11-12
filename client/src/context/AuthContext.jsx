import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api, { TOKEN_KEY } from "../api";
import { useI18n } from "../i18n";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { setLang, setTheme } = useI18n();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Signed-in users get their saved language/theme applied.
  const adopt = useCallback(
    (u) => {
      setUser(u);
      if (u?.language) setLang(u.language);
      if (u?.theme) setTheme(u.theme);
    },
    [setLang, setTheme]
  );

  const loadMe = useCallback(async () => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await api.get("/auth/me");
      adopt(res.data.user);
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [adopt]);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const finishAuth = (data) => {
    localStorage.setItem(TOKEN_KEY, data.token);
    adopt(data.user);
    return data.user;
  };

  const login = async (tabel_number, password) =>
    finishAuth((await api.post("/auth/login", { tabel_number, password })).data);

  const activate = async (tabel_number, activation_code, new_password) =>
    finishAuth((await api.post("/auth/activate", { tabel_number, activation_code, new_password })).data);

  const changePassword = async (current_password, new_password) =>
    finishAuth((await api.put("/auth/me/password", { current_password, new_password })).data);

  const savePreferences = async (prefs) => {
    if (prefs.language) setLang(prefs.language);
    if (prefs.theme) setTheme(prefs.theme);
    if (!user) return;
    try {
      const res = await api.put("/auth/me/preferences", prefs);
      setUser(res.data.user);
    } catch {
      /* the choice still applies locally */
    }
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, activate, changePassword, savePreferences, logout, refresh: loadMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
