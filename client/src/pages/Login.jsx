import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n";
import Switchers from "../components/Switchers";

export default function Login() {
  const { login } = useAuth();
  const { t, errorText } = useI18n();
  const navigate = useNavigate();
  const [tabel, setTabel] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(tabel.trim(), password);
      navigate("/");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-top"><Switchers /></div>
      <div className="card auth-card">
        <div className="brand big"><span className="brand-mark" aria-hidden="true" />Kaizen</div>
        <h1>{t("login.title")}</h1>
        <p className="muted">{t("login.subtitle")}</p>
        <form onSubmit={onSubmit}>
          <label>
            {t("login.tabel")}
            <input inputMode="numeric" autoComplete="username" value={tabel} onChange={(e) => setTabel(e.target.value)} required autoFocus />
          </label>
          <label>
            {t("login.password")}
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <button className="btn btn-primary wide" type="submit" disabled={busy}>{t("login.submit")}</button>
        </form>
        <p className="small"><Link to="/activate">{t("login.firstTime")}</Link></p>
      </div>
    </div>
  );
}
