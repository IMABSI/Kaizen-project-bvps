import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "../api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    const token = localStorage.getItem("kaizen_token");
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await api.get("/auth/me");
      setUser(res.data.user);
    } catch (e) {
      localStorage.removeItem("kaizen_token");
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const login = async (login, password) => {
    const res = await api.post("/auth/login", { login, password });
    localStorage.setItem("kaizen_token", res.data.token);
    setUser(res.data.user);
    return res.data.user;
  };

  const logout = () => {
    localStorage.removeItem("kaizen_token");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, logout, refresh: loadMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
