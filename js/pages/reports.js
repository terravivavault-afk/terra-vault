// Reports & Analytics. Every figure is computed from the database (RLS decides what each person can see).
import { sb } from '../lib/supabase.js';
import { can } from '../lib/state.js';
import { html, raw, mount, fmtBytes, fmtNum, fmtDate, fmtDateTime, timeAgo, toCSV, downloadText } from '../lib/util.js';
import { t, tr } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { donut, hbars, columns, PALETTE } from '../lib/charts.js';
import { emptyState, pagination, options, programName, toast, withBusy } from '../lib/ui.js';
import { friendlyError, logEvent } from '../lib/api.js';
import { actionLabel, ACTION_KEYS, CAT_COLOR } from '../lib/labels.js';

const LOG_PAGE = 25;
const CATS = ['photo', 'video', 'document', 'audio', 'other'];

/** Read every page of a query (PostgREST returns at most 1000 rows per request). */
async function fetchAll(make, { size = 1000, cap = 20000 } = {}) {
  let out = [];
  for (let from = 0; from < cap; from += size) {
    const { data, error } = await make().range(from, from + size - 1);
    if (error) throw error;
    out = out.concat(data || []);
    if ((data || []).length < size) break;
  }
  return out;
}

const panel = (title, body, { cls = '', action = '' } = {}) => html`
  <section class="panel ${cls}"><header class="panel-head"><h2>${title}</h2>${action}</header>${body}</section>`;

const stat = (label, value, ic, tone = 'teal', sub = '') => html`
  <div class="stat tone-${tone}"><span class="stat-ic">${raw(icon(ic, 22))}</span>
    <span class="stat-num">${value}</span><span class="stat-lbl">${label}</span>${sub ? html`<small class="stat-sub">${sub}</small>` : ''}</div>`;

/** Horizontal bars whose value is a size in bytes (re-uses the hbars look). */
function byteBars(items) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return html`<p class="panel-empty">${tr('No files yet.', 'Hakuna mafaili bado.')}</p>`;
  return html`<ul class="hbars">${items.map((i) => html`<li>
    <span class="hb-label" title="${i.label}">${i.label}</span>
    <span class="hb-track"><span class="hb-fill" style="width:${Math.max(3, (i.value / max) * 100)}%;background:${i.color}"></span></span>
    <b>${fmtBytes(i.value)}</b></li>`)}</ul>`;
}

const topN = (map, n, colors = true) => [...map.entries()]
  .sort((a, b) => b[1].value - a[1].value).slice(0, n)
  .map(([label, v], i) => ({ label, value: v.value, color: v.color || (colors ? PALETTE[i % PALETTE.length] : undefined) }));

export default async function reports(ctx) {
  const canLogs = can('view_logs');
  const canExport = can('export_reports');
  const f = {
    action: ctx.query.action || '', user: ctx.query.user || '', from: ctx.query.from || '', to: ctx.query.to || '',
    page: Math.max(1, +ctx.query.page || 1),
  };

  mount(ctx.view, html`
    <div class="page-head">
      <div><h1>${t('nav.reports')}</h1>
        <p>${tr('Live figures from the library: what is in it, who is adding to it and what people use.', 'Takwimu hai za maktaba: kilichomo, nani anaongeza na watu wanatumia nini.')}</p></div>
      <div class="page-actions">
        ${canExport ? html`<button class="btn btn-ghost" id="expInv" disabled>${raw(icon('download', 18))}${tr('Export asset inventory (CSV)', 'Safirisha orodha ya mali (CSV)')}</button>` : ''}
      </div>
    </div>
    <div class="grid-stats" id="stats">${Array.from({ length: 4 }, () => html`<div class="stat skel"></div>`)}</div>
    <div class="dash-grid" id="charts"></div>
    <div id="logs"></div>`);
  const $q = (s) => ctx.view.querySelector(s);

  // ------------------------------------------------------------ asset analytics
  let assets; let stats;
  try {
    [assets, stats] = await Promise.all([
      fetchAll(() => sb.from('assets')
        .select('id,title,filename,category,status,confidentiality,file_size,created_at,project_id,program_id,project:projects(name),program:program_areas(name,name_sw,color),uploader:profiles!uploaded_by(full_name)')
        .is('deleted_at', null).order('created_at', { ascending: false }).order('id')),
      fetchAll(() => sb.from('asset_stats').select('asset_id,views,downloads').order('asset_id')),
    ]);
  } catch (err) {
    if (!ctx.isCurrent()) return;
    mount($q('#stats'), '');
    mount($q('#charts'), html`<div class="span-12">${emptyState({
      icon: 'alert', title: tr('Could not load the report', 'Imeshindwa kupakia ripoti'), text: friendlyError(err),
      action: html`<button class="btn btn-primary" id="retry">${tr('Try again', 'Jaribu tena')}</button>`,
    })}</div>`);
    $q('#retry')?.addEventListener('click', () => ctx.refresh());
    return;
  }
  if (!ctx.isCurrent()) return;

  const totalBytes = assets.reduce((s, a) => s + Number(a.file_size || 0), 0);
  const totalDownloads = stats.reduce((s, x) => s + Number(x.downloads || 0), 0);
  const totalViews = stats.reduce((s, x) => s + Number(x.views || 0), 0);

  // by type + storage by category
  const typeCount = new Map(CATS.map((c) => [c, 0]));
  const typeBytes = new Map(CATS.map((c) => [c, 0]));
  assets.forEach((a) => {
    const c = typeCount.has(a.category) ? a.category : 'other';
    typeCount.set(c, typeCount.get(c) + 1);
    typeBytes.set(c, typeBytes.get(c) + Number(a.file_size || 0));
  });
  const typeItems = CATS.map((c) => ({ label: t('cat.' + c), value: typeCount.get(c), color: CAT_COLOR[c] })).filter((i) => i.value > 0);
  const storageItems = CATS.map((c) => ({ label: t('cat.' + c), value: typeBytes.get(c), color: CAT_COLOR[c] })).filter((i) => i.value > 0)
    .sort((a, b) => b.value - a.value);

  // by project / program
  const proj = new Map(); const prog = new Map();
  assets.forEach((a) => {
    const pk = a.project?.name || tr('No project', 'Bila mradi');
    proj.set(pk, { value: (proj.get(pk)?.value || 0) + 1 });
    const gk = a.program ? programName(a.program) : tr('No programme area', 'Bila eneo la programu');
    prog.set(gk, { value: (prog.get(gk)?.value || 0) + 1, color: a.program?.color || '#9AA58A' });
  });
  const projectItems = topN(proj, 10);
  const programItems = topN(prog, 10);

  // uploads per month (last 12 months, local time)
  const now = new Date();
  const monthKeys = Array.from({ length: 12 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - (11 - i), 1));
  const key = (d) => `${d.getFullYear()}-${d.getMonth()}`;
  const monthCount = new Map(monthKeys.map((d) => [key(d), 0]));
  assets.forEach((a) => { const k = key(new Date(a.created_at)); if (monthCount.has(k)) monthCount.set(k, monthCount.get(k) + 1); });
  const monthItems = monthKeys.map((d) => ({ label: fmtDate(d, { month: 'short' }), value: monthCount.get(key(d)) }));
  const last12 = monthItems.reduce((s, m) => s + m.value, 0);

  // top downloaded
  const { data: topRows } = await sb.from('asset_stats')
    .select('asset_id,downloads,views,asset:assets(id,title,category,deleted_at)')
    .gt('downloads', 0).order('downloads', { ascending: false }).limit(10);
  if (!ctx.isCurrent()) return;
  const top = (topRows || []).filter((r) => r.asset && !r.asset.deleted_at);

  mount($q('#stats'), html`
    ${stat(tr('Assets in library', 'Mali kwenye maktaba'), fmtNum(assets.length), 'database')}
    ${stat(tr('Storage used', 'Hifadhi iliyotumika'), fmtBytes(totalBytes), 'archive', 'moss', tr('current files only', 'faili za sasa tu'))}
    ${stat(tr('Downloads', 'Upakuaji'), fmtNum(totalDownloads), 'download', 'clay')}
    ${stat(tr('Views', 'Mitazamo'), fmtNum(totalViews), 'eye', 'lagoon')}`);

  const noData = (msg) => html`<p class="panel-empty">${msg}</p>`;
  mount($q('#charts'), html`
    ${panel(t('dash.bytype'), typeItems.length ? donut(typeItems, { center: fmtNum(assets.length), centerLabel: tr('assets', 'mali') }) : noData(tr('No assets yet.', 'Hakuna mali bado.')), { cls: 'span-4' })}
    ${panel(t('dash.bymonth'), assets.length ? html`${columns(monthItems, { height: 170 })}<p class="muted-text">${tr(`${fmtNum(last12)} uploaded in the last 12 months`, `${fmtNum(last12)} zimepakiwa katika miezi 12 iliyopita`)}</p>` : noData(tr('No uploads yet.', 'Hakuna upakiaji bado.')), { cls: 'span-8' })}
    ${panel(t('dash.byproject'), hbars(projectItems), { cls: 'span-4' })}
    ${panel(tr('Assets by programme area', 'Mali kwa eneo la programu'), hbars(programItems), { cls: 'span-4' })}
    ${panel(tr('Storage by category', 'Hifadhi kwa kundi'), byteBars(storageItems), { cls: 'span-4' })}
    ${panel(tr('Most downloaded', 'Zilizopakuliwa zaidi'), top.length
      ? html`<div class="table-wrap"><table class="table"><thead><tr><th>${tr('Asset', 'Mali')}</th><th>${tr('Type', 'Aina')}</th><th>${tr('Downloads', 'Upakuaji')}</th><th>${tr('Views', 'Mitazamo')}</th></tr></thead>
        <tbody>${top.map((r) => html`<tr><td><a class="link" href="#/app/assets/${r.asset.id}">${r.asset.title}</a></td>
          <td>${t('cat.' + r.asset.category)}</td><td>${fmtNum(r.downloads)}</td><td>${fmtNum(r.views)}</td></tr>`)}</tbody></table></div>`
      : noData(tr('No downloads have been recorded yet.', 'Hakuna upakuaji uliorekodiwa bado.')), { cls: 'span-12' })}`);

  const btnInv = $q('#expInv');
  if (btnInv) {
    btnInv.disabled = !assets.length;
    btnInv.addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      const csv = toCSV(assets, [
        { label: 'Title', get: (a) => a.title }, { label: 'File name', get: (a) => a.filename },
        { label: 'Type', get: (a) => a.category }, { label: 'Status', get: (a) => a.status },
        { label: 'Visibility', get: (a) => a.confidentiality }, { label: 'Size (bytes)', get: (a) => a.file_size },
        { label: 'Project', get: (a) => a.project?.name }, { label: 'Programme area', get: (a) => a.program?.name },
        { label: 'Uploaded by', get: (a) => a.uploader?.full_name }, { label: 'Uploaded at', get: (a) => a.created_at },
      ]);
      downloadText(`terravault-assets-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      await logEvent('report.export', { entity_type: 'report', title: 'Asset inventory' }, { rows: assets.length });
      toast(tr('Inventory exported.', 'Orodha imesafirishwa.'), 'success');
    }));
  }

  // ------------------------------------------------------------ activity log
  const logsHost = $q('#logs');
  if (!canLogs) {
    mount(logsHost, panel(tr('Activity log', 'Kumbukumbu za shughuli'), html`
      <p class="panel-empty">${tr('You can export reports, but viewing the full activity log needs the "view logs" permission.', 'Unaweza kusafirisha ripoti, lakini kuona kumbukumbu kamili za shughuli kunahitaji ruhusa ya "kuona kumbukumbu".')}</p>`));
    return;
  }

  const { data: people } = await sb.from('profiles').select('id,full_name,email').order('full_name');
  if (!ctx.isCurrent()) return;

  mount(logsHost, html`
    <section class="panel">
      <header class="panel-head"><h2>${tr('Activity log', 'Kumbukumbu za shughuli')}</h2>
        ${canExport ? html`<button class="btn btn-ghost btn-sm" id="expLog">${raw(icon('download', 16))}${tr('Export CSV', 'Safirisha CSV')}</button>` : ''}</header>
      <form class="filter-panel" id="lf">
        <label class="field"><span class="label">${tr('Action', 'Kitendo')}</span>
          <select class="input" name="action">${options(ACTION_KEYS, f.action, { value: (x) => x, label: (x) => `${x} · ${actionLabel(x)}`, blank: t('common.all') })}</select></label>
        <label class="field"><span class="label">${tr('Person', 'Mtu')}</span>
          <select class="input" name="user">${options(people || [], f.user, { label: (x) => x.full_name || x.email, blank: t('common.all') })}</select></label>
        <label class="field"><span class="label">${tr('From', 'Kuanzia')}</span><input class="input" type="date" name="from" value="${f.from}"></label>
        <label class="field"><span class="label">${tr('Until', 'Hadi')}</span><input class="input" type="date" name="to" value="${f.to}"></label>
        <div class="fp-actions"><button type="button" class="btn btn-ghost btn-sm" id="lclear">${t('common.clear')}</button></div>
      </form>
      <p class="result-count" id="lcount" aria-live="polite"></p>
      <div id="lrows"></div><div id="lpager"></div>
    </section>`);

  const rowsEl = $q('#lrows');
  let token = 0;
  const build = (q) => {
    if (f.action) q = q.eq('action', f.action);
    if (f.user) q = q.eq('actor_id', f.user);
    if (f.from) q = q.gte('created_at', new Date(`${f.from}T00:00:00`).toISOString());
    if (f.to) q = q.lte('created_at', new Date(`${f.to}T23:59:59.999`).toISOString());
    return q;
  };
  const detail = (l) => {
    const m = l.metadata || {};
    const bits = [];
    if (m.from && m.to) bits.push(`${m.from} → ${m.to}`);
    if (m.from_role && m.to_role && m.from_role !== m.to_role) bits.push(`${t('role.' + m.from_role)} → ${t('role.' + m.to_role)}`);
    if (m.to_status && m.from_status !== m.to_status) bits.push(`${m.from_status} → ${m.to_status}`);
    if (m.role && l.action === 'user.invited') bits.push(t('role.' + m.role));
    if (m.note) bits.push(m.note);
    if (m.size) bits.push(fmtBytes(m.size));
    if (m.version) bits.push(`v${m.version}`);
    return bits.join(' · ');
  };

  async function load() {
    const my = ++token;
    mount(rowsEl, html`<div class="view-loading"><div class="spinner" role="status" aria-label="Loading"></div></div>`);
    const from = (f.page - 1) * LOG_PAGE;
    const { data, count, error } = await build(sb.from('activity_logs').select('id,actor_id,actor_name,action,entity_type,entity_title,metadata,created_at', { count: 'exact' }))
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, from + LOG_PAGE - 1);
    if (my !== token || !ctx.isCurrent()) return;
    if (error) {
      mount(rowsEl, emptyState({ icon: 'alert', title: tr('Could not load the activity log', 'Imeshindwa kupakia kumbukumbu'), text: friendlyError(error), action: html`<button class="btn btn-primary" id="lretry">${tr('Try again', 'Jaribu tena')}</button>` }));
      $q('#lretry')?.addEventListener('click', load);
      return;
    }
    $q('#lcount').textContent = count ? `${fmtNum(count)} ${tr('events', 'matukio')}` : '';
    if (!data.length) {
      mount(rowsEl, emptyState({ icon: 'history', title: tr('No activity found', 'Hakuna shughuli iliyopatikana'), text: tr('Try a different date range or action.', 'Jaribu tarehe au kitendo tofauti.') }));
    } else {
      mount(rowsEl, html`<div class="table-wrap"><table class="table"><thead><tr>
        <th>${tr('When', 'Lini')}</th><th>${tr('Person', 'Mtu')}</th><th>${tr('Action', 'Kitendo')}</th><th>${tr('Item', 'Kipengee')}</th><th>${tr('Details', 'Maelezo')}</th></tr></thead>
        <tbody>${data.map((l) => html`<tr>
          <td title="${fmtDateTime(l.created_at)}">${fmtDateTime(l.created_at)}<small class="muted-text"> · ${timeAgo(l.created_at)}</small></td>
          <td>${l.actor_name || tr('System', 'Mfumo')}</td>
          <td>${actionLabel(l.action)}<small class="muted-text"> · ${l.action}</small></td>
          <td>${l.entity_title || '—'}</td>
          <td>${detail(l) || '—'}</td></tr>`)}</tbody></table></div>`);
    }
    mount($q('#lpager'), pagination({ page: f.page, total: count || 0, pageSize: LOG_PAGE }));
  }

  const lf = $q('#lf');
  lf.addEventListener('submit', (e) => e.preventDefault());
  lf.addEventListener('change', () => { new FormData(lf).forEach((v, k) => { f[k] = v.toString(); }); f.page = 1; load(); });
  $q('#lclear').addEventListener('click', () => { Object.assign(f, { action: '', user: '', from: '', to: '', page: 1 }); lf.reset(); lf.querySelectorAll('select,input').forEach((x) => { x.value = ''; }); load(); });
  $q('#lpager').addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (b) { f.page = +b.dataset.page; load(); } });

  $q('#expLog')?.addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    try {
      const rows = await fetchAll(() => build(sb.from('activity_logs').select('id,actor_name,action,entity_type,entity_title,metadata,created_at'))
        .order('created_at', { ascending: false }).order('id', { ascending: false }), { cap: 10000 });
      if (!rows.length) { toast(tr('There is nothing to export for these filters.', 'Hakuna cha kusafirisha kwa vichujio hivi.'), 'error'); return; }
      const csv = toCSV(rows, [
        { label: 'Date', get: (l) => l.created_at }, { label: 'Person', get: (l) => l.actor_name },
        { label: 'Action', get: (l) => l.action }, { label: 'Item type', get: (l) => l.entity_type },
        { label: 'Item', get: (l) => l.entity_title }, { label: 'Details', get: (l) => l.metadata },
      ]);
      downloadText(`terravault-activity-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      await logEvent('report.export', { entity_type: 'report', title: 'Activity log' }, { rows: rows.length });
      toast(tr(`${fmtNum(rows.length)} events exported.`, `Matukio ${fmtNum(rows.length)} yamesafirishwa.`), 'success');
    } catch (err) { toast(friendlyError(err), 'error'); }
  }));

  await load();
}
