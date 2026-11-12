import { LANGUAGES, THEMES, useI18n } from "../i18n";
import { useAuth } from "../context/AuthContext";

/** Language + theme controls; used on the login screen and in the top bar. */
export default function Switchers() {
  const { lang, theme, t } = useI18n();
  const { savePreferences } = useAuth();
  return (
    <div className="switchers">
      <div className="seg" role="group" aria-label={t("profile.language")}>
        {LANGUAGES.map((l) => (
          <button key={l.code} type="button" className={lang === l.code ? "on" : ""} aria-pressed={lang === l.code} onClick={() => savePreferences({ language: l.code })}>
            {l.label}
          </button>
        ))}
      </div>
      <div className="seg" role="group" aria-label={t("profile.theme")}>
        {THEMES.map((name) => (
          <button key={name} type="button" className={theme === name ? "on" : ""} aria-pressed={theme === name} title={t(`theme.${name}`)} onClick={() => savePreferences({ theme: name })}>
            {name === "light" ? "☀" : name === "dark" ? "☾" : "◐"}
          </button>
        ))}
      </div>
    </div>
  );
}
