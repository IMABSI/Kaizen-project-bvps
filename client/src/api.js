import axios from "axios";

export const TOKEN_KEY = "kaizen_token";

const api = axios.create({ baseURL: "/api" });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// If the server says our session is no longer valid (expired token, account disabled or deleted,
// password reset), drop the token and go to the login page. Failed logins / activations are excluded.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error?.config?.url || "";
    const hadToken = !!localStorage.getItem(TOKEN_KEY);
    const isAuthAttempt = url.includes("/auth/login") || url.includes("/auth/activate");
    if (error?.response?.status === 401 && hadToken && !isAuthAttempt) {
      localStorage.removeItem(TOKEN_KEY);
      if (window.location.pathname !== "/login") window.location.assign("/login");
    }
    return Promise.reject(error);
  }
);

export default api;
