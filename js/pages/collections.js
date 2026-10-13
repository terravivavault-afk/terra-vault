// Collections: curated sets of assets (references only, no file duplication).
import { sb } from '../lib/supabase.js';
import { state, can, isAdmin } from '../lib/state.js';
import { html, raw, mount, debounce, fmtDate, go } from '../lib/util.js';
import { t, tr } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { emptyState, openModal, toast, withBusy, assetThumb, formData, nullIfEmpty } from '../lib/ui.js';
import { hydrateThumbs, friendlyError } from '../lib/api.js';

export const visibilityLabel = (v) => (v === 'organization' ? tr('Visible to all staff', 'Inaonekana kwa wafanyakazi wote') : tr('Private', 'Faragha'));

/** Create (collection = null) or edit. Resolves with the saved collection id, or null if cancelled. */
export function openCollectionForm(collection = null) {
  const isEdit = !!collection;
  const v = collection || { visibility: 'private' };
  return new Promise((resolve) => {
    let saved = null;
    const m = openModal({
      title: isEdit ? tr('Edit collection', 'Hariri mkusanyiko') : tr('New collection', 'Mkusanyiko mpya'), size: 'md',
      body: html`<form id="cf" novalidate>
        <label class="field"><span class="label">${tr('Name', 'Jina')} <b class="req">*</b></span><input class="input" name="name" required maxlength="200" value="${v.name ?? ''}"></label>
        <label class="field"><span class="label">${tr('Description', 'Maelezo')}</span><textarea class="input" name="description" rows="3" maxlength="2000">${v.description ?? ''}</textarea></label>
        <label class="field"><span class="label">${tr('Who can see it', 'Nani anaweza kuiona')}</span>
          <select class="input" name="visibility">
            <option value="private" ${v.visibility === 'private' ? raw('selected') : ''}>${tr('Private — only me', 'Faragha — mimi tu')}</option>
            <option value="organization" ${v.visibility === 'organization' ? raw('selected') : ''}>${tr('All Terraviva staff', 'Wafanyakazi wote wa Terraviva')}</option>
          </select>
          <small class="hint-text">${tr('You can also share a collection with a named person or a link from its page.', 'Unaweza pia kumshirikisha mtu aliyetajwa au kutumia kiungo kupitia ukurasa wa mkusanyiko.')}</small></label>
        <p class="field-error" id="cfErr" hidden></p>
      </form>`,
      footer: html`<button class="btn btn-ghost" data-close>${t('common.cancel')}</button><button class="btn btn-primary" id="cfSave">${isEdit ? t('common.save') : t('common.create')}</button>`,
      onClose: () => resolve(saved),
    });
    const form = m.el.querySelector('#cf');
    form.addEventListener('submit', (e) => { e.preventDefault(); m.el.querySelector('#cfSave').click(); });
    m.el.querySelector('#cfSave').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      const err = m.el.querySelector('#cfErr'); err.hidden = true;
      const f = formData(form);
      if (!f.name) { err.textContent = tr('A name is required.', 'Jina linahitajika.'); err.hidden = false; return; }
      const payload = { name: f.name, description: nullIfEmpty(f.description), visibility: f.visibility };
      let res;
      if (isEdit) res = await sb.from('collections').update(payload).eq('id', collection.id).select('id');
      else res = await sb.from('collections').insert({ ...payload, owner_id: state.user.id }).select('id');
      if (res.error || !res.data?.length) { err.textContent = res.error ? friendlyError(res.error) : tr('You do not have permission to do that.', 'Huna ruhusa ya kufanya hivyo.'); err.hidden = false; return; }
      saved = res.data[0].id;
      toast(isEdit ? tr('Collection saved.', 'Mkusanyiko umehifadhiwa.') : tr('Collection created.', 'Mkusanyiko umeundwa.'), 'success');
      m.close();
    }));
  });
}

export default async function collections(ctx) {
  const canCreate = can('edit_metadata');
  const me = state.user.id;
  const f = { scope: ctx.query.scope === 'org' ? 'org' : 'mine', q: '' };

  mount(ctx.view, html`
    <div class="page-head">
      <div><h1>${t('nav.collections')}</h1><p>${tr('Group assets without copying files. A file can sit in many collections.', 'Kusanya mali bila kunakili mafaili. Faili moja linaweza kuwa kwenye mikusanyiko mingi.')}</p></div>
      <div class="page-actions">${canCreate ? html`<button class="btn btn-primary" id="new">${raw(icon('plus', 18))}${tr('New collection', 'Mkusanyiko mpya')}</button>` : ''}</div>
    </div>
    <div class="toolbar">
      <label class="search-field">${raw(icon('search', 18))}<input type="search" id="q" placeholder="${tr('Search collections…', 'Tafuta mikusanyiko…')}" aria-label="${t('common.search')}"></label>
      <div class="tabs" role="tablist">
        <button class="tab" role="tab" data-scope="mine">${tr('My collections', 'Mikusanyiko yangu')}</button>
        <button class="tab" role="tab" data-scope="org">${tr('Shared with me', 'Niliyoshirikiwa')}</button>
      </div>
    </div>
    <div id="list"><div class="spinner" role="status" aria-label="Loading"></div></div>`);
  const $q = (s) => ctx.view.querySelector(s);
  $q('#new')?.addEventListener('click', async () => { const id = await openCollectionForm(); if (id) go(`/app/collections/${id}`); });

  const { data, error } = await sb.from('collections')
    .select('id,name,description,visibility,owner_id,created_at,updated_at,owner:profiles!owner_id(full_name),cover:assets!cover_asset_id(id,category,thumbnail_path),collection_assets(count)')
    .order('updated_at', { ascending: false });
  if (!ctx.isCurrent()) return;
  if (error) { mount($q('#list'), emptyState({ icon: 'alert', title: tr('Could not load collections', 'Imeshindwa kupakia mikusanyiko'), text: friendlyError(error) })); return; }
  const all = data || [];
  const isMine = (c) => c.owner_id === me;

  const paint = () => {
    ctx.view.querySelectorAll('[data-scope]').forEach((b) => { const on = b.dataset.scope === f.scope; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = all.filter((c) => (f.scope === 'mine' ? isMine(c) : !isMine(c)) && words.every((w) => `${c.name} ${c.description || ''}`.toLowerCase().includes(w)));
    if (!rows.length) {
      const mine = f.scope === 'mine';
      mount($q('#list'), emptyState({
        icon: 'layers',
        title: f.q ? tr('No collections match', 'Hakuna mikusanyiko inayolingana') : mine ? tr('No collections yet', 'Hakuna mikusanyiko bado') : tr('Nothing shared with you yet', 'Hakuna kilichoshirikiwa nawe bado'),
        text: f.q ? '' : mine ? tr('Create a collection, or add assets to one from any asset page.', 'Unda mkusanyiko, au ongeza mali kwenye mkusanyiko kutoka ukurasa wowote wa mali.')
          : tr('Collections from colleagues, and ones shared with you by invitation, appear here.', 'Mikusanyiko ya wenzako, na ile uliyoshirikiwa kwa mwaliko, huonekana hapa.'),
        action: mine && canCreate && !f.q ? html`<button class="btn btn-primary" id="emptyNew">${raw(icon('plus', 18))}${tr('New collection', 'Mkusanyiko mpya')}</button>` : '',
      }));
      $q('#emptyNew')?.addEventListener('click', async () => { const id = await openCollectionForm(); if (id) go(`/app/collections/${id}`); });
      return;
    }
    mount($q('#list'), html`<div class="collection-grid">${rows.map((c) => {
      const n = c.collection_assets?.[0]?.count || 0;
      return html`<a class="collection-card" href="#/app/collections/${c.id}">
        <span class="cc-cover">${assetThumb(c.cover || { category: 'other' }, { overlay: false })}</span>
        <span class="cc-body"><h3>${c.name}</h3>
          ${c.description ? html`<p class="cc-desc">${c.description}</p>` : ''}
          <small class="cc-meta">${n} ${n === 1 ? tr('asset', 'mali') : tr('assets', 'mali')} · ${raw(icon(c.visibility === 'organization' ? 'users' : 'lock', 12))} ${visibilityLabel(c.visibility)}${!isMine(c) && c.owner?.full_name ? ' · ' + c.owner.full_name : ''} · ${fmtDate(c.updated_at)}</small></span>
      </a>`;
    })}</div>`);
    hydrateThumbs($q('#list'));
  };
  ctx.view.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => { f.scope = b.dataset.scope; paint(); }));
  $q('#q').addEventListener('input', debounce(() => { f.q = $q('#q').value.trim(); paint(); }, 200));
  // Admins see every collection; keep "mine" the default but open the other tab when mine is empty.
  if (!all.some(isMine) && all.length && !ctx.query.scope) f.scope = 'org';
  paint();
}
