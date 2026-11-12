import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import ru from "./ru";
import uz from "./uz";
import en from "./en";

export const DICTIONARIES = { ru, uz, en };
export const LANGUAGES = [
  { code: "ru", label: "RU" },
  { code: "uz", label: "UZ" },
  { code: "en", label: "EN" },
];
export const THEMES = ["light", "dark", "system"];
const LANG_KEY = "kaizen_lang";
const THEME_KEY = "kaizen_theme";

function readStored(key, allowed, fallback) {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode etc. */
  }
}

/** Looks up a key in the language, falling back to Russian, then to the key itself. */
export function translate(lang, key, vars) {
  let text = DICTIONARIES[lang]?.[key] ?? ru[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
  return text;
}

/** Turns an API error into text in the current language, using the server's stable `code`. */
export function translateError(lang, err) {
  const code = err?.response?.data?.code;
  if (code && DICTIONARIES[lang]?.[`err.${code}`]) return translate(lang, `err.${code}`);
  if (!err?.response) return translate(lang, "err.network");
  return err.response.data?.error || translate(lang, "err.generic");
}

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => readStored(LANG_KEY, Object.keys(DICTIONARIES), "ru"));
  const [theme, setThemeState] = useState(() => readStored(THEME_KEY, THEMES, "system"));

  useEffect(() => {
    document.documentElement.lang = lang === "uz" ? "uz-Latn" : lang;
  }, [lang]);

  useEffect(() => {
    const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media?.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    media?.addEventListener?.("change", apply);
    return () => media?.removeEventListener?.("change", apply);
  }, [theme]);

  const setLang = useCallback((l) => {
    if (!DICTIONARIES[l]) return;
    store(LANG_KEY, l);
    setLangState(l);
  }, []);
  const setTheme = useCallback((t) => {
    if (!THEMES.includes(t)) return;
    store(THEME_KEY, t);
    setThemeState(t);
  }, []);

  const value = useMemo(
    () => ({
      lang,
      theme,
      setLang,
      setTheme,
      t: (key, vars) => translate(lang, key, vars),
      errorText: (err) => translateError(lang, err),
    }),
    [lang, theme, setLang, setTheme]
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
