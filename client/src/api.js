import axios from "axios";

const TOKEN_KEY = "kaizen_token";

const api = axios.create({ baseURL: "/api" });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// If the server says our session is no longer valid (expired token, account disabled or deleted),
// drop the token and go to the login page instead of leaving the user on a broken screen.
// Failed login attempts also return 401, so they are excluded.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error?.config?.url || "";
    const hadToken = !!localStorage.getItem(TOKEN_KEY);
    if (error?.response?.status === 401 && hadToken && !url.includes("/auth/login")) {
      localStorage.removeItem(TOKEN_KEY);
      if (window.location.pathname !== "/login") window.location.assign("/login");
    }
    return Promise.reject(error);
  }
);

export function apiErrorMessage(err, fallback = "Произошла ошибка") {
  return err?.response?.data?.error || err?.message || fallback;
}

export default api;
