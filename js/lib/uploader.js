// Multi-file uploader: validation, duplicate check, progress, retry, shared metadata.
import { sb } from './supabase.js';
import { state } from './state.js';
import { html, raw, esc, fmtBytes, extOf, EXT_MIME, mimeOfFile, categoryFromMime, sha256, CATEGORY_ICON } from './util.js';
import { t, tr } from './i18n.js';
import { icon } from './icons.js';
import { openModal, toast, withBusy } from './ui.js';
import { uploadWithProgress, uploadThumbnail, makeThumbnail, removeObjects, friendlyError } from './api.js';
import { loadMetaRefs, metaForm, bindMetaForm, readMeta, resolveTagIds } from './meta.js';

const HARD_LIMIT = 52428800; // matches the storage bucket limit (50 MB)
const ACCEPT = Object.keys(EXT_MIME).map((e) => `.${e}`).join(',');

const stripExt = (n) => n.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
const safeName = (n) => {
  const ext = extOf(n);
  const base = n.replace(/\.[^.]+$/, '').normalize('NFKD').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').slice(0, 90) || 'file';
  return `${base}.${ext}`;
};

export const maxUploadBytes = () => Math.min(Number(state.settings.max_upload_bytes) || HARD_LIMIT, HARD_LIMIT);

export function validateFile(file) {
  const ext = extOf(file.name);
  if (!EXT_MIME[ext]) return tr('This file type is not supported. Use photos, video, audio, PDF or Office documents.', 'Aina hii ya faili haitumiki. Tumia picha, video, sauti, PDF au nyaraka za Office.');
  if (file.size === 0) return tr('This file is empty.', 'Faili hili ni tupu.');
  if (file.size > maxUploadBytes()) return tr(`This file is larger than ${fmtBytes(maxUploadBytes())}.`, `Faili hili ni kubwa kuliko ${fmtBytes(maxUploadBytes())}.`);
  return null;
}

export async function openUploader({ project_id = null, files = [] } = {}) {
  const refs = await loadMetaRefs();
  let quota = { used: 0, cap: 0 };
  sb.rpc('dashboard_stats').then(({ data }) => { if (data) quota = { used: Number(data.storage_used) || 0, cap: Number(data.storage_quota) || 0 }; });

  const items = [];
  let uid = 0; let running = false; let anyDone = false;

  const modal = openModal({
    title: tr('Upload files', 'Pakia mafaili'), size: 'lg',
    body: html`
      <div class="dropzone" id="dz" tabindex="0" role="button" aria-label="${tr('Choose files to upload', 'Chagua mafaili ya kupakia')}">
        <span class="dz-ic">${raw(icon('upload', 30))}</span>
        <b>${tr('Drop files here or choose from your device', 'Weka mafaili hapa au chagua kutoka kifaa chako')}</b>
        <small>${tr(`Photos, video, audio, PDF and Office files up to ${fmtBytes(maxUploadBytes())} each.`, `Picha, video, sauti, PDF na mafaili ya Office hadi ${fmtBytes(maxUploadBytes())} kila moja.`)}</small>
        <input type="file" id="pick" multiple accept="${ACCEPT}" hidden>
      </div>
      <ul class="upload-list" id="queue" aria-live="polite"></ul>
      <form id="metaForm" class="upload-meta" novalidate>
        <h3>${tr('Details for every file', 'Maelezo ya kila faili')}</h3>
        <p class="muted-text">${tr('Files start as drafts and stay private until they are reviewed and published.', 'Mafaili huanza kama rasimu na hubaki faragha hadi yakaguliwe na kuchapishwa.')}</p>
        ${metaForm({ project_id, country: 'Tanzania' }, refs, { bulk: true })}
      </form>`,
    footer: html`<span class="foot-note" id="summary"></span>
      <button class="btn btn-ghost" data-close>${t('common.close')}</button>
      <button class="btn btn-primary" id="go" disabled>${raw(icon('upload', 18))}${tr('Start upload', 'Anza kupakia')}</button>`,
    onClose: () => { if (anyDone) window.dispatchEvent(new Event('tv:changed')); },
  });

  const el = modal.el;
  const q = (s) => el.querySelector(s);
  const tagCtl = bindMetaForm(q('#metaForm'), refs, []);

  const rowHtml = (it) => {
    const pct = Math.round((it.progress || 0) * 100);
    const label = {
      ready: tr('Ready', 'Tayari'), hashing: tr('Checking…', 'Inakagua…'), uploading: `${pct}%`,
      done: tr('Uploaded', 'Imepakiwa'), error: it.error, dup: tr('Already in the library', 'Tayari ipo kwenye maktaba'), invalid: it.error,
    }[it.status];
    return html`<li class="upload-row st-${it.status}" data-uid="${it.id}">
      <span class="u-ic">${raw(icon(CATEGORY_ICON[categoryFromMime(mimeOfFile(it.file))], 20))}</span>
      <span class="u-main">
        <input class="u-title" value="${it.title}" aria-label="${tr('Title', 'Kichwa')}" ${['ready', 'error', 'dup'].includes(it.status) ? '' : raw('disabled')} maxlength="300">
        <small>${it.file.name} · ${fmtBytes(it.file.size)}</small>
        ${it.status === 'uploading' || it.status === 'hashing' ? html`<span class="progress"><i style="width:${it.status === 'hashing' ? 4 : pct}%"></i></span>` : ''}
      </span>
      <span class="u-state"><span class="u-label">${label}</span>
        ${it.status === 'error' ? html`<button class="btn btn-ghost btn-sm" data-retry>${tr('Retry', 'Jaribu tena')}</button>` : ''}
        ${it.status === 'dup' ? html`<button class="btn btn-ghost btn-sm" data-dup>${tr('Upload anyway', 'Pakia hata hivyo')}</button>` : ''}
        ${['ready', 'error', 'dup', 'invalid'].includes(it.status) ? html`<button class="icon-btn" data-remove aria-label="${t('common.remove')}">${raw(icon('x', 16))}</button>` : ''}
      </span></li>`.s;
  };
  const paint = (it) => {
    const row = q(`[data-uid="${it.id}"]`);
    if (!row) return;
    const keep = row.querySelector('.u-title')?.value;
    row.outerHTML = rowHtml(it);
    if (keep != null && ['ready', 'error', 'dup'].includes(it.status)) { const n = q(`[data-uid="${it.id}"] .u-title`); if (n) n.value = keep; }
  };
  const updateFooter = () => {
    const ready = items.filter((i) => ['ready', 'error'].includes(i.status)).length;
    const done = items.filter((i) => i.status === 'done').length;
    q('#go').disabled = running || !ready;
    q('#summary').textContent = items.length ? tr(`${done} of ${items.length} uploaded`, `${done} kati ya ${items.length} zimepakiwa`) : '';
  };

  function add(list) {
    [...list].forEach((file) => {
      if (items.some((i) => i.file.name === file.name && i.file.size === file.size && i.status !== 'done')) return;
      const err = validateFile(file);
      const it = { id: ++uid, file, title: stripExt(file.name), status: err ? 'invalid' : 'ready', error: err, progress: 0 };
      items.push(it);
      q('#queue').insertAdjacentHTML('beforeend', rowHtml(it));
    });
    updateFooter();
  }

  async function process(it, meta, tagNames) {
    try {
      it.status = 'hashing'; it.error = null; paint(it);
      const checksum = await sha256(it.file);
      if (!it.allowDup) {
        const { data } = await sb.from('assets').select('id,title').eq('checksum', checksum).is('deleted_at', null).limit(1);
        if (data?.length) { it.status = 'dup'; paint(it); return; }
      }
      const id = crypto.randomUUID();
      const mime = mimeOfFile(it.file);
      const path = `${id}/${safeName(it.file.name)}`;
      it.status = 'uploading'; paint(it);
      let last = 0;
      await uploadWithProgress(path, it.file, mime, (p) => { if (p - last > 0.04 || p === 1) { last = p; it.progress = p; paint(it); } });
      const thumb = await uploadThumbnail(id, await makeThumbnail(it.file, mime));
      const row = {
        ...meta, id, title: (it.title || stripExt(it.file.name)).trim(), filename: it.file.name,
        storage_path: path, thumbnail_path: thumb, mime_type: mime, file_size: it.file.size,
        checksum, category: categoryFromMime(mime), status: 'draft',
      };
      const { error } = await sb.from('assets').insert(row);
      if (error) { await removeObjects([path, thumb]); throw error; }
      if (tagNames.length) {
        try {
          const ids = await resolveTagIds(tagNames);
          await sb.from('asset_tags').insert(ids.map((tag_id) => ({ asset_id: id, tag_id })));
        } catch { /* tags are optional; the file is already saved */ }
      }
      it.status = 'done'; it.assetId = id; anyDone = true; paint(it);
    } catch (err) {
      it.status = 'error'; it.error = friendlyError(err); paint(it);
    } finally { updateFooter(); }
  }

  async function run(only) {
    const form = q('#metaForm');
    const meta = readMeta(form, refs, { bulk: true });
    const tagNames = tagCtl.get();
    // pick up edited titles
    items.forEach((it) => { const v = q(`[data-uid="${it.id}"] .u-title`)?.value; if (v != null) it.title = v; });
    const todo = only ? [only] : items.filter((i) => ['ready', 'error'].includes(i.status));
    const total = todo.reduce((s, i) => s + i.file.size, 0);
    if (quota.cap && quota.used + total > quota.cap) {
      toast(tr(`This would exceed your storage allowance (${fmtBytes(quota.cap)}). Ask an administrator to raise it or remove old files.`, `Hii itazidi nafasi ya hifadhi (${fmtBytes(quota.cap)}). Muulize msimamizi aiongeze au ondoa mafaili ya zamani.`), 'error', 7000);
      return;
    }
    running = true; updateFooter();
    const queue = [...todo];
    const worker = async () => { while (queue.length) await process(queue.shift(), meta, tagNames); };
    await Promise.all([worker(), worker()]);
    running = false; updateFooter();
    const done = items.filter((i) => i.status === 'done').length;
    const failed = items.filter((i) => i.status === 'error').length;
    if (done) toast(tr(`${done} file(s) uploaded as drafts.`, `Mafaili ${done} yamepakiwa kama rasimu.`), failed ? 'info' : 'success');
    if (failed) toast(tr(`${failed} file(s) failed. You can retry them.`, `Mafaili ${failed} yameshindwa. Unaweza kuyajaribu tena.`), 'error');
  }

  const dz = q('#dz'); const pick = q('#pick');
  dz.addEventListener('click', () => pick.click());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick.click(); } });
  pick.addEventListener('change', () => { add(pick.files); pick.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', (e) => add(e.dataTransfer.files));
  q('#go').addEventListener('click', (e) => withBusy(e.currentTarget, run));

  q('#queue').addEventListener('click', (e) => {
    const row = e.target.closest('[data-uid]');
    if (!row) return;
    const it = items.find((i) => i.id === +row.dataset.uid);
    if (!it) return;
    if (e.target.closest('[data-remove]')) { items.splice(items.indexOf(it), 1); row.remove(); updateFooter(); }
    else if (e.target.closest('[data-retry]')) { it.status = 'ready'; paint(it); run(it); }
    else if (e.target.closest('[data-dup]')) { it.allowDup = true; it.status = 'ready'; paint(it); updateFooter(); }
  });

  if (files.length) add(files);
  return modal;
}
