import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n";
import Switchers from "../components/Switchers";

export default function Profile() {
  const { user, changePassword } = useAuth();
  const { t, errorText } = useI18n();
  const [form, setForm] = useState({ current: "", next: "" });
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setOk(false);
    try {
      await changePassword(form.current, form.next);
      setForm({ current: "", next: "" });
      setOk(true);
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="stack narrow">
      <section className="card">
        <h2>{t("profile.title")}</h2>
        <dl className="facts">
          <dt>{t("common.tabel")}</dt><dd className="mono">{user.tabel_number}</dd>
          <dt>{t("common.fullName")}</dt><dd>{user.full_name}</dd>
          <dt>{t("common.post")}</dt><dd>{user.post_title || t("common.none")}</dd>
          <dt>{t("common.department")}</dt><dd>{user.department?.name || t("common.none")}</dd>
        </dl>
        <Switchers />
      </section>
      <section className="card">
        <h2>{t("profile.changePassword")}</h2>
        <form onSubmit={onSubmit}>
          <label>{t("profile.current")}<input type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} required /></label>
          <label>{t("profile.new")}<input type="password" autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} required /></label>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          {ok && <div className="alert alert-success" role="status">{t("profile.passwordChanged")}</div>}
          <button className="btn btn-primary" type="submit">{t("common.save")}</button>
        </form>
      </section>
    </div>
  );
}
