import { useEffect, useState } from "react";
import api from "../api";
import { useI18n } from "../i18n";

/** Photos are protected by the login token, so <img src> cannot load them directly: fetch as a blob. */
export default function AuthImage({ kaizenId, photoId, alt, className }) {
  const { t } = useI18n();
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let url = null;
    let cancelled = false;
    api
      .get(`/kaizens/${kaizenId}/photos/${photoId}`, { responseType: "blob" })
      .then((res) => {
        if (cancelled) return;
        url = URL.createObjectURL(res.data);
        setSrc(url);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [kaizenId, photoId]);

  if (failed) return <div className="photo-missing">{t("kz.view.noPhoto")}</div>;
  if (!src) return <div className="photo-missing">…</div>;
  return <img className={className} src={src} alt={alt || ""} />;
}
