import { MAX_PHOTO_BYTES } from "./kaizenMeta";

const MAX_SIDE = 1600;

/**
 * Phone photos are often 5–12 MB. Shrink them in the browser (longest side 1600 px, JPEG) before upload.
 * If the browser cannot do it, the original is returned and the server's size limit still applies.
 */
export async function prepareImage(file) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  if (file.size <= 400 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (blob && blob.size < file.size) return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    /* fall back to the original */
  }
  return file;
}

export function fitsLimit(file) {
  return file.size <= MAX_PHOTO_BYTES;
}
