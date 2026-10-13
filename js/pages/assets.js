// All Assets / Photos / Videos / Documents / Audio: search, filters, grid or list, bulk actions.
import { sb } from '../lib/supabase.js';
import { state, can, isStaff } from '../lib/state.js';
import { html, raw, mount, debounce, replaceHash, fmtNum, $ } from '../lib/util.js';
import { t, tr } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { assetCard, assetRow, emptyState, skeletonGrid, pagination, options, programName } from '../lib/ui.js';
import { ASSET_LIST_SELECT, hydrateThumbs, ref } from '../lib/api.js';
import { openUploader } from '../lib/uploader.js';
import { openAddToCollection, trashAssets, submitMany } from '../lib/actions.js';
import { PAGE_SIZE } from '../config.js';

const TITLES = () => ({
  assets: t('nav.assets'), photos: t('nav.photos'), videos: t('nav.videos'), documents: t('nav.documents'), audio: t('nav.audio'),
});
const STATUSES = ['draft', 'pending_review', 'changes_requested', 'approved', 'published', 'archived', 'rejected'];
const CATS = ['photo', 'video', 'document', 'audio', 'other'];
const SORTS = () => [
  ['new', tr('Newest first', 'Mpya kwanza')], ['old', tr('Oldest first', 'Za zamani kwanza')], ['updated', tr('Recently updated', 'Zilizosasishwa hivi karibuni')],
  ['title', tr('Title A–Z', 'Jina A–Z')], ['size', tr('Largest first', 'Kubwa kwanza')],
];
const esc = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

let viewPref = 'grid';
try { viewPref = localStorage.getItem('tv_view') || 'grid'; } catch { /* ignore */ }

export default async function assets(ctx) {
  const fixedCat = ctx.opts.cat || '';
  const f = {
    q: ctx.query.q || '', cat: fixedCat || ctx.query.cat || '', status: ctx.query.status || '', project: ctx.query.project || '',
    program: ctx.query.program || '', conf: ctx.query.conf || '', tag: ctx.query.tag || '', uploader: ctx.query.uploader || '',
    from: ctx.query.from || '', to: ctx.query.to || '', sort: ctx.query.sort || 'new', page: Math.max(1, +ctx.query.page || 1),
  };
  let view = ctx.query.view || viewPref;
  const selected = new Map();
  let rows = [];
  let token = 0;

  const [tags, projects, staff] = await Promise.all([ref('tags'), ref('projects'), ref('staff')]);
  if (!ctx.isCurrent()) return;

  const activeFilters = () => ['status', 'project', 'program', 'conf', 'tag', 'uploader', 'from', 'to'].filter((k) => f[k]).length + (fixedCat ? 0 : f.cat ? 1 : 0);

  mount(ctx.view, html`
    <div class="page-head">
      <div><h1>${TITLES()[ctx.opts.nav] || t('nav.assets')}</h1><p id="sub">${tr('Search, filter and organise every file in the library.', 'Tafuta, chuja na panga kila faili kwenye maktaba.')}</p></div>
      <div class="page-actions">${can('upload') ? html`<button class="btn btn-primary" id="up">${raw(icon('upload', 18))}${t('common.upload')}</button>` : ''}</div>
    </div>

    <div class="toolbar">
      <label class="search-field">${raw(icon('search', 18))}
        <input type="search" id="q" value="${f.q}" placeholder="${tr('Search title, description, filename, keywords, place…', 'Tafuta kichwa, maelezo, jina la faili, maneno muhimu, mahali…')}" aria-label="${t('common.search')}"></label>
      <select class="input" id="sort" aria-label="${tr('Sort', 'Panga')}">${SORTS().map(([v, l]) => html`<option value="${v}" ${f.sort === v ? raw('selected') : ''}>${l}</option>`)}</select>
      <button class="btn btn-ghost" id="ftoggle" aria-expanded="false">${raw(icon('filter', 17))}${tr('Filters', 'Vichujio')}<em class="count-pill" id="fcount" hidden></em></button>
      <div class="seg" role="group" aria-label="View">
        <button type="button" data-view="grid" class="${view === 'grid' ? 'on' : ''}" aria-label="Grid">${raw(icon('grid', 17))}</button>
        <button type="button" data-view="list" class="${view === 'list' ? 'on' : ''}" aria-label="List">${raw(icon('list', 17))}</button>
      </div>
    </div>

    <form class="filter-panel" id="fp" hidden>
      ${fixedCat ? '' : html`<label class="field"><span class="label">${tr('Type', 'Aina')}</span><select class="input" name="cat">${options(CATS, f.cat, { value: (x) => x, label: (x) => t('cat.' + x), blank: t('common.all') })}</select></label>`}
      <label class="field"><span class="label">${tr('Status', 'Hali')}</span><select class="input" name="status">${options(STATUSES, f.status, { value: (x) => x, label: (x) => t('status.' + x), blank: tr('Active (not archived)', 'Zinazotumika (si kumbukumbu)') })}</select></label>
      <label class="field"><span class="label">${tr('Project', 'Mradi')}</span><select class="input" name="project">${options(projects, f.project, { blank: t('common.all') })}</select></label>
      <label class="field"><span class="label">${tr('Programme area', 'Eneo la programu')}</span><select class="input" name="program">${options(state.programs, f.program, { label: programName, blank: t('common.all') })}</select></label>
      <label class="field"><span class="label">${tr('Visibility', 'Uonekanaji')}</span><select class="input" name="conf">${options(['public', 'internal', 'restricted', 'confidential'], f.conf, { value: (x) => x, label: (x) => t('conf.' + x), blank: t('common.all') })}</select></label>
      <label class="field"><span class="label">${tr('Tag', 'Lebo')}</span><select class="input" name="tag">${options(tags, f.tag, { blank: t('common.all') })}</select></label>
      ${isStaff() ? html`<label class="field"><span class="label">${tr('Uploaded by', 'Aliyepakia')}</span><select class="input" name="uploader">${options(staff, f.uploader, { label: (x) => x.full_name || x.email, blank: t('common.all') })}</select></label>` : ''}
      <label class="field"><span class="label">${tr('Uploaded from', 'Imepakiwa kuanzia')}</span><input class="input" type="date" name="from" value="${f.from}"></label>
      <label class="field"><span class="label">${tr('Uploaded until', 'Imepakiwa hadi')}</span><input class="input" type="date" name="to" value="${f.to}"></label>
      <div class="fp-actions"><button type="button" class="btn btn-ghost btn-sm" id="clear">${t('common.clear')}</button></div>
    </form>

    <div class="bulk-bar" id="bulk" hidden></div>
    <p class="result-count" id="count" aria-live="polite"></p>
    <div id="results"></div>
    <div id="pager"></div>
    <div class="drop-overlay" id="dropov" hidden><div>${raw(icon('upload', 36))}<b>${tr('Drop files to upload', 'Weka mafaili ili kupakia')}</b></div></div>`);

  const $q = (s) => ctx.view.querySelector(s);
  const results = $q('#results'); const pager = $q('#pager'); const countEl = $q('#count'); const bulk = $q('#bulk');
  const fp = $q('#fp');

  const paintFilterCount = () => { const n = activeFilters(); const el = $q('#fcount'); el.hidden = !n; el.textContent = n; if (n) { fp.hidden = false; $q('#ftoggle').setAttribute('aria-expanded', 'true'); } };
  paintFilterCount();

  function buildQuery() {
    let q = sb.from('assets').select(ASSET_LIST_SELECT + (f.tag ? ',asset_tags!inner(tag_id)' : ''), { count: 'exact' }).is('deleted_at', null);
    if (f.status) q = q.eq('status', f.status); else q = q.neq('status', 'archived');
    if (f.cat) q = q.eq('category', f.cat);
    if (f.project) q = q.eq('project_id', f.project);
    if (f.program) q = q.eq('program_id', f.program);
    if (f.conf) q = q.eq('confidentiality', f.conf);
    if (f.tag) q = q.eq('asset_tags.tag_id', f.tag);
    if (f.uploader) q = q.eq('uploaded_by', f.uploader);
    if (f.from) q = q.gte('created_at', `${f.from}T00:00:00`);
    if (f.to) q = q.lte('created_at', `${f.to}T23:59:59`);
    f.q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8).forEach((w) => { q = q.ilike('search_text', `%${esc(w)}%`); });
    const order = { new: ['created_at', false], old: ['created_at', true], updated: ['updated_at', false], title: ['title', true], size: ['file_size', false] }[f.sort] || ['created_at', false];
    return q.order(order[0], { ascending: order[1] });
  }

  function paintBulk() {
    const n = selected.size;
    bulk.hidden = !n;
    if (!n) return;
    mount(bulk, html`<b>${n} ${tr('selected', 'zimechaguliwa')}</b>
      ${can('edit_metadata') ? html`<button class="btn btn-ghost btn-sm" data-b="col">${raw(icon('layers', 16))}${tr('Add to collection', 'Ongeza kwenye mkusanyiko')}</button>` : ''}
      ${can('edit_metadata') ? html`<button class="btn btn-ghost btn-sm" data-b="sub">${raw(icon('send', 16))}${tr('Submit for review', 'Wasilisha kwa ukaguzi')}</button>` : ''}
      ${can('delete') ? html`<button class="btn btn-ghost btn-sm danger-text" data-b="trash">${raw(icon('trash', 16))}${tr('Move to trash', 'Hamisha kwenye taka')}</button>` : ''}
      <button class="btn btn-ghost btn-sm" data-b="clear">${t('common.clear')}</button>`);
  }

  function paintRows() {
    if (!rows.length) {
      const filtered = f.q || activeFilters();
      mount(results, emptyState({
        icon: filtered ? 'search' : 'folder',
        title: filtered ? tr('No assets match', 'Hakuna mali zinazolingana') : tr('Nothing here yet', 'Hakuna kitu hapa bado'),
        text: filtered ? tr('Try removing a filter or searching for a different word.', 'Jaribu kuondoa kichujio au kutafuta neno tofauti.') : tr('Upload photographs, videos, documents or audio to start building the library.', 'Pakia picha, video, nyaraka au sauti kuanza kujenga maktaba.'),
        action: filtered ? html`<button class="btn btn-ghost" id="emptyClear">${t('common.clear')}</button>` : (can('upload') ? html`<button class="btn btn-primary" id="emptyUp">${raw(icon('upload', 18))}${t('common.upload')}</button>` : ''),
      }));
      $q('#emptyClear')?.addEventListener('click', clearAll);
      $q('#emptyUp')?.addEventListener('click', () => openUploader({ project_id: f.project || null }));
      return;
    }
    if (view === 'list') {
      mount(results, html`<div class="table-wrap"><table class="table asset-table">
        <thead><tr><th class="col-check"></th><th>${tr('Asset', 'Mali')}</th><th>${tr('Type', 'Aina')}</th><th>${tr('Project', 'Mradi')}</th><th>${tr('Status', 'Hali')}</th><th>${tr('Visibility', 'Uonekanaji')}</th><th>${tr('Size', 'Ukubwa')}</th><th>${tr('Uploaded by', 'Aliyepakia')}</th><th>${tr('Date', 'Tarehe')}</th></tr></thead>
        <tbody>${rows.map((a) => assetRow(a, { selectable: true, selected: selected.has(a.id) }))}</tbody></table></div>`);
    } else {
      mount(results, html`<div class="asset-grid">${rows.map((a) => assetCard(a, { selectable: true, selected: selected.has(a.id) }))}</div>`);
    }
    hydrateThumbs(results);
  }

  async function load() {
    const my = ++token;
    mount(results, skeletonGrid(8));
    const params = { ...f, view: view === 'grid' ? '' : view };
    if (f.sort === 'new') params.sort = '';
    if (f.page === 1) params.page = '';
    if (fixedCat) params.cat = '';
    replaceHash(ctx.path, params);
    const from = (f.page - 1) * PAGE_SIZE;
    const { data, count, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (my !== token) return;
    if (error) {
      mount(results, emptyState({ icon: 'alert', title: tr('Could not load assets', 'Imeshindwa kupakia mali'), text: error.message }));
      return;
    }
    rows = data || [];
    countEl.textContent = count ? `${fmtNum(count)} ${tr('assets', 'mali')}` : '';
    paintRows();
    mount(pager, pagination({ page: f.page, total: count || 0, pageSize: PAGE_SIZE }));
    paintBulk();
  }

  function clearAll() {
    Object.assign(f, { q: '', status: '', project: '', program: '', conf: '', tag: '', uploader: '', from: '', to: '', page: 1, cat: fixedCat });
    $q('#q').value = '';
    fp.querySelectorAll('select,input').forEach((e) => { e.value = ''; });
    paintFilterCount(); load();
  }

  // ---- events
  const onSearch = debounce(() => { f.q = $q('#q').value.trim(); f.page = 1; load(); }, 300);
  $q('#q').addEventListener('input', onSearch);
  $q('#sort').addEventListener('change', (e) => { f.sort = e.target.value; f.page = 1; load(); });
  $q('#ftoggle').addEventListener('click', () => { fp.hidden = !fp.hidden; $q('#ftoggle').setAttribute('aria-expanded', String(!fp.hidden)); });
  fp.addEventListener('change', () => {
    new FormData(fp).forEach((v, k) => { f[k] = v.toString(); });
    f.page = 1; paintFilterCount(); load();
  });
  fp.addEventListener('submit', (e) => e.preventDefault());
  $q('#clear').addEventListener('click', clearAll);
  $q('#up')?.addEventListener('click', () => openUploader({ project_id: f.project || null }));
  ctx.view.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    view = b.dataset.view; try { localStorage.setItem('tv_view', view); } catch { /* ignore */ }
    ctx.view.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('on', x === b));
    paintRows(); replaceHash(ctx.path, { ...f, sort: f.sort === 'new' ? '' : f.sort, page: f.page === 1 ? '' : f.page, cat: fixedCat ? '' : f.cat, view: view === 'grid' ? '' : view });
  }));
  pager.addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (b) { f.page = +b.dataset.page; load(); window.scrollTo({ top: 0, behavior: 'smooth' }); } });

  results.addEventListener('change', (e) => {
    const box = e.target.closest('[data-select]');
    if (!box) return;
    const a = rows.find((r) => r.id === box.dataset.select);
    if (!a) return;
    if (box.checked) selected.set(a.id, a); else selected.delete(a.id);
    box.closest('.asset-card')?.classList.toggle('is-selected', box.checked);
    paintBulk();
  });
  bulk.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-b]');
    if (!b) return;
    const list = [...selected.values()];
    if (b.dataset.b === 'clear') { selected.clear(); paintRows(); paintBulk(); }
    if (b.dataset.b === 'col') await openAddToCollection(list.map((a) => a.id));
    if (b.dataset.b === 'sub') { if (await submitMany(list)) selected.clear(); }
    if (b.dataset.b === 'trash') { if (await trashAssets(list)) selected.clear(); }
  });

  // drag files anywhere on the page to upload
  const ov = $q('#dropov');
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const onEnter = (e) => { if (can('upload') && hasFiles(e)) { depth++; ov.hidden = false; } };
  const onLeave = () => { depth = Math.max(0, depth - 1); if (!depth) ov.hidden = true; };
  const onOver = (e) => { if (hasFiles(e)) e.preventDefault(); };
  const onDrop = (e) => {
    if (!hasFiles(e) || !can('upload')) return;
    e.preventDefault(); depth = 0; ov.hidden = true;
    openUploader({ project_id: f.project || null, files: [...e.dataTransfer.files] });
  };
  window.addEventListener('dragenter', onEnter); window.addEventListener('dragleave', onLeave);
  window.addEventListener('dragover', onOver); window.addEventListener('drop', onDrop);

  await load();
  return () => {
    window.removeEventListener('dragenter', onEnter); window.removeEventListener('dragleave', onLeave);
    window.removeEventListener('dragover', onOver); window.removeEventListener('drop', onDrop);
  };
}
