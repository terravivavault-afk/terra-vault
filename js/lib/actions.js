// Shared asset actions: workflow, trash, sharing, collections, editing, replacing files.
import { sb } from './supabase.js';
import { BUCKET } from '../config.js';
import { state, can, isAdmin, canManageAsset } from './state.js';
import { html, raw, esc, fmtBytes, fmtDate, fmtDateTime, copyText, sha256, mimeOfFile, categoryFromMime } from './util.js';
import { t, tr } from './i18n.js';
import { icon } from './icons.js';
import { openModal, confirmDialog, promptDialog, toast, withBusy, options, emptyState } from './ui.js';
import { mirrorToCdn, cdnIdOf } from './cloudinary.js';
import { friendlyError, uploadWithProgress, uploadThumbnail, makeThumbnail, removeObjects, invalidateRef } from './api.js';
import { loadMetaRefs, metaForm, bindMetaForm, readMeta, resolveTagIds } from './meta.js';
import { validateFile } from './uploader.js';

const changed = () => window.dispatchEvent(new Event('tv:changed'));

async function updateAsset(id, patch, okMessage) {
  const { data, error } = await sb.from('assets').update(patch).eq('id', id).select('id');
  if (error) { toast(friendlyError(error), 'error', 6000); return false; }
  if (!data?.length) { toast(tr('You do not have permission to do that.', 'Huna ruhusa ya kufanya hivyo.'), 'error'); return false; }
  if (okMessage) toast(okMessage, 'success');
  return true;
}

// ------------------------------------------------------------------ workflow
export async function submitForReview(a) {
  const ok = await confirmDialog({
    title: tr('Submit for review?', 'Wasilisha kwa ukaguzi?'),
    message: tr('Reviewers will be notified. The file stays private until it is approved and published.', 'Wakaguzi wataarifiwa. Faili hubaki faragha hadi liidhinishwe na kuchapishwa.'),
    confirmText: tr('Submit for review', 'Wasilisha kwa ukaguzi'),
  });
  if (!ok) return false;
  const done = await updateAsset(a.id, { status: 'pending_review', status_note: null }, tr('Submitted for review.', 'Imewasilishwa kwa ukaguzi.'));
  if (done) changed();
  return done;
}

export async function submitMany(list) {
  const eligible = list.filter((a) => ['draft', 'changes_requested', 'rejected'].includes(a.status));
  if (!eligible.length) { toast(tr('Only drafts or assets with requested changes can be submitted.', 'Ni rasimu au mali zenye marekebisho yaliyoombwa tu zinazoweza kuwasilishwa.'), 'error'); return false; }
  const ok = await confirmDialog({
    title: tr(`Submit ${eligible.length} asset(s) for review?`, `Wasilisha mali ${eligible.length} kwa ukaguzi?`),
    message: tr('They stay private until approved and published.', 'Zinabaki faragha hadi ziidhinishwe na kuchapishwa.'),
    confirmText: tr('Submit for review', 'Wasilisha kwa ukaguzi'),
  });
  if (!ok) return false;
  let good = 0;
  for (const a of eligible) {
    const { data, error } = await sb.from('assets').update({ status: 'pending_review', status_note: null }).eq('id', a.id).select('id');
    if (!error && data?.length) good++;
  }
  toast(tr(`${good} submitted for review.`, `${good} zimewasilishwa kwa ukaguzi.`), good ? 'success' : 'error');
  changed();
  return good > 0;
}

export async function reviewAsset(a, decision) {
  const map = {
    approved: { title: tr('Approve this asset?', 'Idhinisha mali hii?'), required: false, ok: tr('Approve', 'Idhinisha'), done: tr('Approved.', 'Imeidhinishwa.'), label: tr('Comment (optional)', 'Maoni (si lazima)') },
    changes_requested: { title: tr('Request changes', 'Omba marekebisho'), required: true, ok: tr('Request changes', 'Omba marekebisho'), done: tr('Changes requested.', 'Marekebisho yameombwa.'), label: tr('What needs to change?', 'Nini kibadilishwe?') },
    rejected: { title: tr('Reject this asset?', 'Kataa mali hii?'), required: true, ok: tr('Reject', 'Kataa'), done: tr('Rejected.', 'Imekataliwa.'), label: tr('Reason for rejecting', 'Sababu ya kukataa'), danger: true },
  }[decision];
  const note = await promptDialog({ title: map.title, label: map.label, required: map.required, confirmText: map.ok, danger: map.danger });
  if (note === null) return false;
  const done = await updateAsset(a.id, { status: decision, status_note: note || null }, map.done);
  if (done) changed();
  return done;
}

export async function publishAsset(a) {
  const needsPublic = a.confidentiality !== 'public';
  if (needsPublic && !canManageAsset(a)) {
    toast(tr('Only the owner or an administrator can mark this file as Public. Ask them to change its visibility first.', 'Ni mmiliki au msimamizi tu anayeweza kuweka faili hili kuwa la Umma. Waombe wabadilishe uonekanaji kwanza.'), 'error', 7000);
    return false;
  }
  const ok = await confirmDialog({
    title: tr('Publish to the public library?', 'Chapisha kwenye maktaba ya umma?'),
    message: needsPublic
      ? tr('Anyone on the internet will be able to see and download this file. Its visibility will change from ' + t('conf.' + a.confidentiality) + ' to Public. Approval for internal use is not approval for public release, so check that the file is safe to share.',
          'Yeyote mtandaoni ataweza kuliona na kulipakua faili hili. Uonekanaji wake utabadilika kutoka ' + t('conf.' + a.confidentiality) + ' kuwa wa Umma. Idhini ya matumizi ya ndani si idhini ya kutolewa kwa umma, kwa hiyo hakikisha faili ni salama kushirikiwa.')
      : tr('Anyone on the internet will be able to see and download this file. Make sure it is safe to share.', 'Yeyote mtandaoni ataweza kuliona na kulipakua faili hili. Hakikisha ni salama kushirikiwa.'),
    confirmText: tr('Publish', 'Chapisha'),
  });
  if (!ok) return false;
  const done = await updateAsset(a.id, { status: 'published', status_note: null, ...(needsPublic ? { confidentiality: 'public' } : {}) }, tr('Published.', 'Imechapishwa.'));
  if (done) {
    // Photos and videos get a fast CDN copy; failure is harmless (Supabase keeps serving them).
    const cdn = await mirrorToCdn(a.id);
    if (!cdn.ok && !cdn.skipped) toast(tr('Published, but the fast-delivery copy could not be made. The file still works from the library.', 'Imechapishwa, lakini nakala ya kasi haikutengenezwa. Faili bado linafanya kazi kwenye maktaba.'), 'info', 6000);
    changed();
  }
  return done;
}

export async function unpublishAsset(a) {
  const ok = await confirmDialog({
    title: tr('Remove from the public library?', 'Ondoa kwenye maktaba ya umma?'),
    message: tr('The file stays in TerraVault as Approved but visitors can no longer see it.', 'Faili hubaki TerraVault kama Imeidhinishwa lakini wageni hawawezi kuliona tena.'),
    confirmText: tr('Unpublish', 'Ondoa'),
  });
  if (!ok) return false;
  const done = await updateAsset(a.id, { status: 'approved', status_note: 'Unpublished' }, tr('Unpublished.', 'Imeondolewa.'));
  if (done) {
    const cdnId = await cdnIdOf(a.id);
    if (cdnId) toast(tr(`Also delete "${cdnId}" in the Cloudinary Media Library, otherwise its link keeps working.`, `Futa pia "${cdnId}" kwenye Cloudinary Media Library, vinginevyo kiungo chake kitaendelea kufanya kazi.`), 'info', 12000);
    changed();
  }
  return done;
}

export async function archiveAsset(a) {
  const ok = await confirmDialog({
    title: tr('Archive this asset?', 'Weka mali hii kumbukumbuni?'),
    message: tr('Archived files are kept but hidden from everyday lists. You can restore them later.', 'Mafaili ya kumbukumbu huhifadhiwa lakini hayaonekani kwenye orodha za kawaida. Unaweza kuyarejesha baadaye.'),
    confirmText: tr('Archive', 'Weka kumbukumbuni'),
  });
  if (!ok) return false;
  const done = await updateAsset(a.id, { status: 'archived', status_note: null }, tr('Archived.', 'Imewekwa kumbukumbuni.'));
  if (done) changed();
  return done;
}

export async function unarchiveAsset(a) {
  const done = await updateAsset(a.id, { status: 'draft', status_note: 'Restored from archive' }, tr('Restored as a draft.', 'Imerejeshwa kama rasimu.'));
  if (done) changed();
  return done;
}

export async function trashAssets(list) {
  const many = list.length > 1;
  const ok = await confirmDialog({
    title: many ? tr(`Move ${list.length} assets to trash?`, `Hamisha mali ${list.length} kwenye taka?`) : tr('Move to trash?', 'Hamisha kwenye taka?'),
    message: tr('Trashed files can be restored. A published file is also removed from the public library.', 'Mafaili yaliyo kwenye taka yanaweza kurejeshwa. Faili lililochapishwa pia huondolewa kwenye maktaba ya umma.'),
    confirmText: tr('Move to trash', 'Hamisha kwenye taka'), danger: true,
  });
  if (!ok) return false;
  let failed = 0;
  for (const a of list) {
    const { data, error } = await sb.from('assets').update({ deleted_at: new Date().toISOString() }).eq('id', a.id).select('id');
    if (error || !data?.length) { failed++; if (error && list.length === 1) toast(friendlyError(error), 'error', 6000); }
  }
  if (failed < list.length) toast(tr('Moved to trash.', 'Imehamishiwa kwenye taka.'), 'success');
  if (failed && list.length > 1) toast(tr(`${failed} could not be moved.`, `${failed} hazikuweza kuhamishwa.`), 'error');
  changed();
  return failed < list.length;
}

export async function restoreAsset(a) {
  const done = await updateAsset(a.id, { deleted_at: null }, tr('Restored.', 'Imerejeshwa.'));
  if (done) changed();
  return done;
}

export async function deleteForever(a) {
  const ok = await confirmDialog({
    title: tr('Delete permanently?', 'Futa kabisa?'),
    message: tr(`“${a.title}” and all of its versions will be erased and cannot be recovered.`, `“${a.title}” na matoleo yake yote yatafutwa na hayawezi kurejeshwa.`),
    confirmText: tr('Delete permanently', 'Futa kabisa'), danger: true,
  });
  if (!ok) return false;
  const { data: files } = await sb.storage.from(BUCKET).list(a.id, { limit: 1000 });
  const paths = (files || []).map((f) => `${a.id}/${f.name}`);
  const { data, error } = await sb.from('assets').delete().eq('id', a.id).select('id');
  if (error || !data?.length) { toast(error ? friendlyError(error) : tr('You do not have permission to do that.', 'Huna ruhusa ya kufanya hivyo.'), 'error'); return false; }
  await removeObjects(paths);
  toast(tr('Deleted permanently.', 'Imefutwa kabisa.'), 'success');
  changed();
  return true;
}

// ------------------------------------------------------------------ editing
export async function openEditAsset(a) {
  const refs = await loadMetaRefs();
  const { data: tagRows } = await sb.from('asset_tags').select('tag:tags(id,name)').eq('asset_id', a.id);
  const current = (tagRows || []).map((r) => r.tag).filter(Boolean);
  const full = (await sb.from('assets').select('*').eq('id', a.id).single()).data || a;
  const m = openModal({
    title: tr('Edit details', 'Hariri maelezo'), size: 'lg',
    body: html`<form id="editForm" novalidate>${metaForm(full, refs)}</form>`,
    footer: html`<button class="btn btn-ghost" data-close>${t('common.cancel')}</button><button class="btn btn-primary" id="save">${t('common.save')}</button>`,
  });
  const form = m.el.querySelector('#editForm');
  const ctl = bindMetaForm(form, refs, current.map((x) => x.name));
  m.el.querySelector('#save').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    if (!form.reportValidity()) return;
    const payload = readMeta(form, refs);
    if (!payload.title) { toast(tr('A title is required.', 'Kichwa kinahitajika.'), 'error'); return; }
    const { data, error } = await sb.from('assets').update(payload).eq('id', a.id).select('id');
    if (error || !data?.length) { toast(error ? friendlyError(error) : tr('You do not have permission to do that.', 'Huna ruhusa ya kufanya hivyo.'), 'error', 6000); return; }
    try {
      const want = await resolveTagIds(ctl.get());
      const have = current.map((x) => x.id);
      const add = want.filter((x) => !have.includes(x));
      const drop = have.filter((x) => !want.includes(x));
      if (add.length) await sb.from('asset_tags').insert(add.map((tag_id) => ({ asset_id: a.id, tag_id })));
      if (drop.length) await sb.from('asset_tags').delete().eq('asset_id', a.id).in('tag_id', drop);
    } catch (err) { toast(friendlyError(err), 'error'); }
    invalidateRef('tags');
    m.close(); toast(tr('Details saved.', 'Maelezo yamehifadhiwa.'), 'success'); changed();
  }));
}

export function openReplaceFile(a) {
  let file = null;
  const m = openModal({
    title: tr('Upload a new version', 'Pakia toleo jipya'), size: 'md',
    body: html`
      <p class="muted-text">${tr('The current file is kept in the version history. If this asset is approved or published, it goes back to review so the new file is checked.', 'Faili la sasa linahifadhiwa kwenye historia ya matoleo. Mali hii ikiwa imeidhinishwa au kuchapishwa, inarudi kwenye ukaguzi ili faili jipya likaguliwe.')}</p>
      <div class="dropzone small" id="dz" tabindex="0" role="button"><b id="dzText">${tr('Choose the new file', 'Chagua faili jipya')}</b><input type="file" id="pick" hidden></div>
      <label class="field"><span class="label">${tr('What changed?', 'Nini kimebadilika?')}</span><input class="input" id="note" maxlength="300"></label>
      <p class="field-error" id="err" hidden></p>`,
    footer: html`<button class="btn btn-ghost" data-close>${t('common.cancel')}</button><button class="btn btn-primary" id="go" disabled>${tr('Upload version', 'Pakia toleo')}</button>`,
  });
  const q = (s) => m.el.querySelector(s);
  const err = (msg) => { q('#err').textContent = msg || ''; q('#err').hidden = !msg; };
  q('#dz').addEventListener('click', () => q('#pick').click());
  q('#pick').addEventListener('change', (e) => {
    file = e.target.files[0] || null;
    const bad = file ? validateFile(file) : null;
    err(bad); q('#go').disabled = !file || !!bad;
    q('#dzText').textContent = file ? `${file.name} · ${fmtBytes(file.size)}` : tr('Choose the new file', 'Chagua faili jipya');
  });
  q('#go').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    try {
      err('');
      const mime = mimeOfFile(file);
      const checksum = await sha256(file);
      const v = (a.version || 1) + 1;
      const safe = file.name.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-100);
      const path = `${a.id}/v${v}-${safe}`;
      await uploadWithProgress(path, file, mime, (p) => { q('#go').textContent = `${Math.round(p * 100)}%`; });
      const thumb = await uploadThumbnail(a.id, await makeThumbnail(file, mime));
      const { error } = await sb.rpc('replace_asset_file', {
        p_asset: a.id, p_path: path, p_filename: file.name, p_mime: mime, p_size: file.size,
        p_checksum: checksum, p_thumb: thumb, p_note: q('#note').value.trim() || null,
      });
      if (error) { await removeObjects([path, thumb]); throw error; }
      m.close(); toast(tr('New version uploaded.', 'Toleo jipya limepakiwa.'), 'success'); changed();
    } catch (ex) { err(friendlyError(ex)); }
  }));
}

// ------------------------------------------------------------------ collections
export async function openAddToCollection(assetIds) {
  const me = state.user.id;
  const { data } = await sb.from('collections').select('id,name,owner_id').order('name');
  const mine = (data || []).filter((c) => c.owner_id === me || isAdmin());
  const m = openModal({
    title: tr('Add to collection', 'Ongeza kwenye mkusanyiko'), size: 'sm',
    body: html`
      ${mine.length ? html`<label class="field"><span class="label">${tr('Choose a collection', 'Chagua mkusanyiko')}</span>
        <select class="input" id="col">${options(mine, mine[0]?.id)}</select></label>
        <p class="or">${tr('or create a new one', 'au unda mpya')}</p>` : ''}
      <label class="field"><span class="label">${tr('New collection name', 'Jina la mkusanyiko mpya')}</span><input class="input" id="newName" maxlength="200"></label>`,
    footer: html`<button class="btn btn-ghost" data-close>${t('common.cancel')}</button><button class="btn btn-primary" id="go">${t('common.add')}</button>`,
  });
  m.el.querySelector('#go').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    let id = m.el.querySelector('#col')?.value;
    const name = m.el.querySelector('#newName').value.trim();
    if (name) {
      const { data: c, error } = await sb.from('collections').insert({ name, owner_id: me }).select('id').single();
      if (error) { toast(friendlyError(error), 'error'); return; }
      id = c.id;
    }
    if (!id) { toast(tr('Choose or name a collection.', 'Chagua au taja mkusanyiko.'), 'error'); return; }
    const { error } = await sb.from('collection_assets').upsert(assetIds.map((asset_id) => ({ collection_id: id, asset_id })), { onConflict: 'collection_id,asset_id', ignoreDuplicates: true });
    if (error) { toast(friendlyError(error), 'error'); return; }
    m.close(); toast(tr('Added to collection.', 'Imeongezwa kwenye mkusanyiko.'), 'success');
  }));
}

// ------------------------------------------------------------------ sharing
export const shareUrl = (token) => `${location.origin}${location.pathname}#/s/${token}`;
const inDays = (n) => (n ? new Date(Date.now() + n * 86400000).toISOString() : null);

function shareState(s) {
  if (s.revoked_at) return ['revoked', tr('Revoked', 'Imefutwa')];
  if (s.expires_at && new Date(s.expires_at) < new Date()) return ['expired', tr('Expired', 'Imeisha')];
  return ['active', tr('Active', 'Hai')];
}

export function shareListHtml(shares) {
  if (!shares.length) return html`<p class="muted-text">${tr('Nothing has been shared yet.', 'Hakuna kilichoshirikiwa bado.')}</p>`;
  return html`<ul class="share-list">${shares.map((s) => {
    const [st, label] = shareState(s);
    return html`<li data-share="${s.id}" class="st-${st}">
      <span class="sl-ic">${raw(icon(s.shared_with_email ? 'user' : 'link', 18))}</span>
      <span class="sl-main"><b>${s.shared_with_email || tr('Anyone with the link', 'Yeyote mwenye kiungo')}</b>
        <small>${label} · ${s.expires_at ? tr('until ', 'hadi ') + fmtDate(s.expires_at) : tr('no expiry', 'haina mwisho')} · ${s.access_count || 0} ${tr('opens', 'mara kufunguliwa')}${s.allow_download ? '' : ' · ' + tr('view only', 'kutazama tu')}</small></span>
      ${st === 'active' ? html`<button class="icon-btn" data-copy="${s.token}" title="${t('common.copy')}" aria-label="${tr('Copy link', 'Nakili kiungo')}">${raw(icon('copy', 17))}</button>
        <button class="btn btn-ghost btn-sm" data-revoke="${s.id}">${tr('Revoke', 'Futa')}</button>` : ''}
    </li>`;
  })}</ul>`;
}

export function bindShareList(root, reload) {
  root.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { await copyText(shareUrl(c.dataset.copy)); toast(tr('Link copied.', 'Kiungo kimenakiliwa.'), 'success'); return; }
    const r = e.target.closest('[data-revoke]');
    if (r) {
      const ok = await confirmDialog({ title: tr('Revoke this share?', 'Futa ushiriki huu?'), message: tr('The link or invitation stops working straight away.', 'Kiungo au mwaliko huacha kufanya kazi mara moja.'), confirmText: tr('Revoke', 'Futa'), danger: true });
      if (!ok) return;
      const { error } = await sb.from('shares').update({ revoked_at: new Date().toISOString() }).eq('id', r.dataset.revoke);
      if (error) toast(friendlyError(error), 'error'); else { toast(tr('Share revoked.', 'Ushiriki umefutwa.'), 'success'); reload(); }
    }
  });
}

export async function openShareModal({ asset = null, collection = null }) {
  const target = asset ? { asset_id: asset.id } : { collection_id: collection.id };
  const title = asset ? asset.title : collection.name;
  const conf = asset?.confidentiality || 'internal';
  const linkAllowed = !['restricted', 'confidential'].includes(conf);
  if (conf === 'confidential' && !isAdmin()) {
    toast(tr('Confidential files cannot be shared.', 'Mafaili ya siri hayawezi kushirikiwa.'), 'error'); return;
  }
  let mode = 'person';
  const m = openModal({
    title: tr('Share', 'Shiriki') + ' · ' + title, size: 'md',
    body: html`
      <div class="seg" role="tablist">
        <button type="button" class="on" data-mode="person" role="tab">${raw(icon('user', 16))}${tr('A named person', 'Mtu aliyetajwa')}</button>
        <button type="button" data-mode="link" role="tab" ${linkAllowed ? '' : raw('disabled title="' + esc(tr('Restricted files can only be shared with a named person', 'Mafaili yenye vikwazo hushirikiwa na mtu aliyetajwa tu')) + '"')}>${raw(icon('link', 16))}${tr('A link', 'Kiungo')}</button>
      </div>
      <p class="muted-text" id="modeHelp"></p>
      <form id="shareForm" novalidate>
        <label class="field" data-only="person"><span class="label">${tr('Their email address', 'Barua pepe yao')}</span>
          <input class="input" type="email" name="email" autocomplete="off" placeholder="name@organization.org"></label>
        <div class="form-grid">
          <label class="field"><span class="label">${tr('Access ends', 'Ufikiaji unaisha')}</span>
            <select class="input" name="days"></select></label>
          <label class="check"><input type="checkbox" name="allow_download" checked><span>${tr('Allow downloading', 'Ruhusu kupakua')}</span></label>
          <label class="check" data-only="link"><input type="checkbox" name="require_auth"><span>${tr('Require sign in', 'Hitaji kuingia')}</span></label>
        </div>
        <label class="field"><span class="label">${tr('Message (optional)', 'Ujumbe (si lazima)')}</span><input class="input" name="note" maxlength="300"></label>
        <p class="field-error" id="shErr" hidden></p>
        <div class="row end"><button class="btn btn-primary" type="submit">${tr('Create share', 'Unda ushiriki')}</button></div>
      </form>
      <div id="created" hidden></div>
      <h3 class="mini-h">${tr('Active and past shares', 'Zilizoshirikiwa sasa na zamani')}</h3>
      <div id="shareList"><div class="spinner"></div></div>`,
  });
  const q = (s) => m.el.querySelector(s);
  const form = q('#shareForm');

  const setMode = (next) => {
    mode = next;
    m.el.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    m.el.querySelectorAll('[data-only]').forEach((x) => { x.hidden = x.dataset.only !== mode; });
    q('#modeHelp').textContent = mode === 'person'
      ? tr('They must sign in with this email address. This is the safest way to share.', 'Lazima waingie kwa barua pepe hii. Hii ndiyo njia salama zaidi ya kushiriki.')
      : tr('Anyone who has the link can open it until it expires. Use it for non-sensitive material.', 'Yeyote mwenye kiungo anaweza kukifungua hadi kiishe. Itumie kwa vifaa visivyo nyeti.');
    const days = form.days;
    const opts = mode === 'person' ? [[30, tr('30 days', 'Siku 30')], [7, tr('7 days', 'Siku 7')], [90, tr('90 days', 'Siku 90')], [0, tr('No end date', 'Bila mwisho')]]
      : [[7, tr('7 days', 'Siku 7')], [1, tr('1 day', 'Siku 1')], [30, tr('30 days', 'Siku 30')], [90, tr('90 days', 'Siku 90')]];
    days.innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  };
  m.el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => !b.disabled && setMode(b.dataset.mode)));
  setMode('person');

  async function loadList() {
    const { data } = await sb.from('shares').select('*').match(target).order('created_at', { ascending: false });
    const host = q('#shareList');
    host.innerHTML = shareListHtml(data || []).s;
  }
  bindShareList(q('#shareList'), loadList);
  loadList();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = q('#shErr'); err.hidden = true;
    const f = new FormData(form);
    const email = (f.get('email') || '').toString().trim().toLowerCase();
    if (mode === 'person' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = tr('Enter a valid email address.', 'Weka barua pepe halali.'); err.hidden = false; return; }
    const btn = form.querySelector('button[type=submit]');
    await withBusy(btn, async () => {
      const row = {
        ...target, created_by: state.user.id,
        shared_with_email: mode === 'person' ? email : null,
        expires_at: inDays(+f.get('days')),
        allow_download: form.allow_download.checked,
        require_auth: mode === 'person' ? true : !!form.require_auth?.checked,
        note: (f.get('note') || '').toString().trim() || null,
      };
      const { data, error } = await sb.from('shares').insert(row).select('*').single();
      if (error) { err.textContent = friendlyError(error); err.hidden = false; return; }
      const url = shareUrl(data.token);
      const box = q('#created');
      box.hidden = false;
      box.innerHTML = html`<div class="created-link"><b>${tr('Share created', 'Ushiriki umeundwa')}</b>
        <div class="copy-row"><input class="input" readonly value="${url}" aria-label="Link"><button class="btn btn-ghost" id="cp" type="button">${raw(icon('copy', 16))}${t('common.copy')}</button></div>
        ${mode === 'person' ? html`<a class="btn btn-ghost btn-sm" href="mailto:${email}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(tr('I shared this with you on TerraVault. Sign in with this email address to open it:\n', 'Nimekushirikisha hii kupitia TerraVault. Ingia kwa barua pepe hii kuifungua:\n') + url)}">${raw(icon('mail', 16))}${tr('Write an email', 'Andika barua pepe')}</a>
        <small class="hint-text">${tr('If they have no account yet, ask an administrator to invite this email address first.', 'Ikiwa hawana akaunti bado, muulize msimamizi aalike barua pepe hii kwanza.')}</small>` : ''}</div>`.s;
      box.querySelector('#cp').onclick = async () => { await copyText(url); toast(tr('Link copied.', 'Kiungo kimenakiliwa.'), 'success'); };
      form.reset(); setMode(mode); loadList();
    });
  });
}
