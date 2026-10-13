// Data helpers shared by the pages: signed URLs, uploads, thumbnails, cached look-ups.
import { sb } from './supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET } from '../config.js';
import { state } from './state.js';

// ------------------------------------------------------------------ select lists
export const ASSET_LIST_SELECT =
  'id,title,description,filename,mime_type,file_size,category,status,confidentiality,thumbnail_path,project_id,program_id,uploaded_by,created_at,updated_at,published_at,deleted_at,version,' +
  'project:projects(id,name),program:program_areas(id,name,name_sw,color),uploader:profiles!uploaded_by(full_name)';

export const PUBLIC_ASSET_SELECT =
  'id,title,description,mime_type,file_size,category,thumbnail_path,storage_path,country,region,district,creator,copyright_holder,usage_rights,published_at,public_download,keywords,cdn_public_id,cdn_resource_type,cdn_version,' +
  'program:program_areas(id,name,name_sw,color,slug),project:projects(id,name),asset_tags(tag:tags(name))';

// ------------------------------------------------------------------ signed URLs
const urlCache = new Map(); // path -> { url, exp }
export async function signedUrls(paths, expires = 3600) {
  const now = Date.now();
  const need = [...new Set(paths.filter(Boolean))].filter((p) => !(urlCache.get(p)?.exp > now));
  if (need.length) {
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(need, expires);
    (data || []).forEach((r) => {
      if (r.signedUrl) urlCache.set(r.path, { url: r.signedUrl, exp: now + (expires - 120) * 1000 });
    });
  }
  return new Map(paths.filter(Boolean).map((p) => [p, urlCache.get(p)?.url || null]));
}
export async function signedUrl(path, expires = 3600) {
  return (await signedUrls([path], expires)).get(path);
}

/** Fill every <img data-thumb="path"> inside root with a signed URL. */
export async function hydrateThumbs(root = document) {
  const els = [...root.querySelectorAll('[data-thumb]')];
  if (!els.length) return;
  const map = await signedUrls(els.map((e) => e.dataset.thumb));
  els.forEach((el) => {
    const url = map.get(el.dataset.thumb);
    if (!url) { el.closest('.thumb')?.classList.add('no-img'); el.remove(); return; }
    el.addEventListener('error', () => { el.closest('.thumb')?.classList.add('no-img'); el.remove(); }, { once: true });
    el.src = url;
  });
}

export async function downloadAsset(asset, { path, filename } = {}) {
  const p = path || asset.storage_path;
  const name = filename || asset.filename || asset.title;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(p, 120, { download: name });
  if (error || !data?.signedUrl) throw new Error(error?.message || 'Could not prepare the download.');
  const a = Object.assign(document.createElement('a'), { href: data.signedUrl, rel: 'noopener' });
  document.body.appendChild(a); a.click(); a.remove();
  if (state.user) logEvent('asset.download', asset);
  sb.rpc('track_asset_event', { p_asset: asset.id, p_kind: 'download' }).then(() => {}, () => {});
}

export async function logEvent(action, entity = {}, metadata = {}) {
  if (!state.user) return;
  await sb.from('activity_logs').insert({
    actor_id: state.user.id,
    actor_name: state.profile?.full_name || state.profile?.email,
    action,
    entity_type: entity.entity_type || 'asset',
    entity_id: entity.id || null,
    entity_title: entity.title || entity.name || null,
    metadata,
  }).then(() => {}, () => {});
}

// ------------------------------------------------------------------ cached reference data
const refCache = {};
const loaders = {
  tags: () => sb.from('tags').select('id,name,slug,is_standard').order('name'),
  projects: () => sb.from('projects').select('id,name,code,program_id,status,is_restricted,manager_id,description,geographic_coverage,start_date,end_date').order('name'),
  staff: () => sb.from('profiles').select('id,full_name,email,role,status').neq('role', 'external').eq('status', 'active').order('full_name'),
  fields: () => sb.from('metadata_fields').select('*').eq('is_active', true).order('sort_order'),
};
export async function ref(name, force = false) {
  if (!refCache[name] || force) {
    const { data } = await loaders[name]();
    refCache[name] = data || [];
  }
  return refCache[name];
}
export const invalidateRef = (name) => { delete refCache[name]; };

// ------------------------------------------------------------------ uploads
export function uploadWithProgress(path, blob, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    sb.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token;
      if (!token) return reject(new Error('Your session has expired. Please sign in again.'));
      const fd = new FormData();
      fd.append('cacheControl', '3600');
      fd.append('', new Blob([blob], { type: contentType }), 'file');
      const xhr = new XMLHttpRequest();
      const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
      xhr.open('POST', url);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
      xhr.onerror = () => reject(new Error('Network error while uploading. Check your connection and retry.'));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        let msg = 'Upload failed.';
        try { msg = JSON.parse(xhr.responseText).message || msg; } catch { /* ignore */ }
        if (/mime/i.test(msg)) msg = 'This file type is not allowed.';
        if (/size|exceed/i.test(msg)) msg = 'This file is larger than the allowed upload size.';
        reject(new Error(msg));
      };
      xhr.send(fd);
    });
  });
}

export async function removeObjects(paths) {
  const list = paths.filter(Boolean);
  if (list.length) await sb.storage.from(BUCKET).remove(list);
}

// ------------------------------------------------------------------ thumbnails
async function drawScaled(source, w, h, max = 640) {
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.82));
}
/** True when a thumbnail blob is (almost) one flat colour, e.g. a black first frame. */
async function isBlank(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width = 16; c.height = 16;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, 16, 16); bmp.close?.();
    const d = ctx.getImageData(0, 0, 16, 16).data;
    let sum = 0; const lum = [];
    for (let i = 0; i < d.length; i += 4) { const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; lum.push(l); sum += l; }
    const mean = sum / lum.length;
    const sd = Math.sqrt(lum.reduce((a, l) => a + (l - mean) ** 2, 0) / lum.length);
    return sd < 3;
  } catch { return false; }
}

/** Grab a representative frame from a video (File blob URL or CORS-enabled URL). */
async function videoFrame(src, { cors = false } = {}) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  if (cors) v.crossOrigin = 'anonymous';
  v.src = src;
  const wait = (ev, ms) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout ${ev}`)), ms);
    v.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true });
    v.addEventListener('error', () => { clearTimeout(t); rej(new Error('video error')); }, { once: true });
  });
  try {
    await wait('loadedmetadata', 12000);
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 2;
    let last = null;
    for (const frac of [0.1, 0.35, 0.6]) {
      try {
        v.currentTime = Math.max(0.05, Math.min(dur * frac, dur - 0.05));
        await wait('seeked', 8000);
        if (v.readyState < 2) await wait('loadeddata', 8000);
        const blob = await drawScaled(v, v.videoWidth || 640, v.videoHeight || 360);
        if (blob) { last = blob; if (!(await isBlank(blob))) return blob; }
      } catch { /* try the next position */ }
    }
    return last;
  } finally { v.removeAttribute('src'); v.load(); }
}

export async function makeThumbnail(file, mime) {
  try {
    if (mime.startsWith('image/') && mime !== 'image/tiff') {
      const bmp = await createImageBitmap(file);
      const blob = await drawScaled(bmp, bmp.width, bmp.height);
      bmp.close?.();
      return blob;
    }
    if (mime.startsWith('video/')) {
      const url = URL.createObjectURL(file);
      try { return await videoFrame(url); } finally { URL.revokeObjectURL(url); }
    }
  } catch { /* thumbnails are optional */ }
  return null;
}

/** Same as makeThumbnail but from a (signed) URL, used to repair videos that have no thumbnail yet. */
export async function makeThumbnailFromUrl(url, mime) {
  try {
    if (mime.startsWith('video/')) return await videoFrame(url, { cors: true });
    if (mime.startsWith('image/') && mime !== 'image/tiff') {
      const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url;
      await img.decode();
      return await drawScaled(img, img.naturalWidth, img.naturalHeight);
    }
  } catch { /* optional */ }
  return null;
}

export async function uploadThumbnail(assetId, blob) {
  if (!blob) return null;
  const path = `${assetId}/thumb-${Date.now().toString(36)}.jpg`;
  try { await uploadWithProgress(path, blob, 'image/jpeg'); return path; } catch { return null; }
}

// ------------------------------------------------------------------ misc
export function friendlyError(err) {
  const m = err?.message || String(err || 'Something went wrong');
  if (/row-level security|permission denied|42501/i.test(m)) return 'You do not have permission to do that.';
  if (/duplicate key/i.test(m)) return 'That already exists.';
  if (/violates check constraint "assets_published_must_be_public"/i.test(m)) return 'Only assets classified as Public can be published.';
  return m.replace(/^error:\s*/i, '');
}
