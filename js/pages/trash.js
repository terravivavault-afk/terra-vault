// Trash and Archive: restore, or delete forever.
import { sb } from '../lib/supabase.js';
import { state, can, isAdmin, canManageAsset } from '../lib/state.js';
import { html, raw, mount, fmtBytes, fmtDate, fmtNum, replaceHash } from '../lib/util.js';
import { t, tr } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { emptyState, assetThumb, pagination, skeletonGrid } from '../lib/ui.js';
import { ASSET_LIST_SELECT, hydrateThumbs, friendlyError } from '../lib/api.js';
import { restoreAsset, unarchiveAsset, deleteForever } from '../lib/actions.js';
import { PAGE_SIZE } from '../config.js';

export default async function trash(ctx) {
  const f = { tab: ctx.query.tab === 'archive' ? 'archive' : 'trash', page: 1 };
  let token = 0;
  let rows = [];
  const me = state.user.id;

  mount(ctx.view, html`
    <div class="page-head"><div><h1>${t('nav.trash')}</h1>
      <p>${tr('Trashed files can be restored. Archived files are kept but hidden from everyday lists.', 'Mafaili yaliyo kwenye taka yanaweza kurejeshwa. Mafaili ya kumbukumbu huhifadhiwa lakini hayaonekani kwenye orodha za kawaida.')}</p></div></div>
    <div class="toolbar"><div class="tabs" role="tablist">
      <button class="tab" role="tab" data-tab="trash">${raw(icon('trash', 16))}${tr('Trash', 'Taka')}</button>
      <button class="tab" role="tab" data-tab="archive">${raw(icon('archive', 16))}${tr('Archive', 'Kumbukumbu')}</button>
    </div></div>
    <p class="hint-text" id="note"></p>
    <p class="result-count" id="count" aria-live="polite"></p>
    <div id="results"></div><div id="pager"></div>`);
  const $q = (s) => ctx.view.querySelector(s);
  const results = $q('#results');

  const canRestoreTrash = (a) => can('restore') && (isAdmin() || a.uploaded_by === me);
  const canUnarchive = (a) => can('restore') && canManageAsset(a);
  const canPurge = () => isAdmin() && can('delete');

  async function load() {
    const my = ++token;
    ctx.view.querySelectorAll('[data-tab]').forEach((b) => { const on = b.dataset.tab === f.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    $q('#note').textContent = f.tab === 'trash'
      ? tr('Nothing is deleted automatically: files stay in the trash until restored or deleted permanently by an administrator. You see items you deleted; administrators see all.', 'Hakuna kinachofutwa kiotomatiki: mafaili hubaki kwenye taka hadi yarejeshwe au yafutwe kabisa na msimamizi. Unaona ulivyofuta wewe; wasimamizi huona vyote.')
      : tr('Archived assets keep their details and history. Restoring one returns it to Draft.', 'Mali za kumbukumbu hubaki na maelezo na historia yake. Kuirejesha huirudisha kuwa Rasimu.');
    mount(results, skeletonGrid(4));
    replaceHash(ctx.path, { tab: f.tab === 'archive' ? 'archive' : '' });
    let q = sb.from('assets').select(ASSET_LIST_SELECT + ',deleter:profiles!deleted_by(full_name)', { count: 'exact' });
    q = f.tab === 'trash' ? q.not('deleted_at', 'is', null).order('deleted_at', { ascending: false })
      : q.is('deleted_at', null).eq('status', 'archived').order('updated_at', { ascending: false });
    const from = (f.page - 1) * PAGE_SIZE;
    const { data, count, error } = await q.range(from, from + PAGE_SIZE - 1);
    if (my !== token) return;
    if (error) { mount(results, emptyState({ icon: 'alert', title: tr('Could not load this list', 'Imeshindwa kupakia orodha hii'), text: friendlyError(error) })); return; }
    rows = data || [];
    $q('#count').textContent = count ? `${fmtNum(count)} ${tr('assets', 'mali')}` : '';
    if (!rows.length) {
      mount(results, emptyState({ icon: f.tab === 'trash' ? 'trash' : 'archive',
        title: f.tab === 'trash' ? tr('The trash is empty', 'Taka ni tupu') : tr('No archived assets', 'Hakuna mali za kumbukumbu'),
        text: f.tab === 'trash' ? tr('Files you delete will wait here until you restore them.', 'Mafaili unayofuta yatasubiri hapa hadi uyarejeshe.') : tr('Assets you archive will be kept here.', 'Mali unazoweka kumbukumbuni zitahifadhiwa hapa.') }));
      mount($q('#pager'), html``);
      return;
    }
    const trashTab = f.tab === 'trash';
    mount(results, html`<div class="table-wrap"><table class="table asset-table">
      <thead><tr><th>${tr('Asset', 'Mali')}</th><th>${tr('Project', 'Mradi')}</th><th>${tr('Size', 'Ukubwa')}</th>
        <th>${trashTab ? tr('Deleted', 'Imefutwa') : tr('Archived', 'Imewekwa kumbukumbuni')}</th><th></th></tr></thead>
      <tbody>${rows.map((a) => html`<tr class="asset-row" data-id="${a.id}">
        <td><a class="row-title" href="#/app/assets/${a.id}">${assetThumb(a, { overlay: false })}<span><b>${a.title}</b><small>${a.filename || ''}</small></span></a></td>
        <td>${a.project?.name || '—'}</td><td>${fmtBytes(a.file_size)}</td>
        <td>${fmtDate(trashTab ? a.deleted_at : a.updated_at)}${trashTab && a.deleter?.full_name ? html`<small class="cell-sub">${a.deleter.full_name}</small>` : ''}</td>
        <td class="row-actions">
          ${trashTab ? (canRestoreTrash(a) ? html`<button class="btn btn-ghost btn-sm" data-act="restore">${raw(icon('rotate', 15))}${t('common.restore')}</button>` : '')
            : (canUnarchive(a) ? html`<button class="btn btn-ghost btn-sm" data-act="unarchive">${raw(icon('rotate', 15))}${t('common.restore')}</button>` : '')}
          ${trashTab && canPurge() ? html`<button class="btn btn-ghost btn-sm danger-text" data-act="purge">${raw(icon('trash', 15))}${tr('Delete forever', 'Futa kabisa')}</button>` : ''}
        </td></tr>`)}</tbody></table></div>`);
    hydrateThumbs(results);
    mount($q('#pager'), pagination({ page: f.page, total: count || 0, pageSize: PAGE_SIZE }));
  }

  ctx.view.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { f.tab = b.dataset.tab; f.page = 1; load(); }));
  $q('#pager').addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (b) { f.page = +b.dataset.page; load(); } });
  results.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = rows.find((x) => x.id === b.closest('[data-id]').dataset.id);
    if (!a) return;
    // Each action fires tv:changed on success, which re-renders this page.
    if (b.dataset.act === 'restore') await restoreAsset(a);
    else if (b.dataset.act === 'unarchive') await unarchiveAsset(a);
    else if (b.dataset.act === 'purge') await deleteForever(a);
  });
  await load();
}
