import { useEffect, useMemo, useRef } from "react";
import { useI18n } from "../i18n";
import { MAX_PHOTOS_PER_BLOCK } from "../kaizenMeta";
import AuthImage from "./AuthImage";

/**
 * Photos of one block in the form. `saved` are photos already on the server (edit mode),
 * `queued` are chosen files that will be uploaded after the kaizen is saved.
 */
export default function PhotoBlock({ kaizenId, saved = [], queued, onAdd, onRemoveQueued, onRemoveSaved, onCaption }) {
  const { t } = useI18n();
  const input = useRef(null);
  const total = saved.length + queued.length;

  const previews = useMemo(() => queued.map((q) => URL.createObjectURL(q.file)), [queued]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  return (
    <div className="photos">
      <div className="photo-grid">
        {saved.map((p) => (
          <figure key={`s${p.id}`} className="photo">
            <AuthImage kaizenId={kaizenId} photoId={p.id} alt={p.caption || ""} />
            {p.caption && <figcaption>{p.caption}</figcaption>}
            <button type="button" className="photo-x" aria-label={t("kz.form.photoRemove")} onClick={() => onRemoveSaved(p)}>×</button>
          </figure>
        ))}
        {queued.map((q, i) => (
          <figure key={q.key} className="photo">
            <img src={previews[i]} alt="" />
            <input aria-label={t("kz.form.photoCaption")} placeholder={t("kz.form.photoCaption")} value={q.caption} maxLength={200} onChange={(e) => onCaption(q.key, e.target.value)} />
            <button type="button" className="photo-x" aria-label={t("kz.form.photoRemove")} onClick={() => onRemoveQueued(q.key)}>×</button>
          </figure>
        ))}
      </div>
      <div className="row">
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { onAdd([...e.target.files]); e.target.value = ""; }} />
        <button type="button" className="btn btn-sm" disabled={total >= MAX_PHOTOS_PER_BLOCK} onClick={() => input.current.click()}>📷 {t("kz.form.photosAdd")}</button>
        <span className="muted small">{total}/{MAX_PHOTOS_PER_BLOCK} · {t("kz.form.photosLimit", { n: MAX_PHOTOS_PER_BLOCK })}</span>
      </div>
    </div>
  );
}
