// Collection detail: asset grid backed by the collection_assets join table.
import { sb } from '../lib/supabase.js';
import { state, can, isAdmin } from '../lib/state.js';
import { html, raw, mount, fmtDate, go } from '../lib/util.js';
import { t, tr } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { assetCard, emptyState, pagination, toast, confirmDialog } from '../lib/ui.js';
import { ASSET_LIST_SELECT, hydrateThumbs, friendlyError } from '../lib/api.js';
import { openShareModal } from '../lib/actions.js';
import { PAGE_SIZE } from '../config.js';
import { openCollectionForm, visibilityLabel } from './collections.js';

export default async function collection(ctx) {
  const id = ctx.id;
  const [{ data: c, error }, { data: links, error: lerr }] = await Promise.all([
    sb.from('collections').select('id,name,description,visibility,owner_id,cover_asset_id,created_at,updated_at,owner:profiles!owner_id(full_name)').eq('id', id).maybeSingle(),
    sb.from('collection_assets').select(`asset_id,added_at,asset:assets(${ASSET_LIST_SELECT})`).eq('collection_id', id).order('added_at', { ascending: false }),
  ]);
  if (!ctx.isCurrent()) return;
  if (error || !c) {
    mount(ctx.view, emptyState({
      icon: error ? 'alert' : 'search',
      title: error ? tr('Could not load this collection', 'Imeshindwa kupakia mkusanyiko huu') : tr('Collection not found', 'Mkusanyiko haujapatikana'),
      text: error ? friendlyError(error) : tr('It may have been deleted, or it is not shared with you.', 'Huenda umefutwa, au haujashirikiwa nawe.'),
      action: html`<a class="btn btn-primary" href="#/app/collections">${t('nav.collections')}</a>`,
    }));
    return;
  }

  const owner = c.owner_id === state.user.id || isAdmin();
  // Assets hidden by RLS or in the trash come back as null / deleted; leave them out.
  let items = (links || []).map((l) => l.asset).filter((a) => a && !a.deleted_at);
  let page = 1;

  mount(ctx.view, html`
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/app/collections">${t('nav.collections')}</a>${raw(icon('chevron-right', 14))}<span>${c.name}</span></nav>
    <div class="page-head">
      <div><h1>${c.name}</h1>
        <p>${c.description ? html`${c.description}<br>` : ''}<small>${raw(icon(c.visibility === 'organization' ? 'users' : 'lock', 13))} ${visibilityLabel(c.visibility)}${c.owner?.full_name ? ' · ' + c.owner.full_name : ''} · ${fmtDate(c.updated_at)}</small></p></div>
      <div class="page-actions">
        ${owner && can('share') ? html`<button class="btn btn-primary" id="share">${raw(icon('share', 17))}${t('common.share')}</button>` : ''}
        ${owner ? html`<button class="btn btn-ghost" id="edit">${raw(icon('edit', 17))}${t('common.edit')}</button>
          <button class="btn btn-ghost danger-text" id="del">${raw(icon('trash', 17))}${t('common.delete')}</button>` : ''}
      </div>
    </div>
    ${lerr ? html`<p class="field-error">${friendlyError(lerr)}</p>` : ''}
    <p class="result-count" id="count" aria-live="polite"></p>
    <div id="results"></div>
    <div id="pager"></div>`);
  const $q = (s) => ctx.view.querySelector(s);
  const results = $q('#results'); const pager = $q('#pager');

  function paint() {
    $q('#count').textContent = items.length ? `${items.length} ${tr('assets', 'mali')}` : '';
    if (!items.length) {
      mount(results, emptyState({
        icon: 'layers', title: tr('This collection is empty', 'Mkusanyiko huu ni mtupu'),
        text: owner ? tr('Open any asset and choose “Collect”, or select assets in the library and use “Add to collection”.', 'Fungua mali yoyote kisha chagua “Kusanya”, au chagua mali kwenye maktaba kisha tumia “Ongeza kwenye mkusanyiko”.') : '',
        action: html`<a class="btn btn-primary" href="#/app/assets">${t('nav.assets')}</a>`,
      }));
      mount(pager, html``);
      return;
    }
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    page = Math.min(page, pages);
    const slice = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    mount(results, html`<div class="asset-grid">${slice.map((a) => html`<div class="col-item" data-id="${a.id}">${assetCard(a)}
      ${owner ? html`<div class="col-item-actions">
        <button class="icon-btn" data-cover="${a.id}" title="${tr('Use as cover', 'Tumia kama jalada')}" aria-label="${tr('Use as cover', 'Tumia kama jalada')}">${raw(icon('star', 16))}</button>
        <button class="icon-btn" data-remove="${a.id}" title="${tr('Remove from collection', 'Ondoa kwenye mkusanyiko')}" aria-label="${tr('Remove from collection', 'Ondoa kwenye mkusanyiko')}">${raw(icon('x', 16))}</button></div>` : ''}</div>`)}</div>`);
    hydrateThumbs(results);
    mount(pager, pagination({ page, total: items.length, pageSize: PAGE_SIZE }));
  }

  pager.addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (b) { page = +b.dataset.page; paint(); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
  results.addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-remove]');
    const cv = e.target.closest('[data-cover]');
    if (rm) {
      e.preventDefault();
      const a = items.find((x) => x.id === rm.dataset.remove);
      const ok = await confirmDialog({
        title: tr('Remove from this collection?', 'Ondoa kwenye mkusanyiko huu?'),
        message: tr(`“${a?.title || ''}” stays in the library. Only its place in this collection is removed.`, `“${a?.title || ''}” hubaki kwenye maktaba. Nafasi yake kwenye mkusanyiko huu pekee ndiyo inaondolewa.`),
        confirmText: t('common.remove'), danger: true,
      });
      if (!ok) return;
      const { data, error: err } = await sb.from('collection_assets').delete().eq('collection_id', id).eq('asset_id', rm.dataset.remove).select('asset_id');
      if (err || !data?.length) { toast(err ? friendlyError(err) : tr('You do not have permission to do that.', 'Huna ruhusa ya kufanya hivyo.'), 'error'); return; }
      items = items.filter((x) => x.id !== rm.dataset.remove);
      toast(tr('Removed from collection.', 'Imeondolewa kwenye mkusanyiko.'), 'success');
      paint();
    }
    if (cv) {
      e.preventDefault();
      const { data, error: err } = await sb.from('collections').update({ cover_asset_id: cv.dataset.cover }).eq('id', id).select('id');
      if (err || !data?.length) { toast(err ? friendlyError(err) : tr('You do not have permission to do that.', 'Huna ruhusa ya kufanya hivyo.'), 'error'); return; }
      toast(tr('Cover updated.', 'Jalada limesasishwa.'), 'success');
    }
  });

  $q('#edit')?.addEventListener('click', async () => { if (await openCollectionForm(c)) ctx.refresh(); });
  $q('#share')?.addEventListener('click', () => openShareModal({ collection: c }));
  $q('#del')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: tr('Delete this collection?', 'Futa mkusanyiko huu?'),
      message: tr('The collection and any links shared from it are deleted. The assets themselves are not touched.', 'Mkusanyiko na viungo vilivyoshirikiwa kutoka kwake vitafutwa. Mali zenyewe hazitaguswa.'),
      confirmText: t('common.delete'), danger: true,
    });
    if (!ok) return;
    const { data, error: err } = await sb.from('collections').delete().eq('id', id).select('id');
    if (err || !data?.length) { toast(err ? friendlyError(err) : tr('You do not have permission to do that.', 'Huna ruhusa ya kufanya hivyo.'), 'error'); return; }
    toast(tr('Collection deleted.', 'Mkusanyiko umefutwa.'), 'success');
    go('/app/collections');
  });
  paint();
}
