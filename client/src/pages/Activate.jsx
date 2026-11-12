import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n";
import Switchers from "../components/Switchers";

export default function Activate() {
  const { activate } = useAuth();
  const { t, errorText } = useI18n();
  const navigate = useNavigate();
  const [form, setForm] = useState({ tabel: "", code: "", password: "", repeat: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (form.password !== form.repeat) return setError(t("activate.mismatch"));
    setBusy(true);
    try {
      await activate(form.tabel.trim(), form.code, form.password);
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
        <h1>{t("activate.title")}</h1>
        <p className="muted">{t("activate.intro")}</p>
        <form onSubmit={onSubmit}>
          <label>{t("login.tabel")}<input inputMode="numeric" value={form.tabel} onChange={set("tabel")} required autoFocus /></label>
          <label>{t("activate.code")}<input className="mono" autoCapitalize="characters" autoComplete="off" value={form.code} onChange={set("code")} required /></label>
          <label>{t("activate.newPassword")}<input type="password" autoComplete="new-password" value={form.password} onChange={set("password")} required /></label>
          <label>{t("activate.repeat")}<input type="password" autoComplete="new-password" value={form.repeat} onChange={set("repeat")} required /></label>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <button className="btn btn-primary wide" type="submit" disabled={busy}>{t("activate.submit")}</button>
        </form>
        <p className="small"><Link to="/login">{t("activate.back")}</Link></p>
      </div>
    </div>
  );
}
