// Cloudinary delivery for PUBLISHED photos and videos only.
// - The private original always stays in Supabase Storage (downloads still come from there).
// - On publish we mirror an optimised copy to Cloudinary with an unsigned preset.
// - Public pages use the CDN copy when one exists and fall back to Supabase signed URLs otherwise.
// Unsigned presets cannot delete, so on unpublish the copy must be removed in the Cloudinary
// Media Library (the id is shown to the person who unpublishes).
import { sb } from './supabase.js';
import { signedUrl } from './api.js';
import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET, CDN_MAX_IMAGE_BYTES, CDN_MAX_VIDEO_BYTES } from '../config.js';

const base = (type) => `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/${type}/upload`;
const enabled = () => !!(CLOUDINARY_CLOUD_NAME && CLOUDINARY_UPLOAD_PRESET);

export const cdnEligible = (a) => enabled() && (
  (a.category === 'photo' && a.mime_type !== 'image/tiff' && (a.file_size || 0) <= CDN_MAX_IMAGE_BYTES) ||
  (a.category === 'video' && (a.file_size || 0) <= CDN_MAX_VIDEO_BYTES));

/** Optimised URL for a published asset that has a CDN copy, else null. */
export function cdnUrl(a, { w = 1600, h, crop = 'limit' } = {}) {
  if (!a?.cdn_public_id || !enabled()) return null;
  const ver = a.cdn_version ? `v${a.cdn_version}/` : '';
  const size = [w && `w_${w}`, h && `h_${h}`, `c_${crop}`].filter(Boolean).join(',');
  const type = a.cdn_resource_type === 'video' ? 'video' : 'image';
  return `${base(type)}/f_auto,q_auto,${size}/${ver}${a.cdn_public_id}`;
}

/** Square-ish card thumbnail (video: first frame as JPEG). */
export function cdnThumb(a, w = 480, h = 360) {
  if (!a?.cdn_public_id || !enabled()) return null;
  const ver = a.cdn_version ? `v${a.cdn_version}/` : '';
  if (a.cdn_resource_type === 'video') return `${base('video')}/so_0,w_${w},h_${h},c_fill,g_auto,f_jpg,q_auto/${ver}${a.cdn_public_id}.jpg`;
  return `${base('image')}/f_auto,q_auto,w_${w},h_${h},c_fill,g_auto/${ver}${a.cdn_public_id}`;
}

/**
 * Copy a published photo/video to Cloudinary and remember where it went.
 * Never throws: the public library keeps working from Supabase if this fails.
 * Returns { ok, publicId?, skipped?, error? }.
 */
export async function mirrorToCdn(assetId) {
  try {
    const { data: a, error } = await sb.from('assets')
      .select('id,category,mime_type,file_size,storage_path,cdn_public_id,confidentiality,status').eq('id', assetId).maybeSingle();
    if (error || !a) return { ok: false, error: error?.message || 'Asset not found' };
    if (a.status !== 'published' || a.confidentiality !== 'public') return { ok: false, skipped: true };
    if (a.cdn_public_id) return { ok: true, publicId: a.cdn_public_id, skipped: true };
    if (!cdnEligible(a)) return { ok: false, skipped: true };

    const url = await signedUrl(a.storage_path, 300);
    if (!url) return { ok: false, error: 'Could not read the original file.' };
    const blob = await (await fetch(url)).blob();

    const type = a.category === 'video' ? 'video' : 'image';
    const form = new FormData();
    form.append('file', blob, a.id);
    form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    form.append('public_id', `terravault/${a.id}`);
    form.append('tags', 'terravault,public');
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${type}/upload`, { method: 'POST', body: form });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.public_id) return { ok: false, error: out?.error?.message || `Cloudinary error ${res.status}` };

    const { error: upErr } = await sb.from('assets')
      .update({ cdn_public_id: out.public_id, cdn_resource_type: type, cdn_version: out.version || null }).eq('id', a.id);
    if (upErr) return { ok: false, error: upErr.message };
    return { ok: true, publicId: out.public_id };
  } catch (err) {
    return { ok: false, error: err?.message || 'Upload failed' };
  }
}

/** CDN id (if any) of an asset, for the "delete it in Cloudinary" reminder. */
export async function cdnIdOf(assetId) {
  const { data } = await sb.from('assets').select('cdn_public_id').eq('id', assetId).maybeSingle();
  return data?.cdn_public_id || null;
}
