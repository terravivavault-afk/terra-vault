// Project workspace: details, members, and the project's assets.
import { sb } from '../lib/supabase.js';
import { can, isManagerOf } from '../lib/state.js';
import { html, raw, mount, fmtDate, fmtNum } from '../lib/util.js';
import { t, tr } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { assetCard, emptyState, skeletonGrid, pagination, options, programName, avatar, toast, confirmDialog, withBusy, openModal } from '../lib/ui.js';
import { ASSET_LIST_SELECT, hydrateThumbs, ref, friendlyError } from '../lib/api.js';
import { openUploader } from '../lib/uploader.js';
import { PAGE_SIZE } from '../config.js';
import { PROJECT_SELECT, projectStatusLabel, dateRange, openProjectForm } from './projects.js';

const STATUSES = ['draft', 'pending_review', 'changes_requested', 'approved', 'published', 'archived', 'rejected'];
const MEMBER_ROLES = ['manager', 'member', 'viewer'];
const memberRoleLabel = (r) => ({ manager: tr('Manager', 'Meneja'), member: tr('Member', 'Mwanachama'), viewer: tr('Viewer', 'Mtazamaji') }[r] || r);
const kvRow = (k, v) => (v === null || v === undefined || v === '' ? '' : html`<div><dt>${k}</dt><dd>${v}</dd></div>`);

export default async function project(ctx) {
  const id = ctx.id;
  const { data: p, error } = await sb.from('projects').select(PROJECT_SELECT).eq('id', id).maybeSingle();
  if (!ctx.isCurrent()) return;
  if (error || !p) {
    mount(ctx.view, emptyState({
      icon: error ? 'alert' : 'search',
      title: error ? tr('Could not load this project', 'Imeshindwa kupakia mradi huu') : tr('Project not found', 'Mradi haujapatikana'),
      text: error ? friendlyError(error) : tr('It may have been removed, or you may not have access to it.', 'Huenda umeondolewa, au huna ruhusa ya kuufikia.'),
      action: html`<a class="btn btn-primary" href="#/app/projects">${t('nav.projects')}</a>`,
    }));
    return;
  }

  const manage = can('manage_projects') || isManagerOf(id);
  const f = { status: '', page: 1 };
  let token = 0;
  let members = [];

  mount(ctx.view, html`
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/app/projects">${t('nav.projects')}</a>${raw(icon('chevron-right', 14))}<span>${p.name}</span></nav>
    <div class="page-head">
      <div>
        <h1>${p.name}${p.is_restricted ? html` <span class="flag-lock" title="${tr('Restricted to members', 'Kwa wanachama tu')}">${raw(icon('lock', 18))}</span>` : ''}</h1>
        <p>${p.code ? html`<b>${p.code}</b> · ` : ''}<span class="badge pj-${p.status}">${projectStatusLabel(p.status)}</span>${p.program ? ' · ' + programName(p.program) : ''}</p>
      </div>
      <div class="page-actions">
        ${can('upload') ? html`<button class="btn btn-primary" id="up">${raw(icon('upload', 18))}${tr('Upload to this project', 'Pakia kwenye mradi huu')}</button>` : ''}
        ${manage ? html`<button class="btn btn-ghost" id="edit">${raw(icon('edit', 17))}${t('common.edit')}</button>` : ''}
      </div>
    </div>

    <div class="asset-layout">
      <div class="asset-main">
        <section class="panel">
          <header class="panel-head"><h2>${tr('Project assets', 'Mali za mradi')}</h2><span class="result-count" id="count" aria-live="polite"></span></header>
          <div class="toolbar">
            <select class="input" id="status" aria-label="${tr('Status', 'Hali')}">${options(STATUSES, '', { value: (x) => x, label: (x) => t('status.' + x), blank: tr('Active (not archived)', 'Zinazotumika (si kumbukumbu)') })}</select>
          </div>
          <div id="results"></div>
          <div id="pager"></div>
        </section>
      </div>
      <aside class="asset-side">
        <section class="panel">
          <header class="panel-head"><h2>${tr('Details', 'Maelezo')}</h2></header>
          ${p.description ? html`<p class="asset-desc">${p.description}</p>` : ''}
          <dl class="kv">
            ${kvRow(tr('Programme area', 'Eneo la programu'), p.program ? programName(p.program) : '')}
            ${kvRow(tr('Geographic coverage', 'Eneo la utekelezaji'), p.geographic_coverage)}
            ${kvRow(tr('Dates', 'Tarehe'), dateRange(p))}
            ${kvRow(tr('Project manager', 'Meneja wa mradi'), p.manager ? (p.manager.full_name || p.manager.email) : '')}
            ${kvRow(tr('Created', 'Imeundwa'), fmtDate(p.created_at))}
          </dl>
          ${!p.description && !p.geographic_coverage && !dateRange(p) && !p.manager
            ? html`<p class="muted-text">${tr('No further details have been added yet.', 'Hakuna maelezo mengine yaliyoongezwa bado.')}</p>` : ''}
        </section>
        <section class="panel">
          <header class="panel-head"><h2>${tr('Members', 'Wanachama')}</h2>
            ${manage ? html`<button class="btn btn-ghost btn-sm" id="addMember">${raw(icon('plus', 16))}${t('common.add')}</button>` : ''}</header>
          <div id="members"><div class="spinner" role="status" aria-label="Loading"></div></div>
        </section>
      </aside>
    </div>`);

  const $q = (s) => ctx.view.querySelector(s);
  const results = $q('#results'); const pager = $q('#pager');

  // ---------------------------------------------------------------- assets
  async function loadAssets() {
    const my = ++token;
    mount(results, skeletonGrid(6));
    let q = sb.from('assets').select(ASSET_LIST_SELECT, { count: 'exact' }).eq('project_id', id).is('deleted_at', null);
    q = f.status ? q.eq('status', f.status) : q.neq('status', 'archived');
    const from = (f.page - 1) * PAGE_SIZE;
    const { data, count, error: err } = await q.order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
    if (my !== token) return;
    if (err) { mount(results, emptyState({ icon: 'alert', title: tr('Could not load assets', 'Imeshindwa kupakia mali'), text: friendlyError(err) })); return; }
    $q('#count').textContent = count ? `${fmtNum(count)} ${tr('assets', 'mali')}` : '';
    if (!data?.length) {
      mount(results, emptyState({
        icon: 'image', title: f.status ? tr('No assets with this status', 'Hakuna mali zenye hali hii') : tr('No assets in this project yet', 'Hakuna mali kwenye mradi huu bado'),
        text: can('upload') && !f.status ? tr('Upload files and they will be filed under this project.', 'Pakia mafaili na yatahifadhiwa chini ya mradi huu.') : '',
        action: can('upload') && !f.status ? html`<button class="btn btn-primary" id="emptyUp">${raw(icon('upload', 18))}${t('common.upload')}</button>` : '',
      }));
      $q('#emptyUp')?.addEventListener('click', () => openUploader({ project_id: id }));
    } else {
      mount(results, html`<div class="asset-grid">${data.map((a) => assetCard(a))}</div>`);
      hydrateThumbs(results);
    }
    mount(pager, pagination({ page: f.page, total: count || 0, pageSize: PAGE_SIZE }));
  }
  $q('#status').addEventListener('change', (e) => { f.status = e.target.value; f.page = 1; loadAssets(); });
  pager.addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (b) { f.page = +b.dataset.page; loadAssets(); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
  $q('#up')?.addEventListener('click', () => openUploader({ project_id: id }));
  $q('#edit')?.addEventListener('click', async () => { if (await openProjectForm(p)) ctx.refresh(); });

  // ---------------------------------------------------------------- members
  const host = $q('#members');
  function paintMembers() {
    if (!members.length) { mount(host, html`<p class="muted-text">${tr('No members yet.', 'Hakuna wanachama bado.')}</p>`); return; }
    mount(host, html`<ul class="mini-list member-list">${members.map((m) => {
      const name = m.user?.full_name || m.user?.email || '—';
      const primary = m.user_id === p.manager_id;
      return html`<li class="member" data-user="${m.user_id}">
        ${avatar(name)}
        <span class="mini-t"><b>${name}</b><small>${m.user?.email && m.user?.full_name ? m.user.email : ''}${primary ? (m.user?.full_name ? ' · ' : '') + tr('Project manager', 'Meneja wa mradi') : ''}</small></span>
        ${manage ? html`<select class="input input-sm" data-role="${m.user_id}" aria-label="${tr('Role', 'Wadhifa')}" ${primary ? raw('disabled') : ''}>${options(MEMBER_ROLES, m.role, { value: (x) => x, label: memberRoleLabel })}</select>
          <button class="icon-btn" data-remove="${m.user_id}" aria-label="${t('common.remove')}" title="${primary ? tr('Change the project manager under Edit first', 'Badilisha meneja wa mradi kupitia Hariri kwanza') : t('common.remove')}" ${primary ? raw('disabled') : ''}>${raw(icon('x', 16))}</button>`
          : html`<span class="badge">${memberRoleLabel(m.role)}</span>`}
      </li>`;
    })}</ul>`);
  }
  async function loadMembers() {
    const { data, error: err } = await sb.from('project_members').select('user_id,role,created_at,user:profiles!user_id(id,full_name,email,role)').eq('project_id', id);
    if (!ctx.isCurrent()) return;
    if (err) { mount(host, html`<p class="field-error">${friendlyError(err)}</p>`); return; }
    members = (data || []).sort((a, b) => (a.role === 'manager' ? -1 : 0) - (b.role === 'manager' ? -1 : 0) || (a.user?.full_name || '').localeCompare(b.user?.full_name || ''));
    paintMembers();
  }
  host.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-role]');
    if (!sel) return;
    const { data, error: err } = await sb.from('project_members').update({ role: sel.value }).eq('project_id', id).eq('user_id', sel.dataset.role).select('user_id');
    if (err || !data?.length) { toast(err ? friendlyError(err) : tr('You do not have permission to do that.', 'Huna ruhusa ya kufanya hivyo.'), 'error'); await loadMembers(); return; }
    toast(tr('Role updated.', 'Wadhifa umesasishwa.'), 'success');
    await loadMembers();
  });
  host.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b || b.disabled) return;
    const m = members.find((x) => x.user_id === b.dataset.remove);
    const ok = await confirmDialog({
      title: tr('Remove this member?', 'Ondoa mwanachama huyu?'),
      message: tr(`${m?.user?.full_name || 'This person'} will lose the project access they had through membership. Their uploads stay in the project.`, `${m?.user?.full_name || 'Mtu huyu'} atapoteza ufikiaji wa mradi alioupata kwa kuwa mwanachama. Mali alizopakia zitabaki kwenye mradi.`),
      confirmText: t('common.remove'), danger: true,
    });
    if (!ok) return;
    const { data, error: err } = await sb.from('project_members').delete().eq('project_id', id).eq('user_id', b.dataset.remove).select('user_id');
    if (err || !data?.length) { toast(err ? friendlyError(err) : tr('You do not have permission to do that.', 'Huna ruhusa ya kufanya hivyo.'), 'error'); return; }
    toast(tr('Member removed.', 'Mwanachama ameondolewa.'), 'success');
    await loadMembers();
  });
  $q('#addMember')?.addEventListener('click', async () => {
    const staff = await ref('staff');
    const taken = new Set(members.map((m) => m.user_id));
    const candidates = staff.filter((s) => !taken.has(s.id));
    const modal = openModal({
      title: tr('Add a member', 'Ongeza mwanachama'), size: 'sm',
      body: candidates.length ? html`
        <label class="field"><span class="label">${tr('Person', 'Mtu')}</span>
          <select class="input" id="mu">${options(candidates, candidates[0].id, { label: (x) => `${x.full_name || x.email}${x.full_name ? ' · ' + x.email : ''}` })}</select></label>
        <label class="field"><span class="label">${tr('Role in this project', 'Wadhifa kwenye mradi huu')}</span>
          <select class="input" id="mr">${options(MEMBER_ROLES, 'member', { value: (x) => x, label: memberRoleLabel })}</select></label>
        <p class="hint-text">${tr('Members can see this project’s files. Managers can also review and manage them.', 'Wanachama wanaweza kuona mafaili ya mradi huu. Mameneja wanaweza pia kuyakagua na kuyasimamia.')}</p>`
        : html`<p class="muted-text">${tr('Every active staff member is already in this project.', 'Kila mfanyakazi aliye hai tayari yuko kwenye mradi huu.')}</p>`,
      footer: candidates.length ? html`<button class="btn btn-ghost" data-close>${t('common.cancel')}</button><button class="btn btn-primary" id="go">${t('common.add')}</button>`
        : html`<button class="btn btn-ghost" data-close>${t('common.close')}</button>`,
    });
    modal.el.querySelector('#go')?.addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      const { error: err } = await sb.from('project_members').insert({ project_id: id, user_id: modal.el.querySelector('#mu').value, role: modal.el.querySelector('#mr').value });
      if (err) { toast(friendlyError(err), 'error'); return; }
      modal.close(); toast(tr('Member added.', 'Mwanachama ameongezwa.'), 'success');
      await loadMembers();
    }));
  });

  await Promise.all([loadAssets(), loadMembers()]);
}
