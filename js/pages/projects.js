// Projects: searchable cards with a programme-area filter and a create-project modal.
import { sb } from '../lib/supabase.js';
import { can } from '../lib/state.js';
import { state } from '../lib/state.js';
import { html, raw, mount, debounce, replaceHash, fmtDate, go } from '../lib/util.js';
import { t, tr } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { emptyState, openModal, toast, withBusy, options, programName, formData, nullIfEmpty } from '../lib/ui.js';
import { ref, invalidateRef, friendlyError } from '../lib/api.js';

export const PROJECT_STATUSES = ['planned', 'active', 'completed', 'on_hold'];
export const projectStatusLabel = (s) => ({
  planned: tr('Planned', 'Imepangwa'), active: tr('Active', 'Inaendelea'),
  completed: tr('Completed', 'Imekamilika'), on_hold: tr('On hold', 'Imesimamishwa'),
}[s] || s);

export const PROJECT_SELECT =
  'id,name,code,description,program_id,geographic_coverage,start_date,end_date,manager_id,status,is_restricted,created_at,updated_at,' +
  'program:program_areas(id,name,name_sw,color),manager:profiles!manager_id(id,full_name,email)';

export const dateRange = (p) => [p.start_date && fmtDate(p.start_date), p.end_date && fmtDate(p.end_date)].filter(Boolean).join(' – ');

/** Create (project = null) or edit a project. Resolves with the saved project id, or null if cancelled. */
export async function openProjectForm(project = null) {
  const staff = await ref('staff');
  const isEdit = !!project;
  const v = project || { status: 'planned' };
  return new Promise((resolve) => {
    let saved = null;
    const m = openModal({
      title: isEdit ? tr('Edit project', 'Hariri mradi') : tr('New project', 'Mradi mpya'), size: 'lg',
      body: html`<form id="pf" novalidate>
        <div class="form-grid">
          <label class="field wide"><span class="label">${tr('Project name', 'Jina la mradi')} <b class="req">*</b></span>
            <input class="input" name="name" required maxlength="200" value="${v.name ?? ''}"></label>
          <label class="field"><span class="label">${tr('Project code', 'Msimbo wa mradi')}</span>
            <input class="input" name="code" maxlength="40" value="${v.code ?? ''}" placeholder="TV-2026-01">
            <small class="hint-text">${tr('Optional. Must be unique.', 'Si lazima. Lazima uwe wa kipekee.')}</small></label>
          <label class="field"><span class="label">${tr('Programme area', 'Eneo la programu')}</span>
            <select class="input" name="program_id">${options(state.programs, v.program_id, { label: programName, blank: t('common.none') })}</select></label>
          <label class="field"><span class="label">${tr('Status', 'Hali')}</span>
            <select class="input" name="status">${options(PROJECT_STATUSES, v.status, { value: (x) => x, label: projectStatusLabel })}</select></label>
          <label class="field"><span class="label">${tr('Project manager', 'Meneja wa mradi')}</span>
            <select class="input" name="manager_id">${options(staff, v.manager_id, { label: (x) => x.full_name || x.email, blank: t('common.none') })}</select></label>
          <label class="field wide"><span class="label">${tr('Geographic coverage', 'Eneo la utekelezaji')}</span>
            <input class="input" name="geographic_coverage" maxlength="300" value="${v.geographic_coverage ?? ''}" placeholder="${tr('e.g. Mwanza and Geita regions', 'mfano Mikoa ya Mwanza na Geita')}"></label>
          <label class="field"><span class="label">${tr('Start date', 'Tarehe ya kuanza')}</span><input class="input" type="date" name="start_date" value="${v.start_date ?? ''}"></label>
          <label class="field"><span class="label">${tr('End date', 'Tarehe ya kumaliza')}</span><input class="input" type="date" name="end_date" value="${v.end_date ?? ''}"></label>
          <label class="field wide"><span class="label">${tr('Description', 'Maelezo')}</span>
            <textarea class="input" name="description" rows="4" maxlength="4000">${v.description ?? ''}</textarea></label>
          <label class="check wide"><input type="checkbox" name="is_restricted" ${v.is_restricted ? raw('checked') : ''}>
            <span>${tr('Restrict to project members and administrators', 'Weka kwa wanachama wa mradi na wasimamizi tu')}</span></label>
        </div>
        <p class="field-error" id="pfErr" hidden></p>
      </form>`,
      footer: html`<button class="btn btn-ghost" data-close>${t('common.cancel')}</button>
        <button class="btn btn-primary" id="pfSave">${isEdit ? t('common.save') : t('common.create')}</button>`,
      onClose: () => resolve(saved),
    });
    const form = m.el.querySelector('#pf');
    const err = (msg) => { const e = m.el.querySelector('#pfErr'); e.textContent = msg || ''; e.hidden = !msg; };
    form.addEventListener('submit', (e) => e.preventDefault());
    m.el.querySelector('#pfSave').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      err('');
      const f = formData(form);
      if (!f.name) { err(tr('A project name is required.', 'Jina la mradi linahitajika.')); return; }
      if (f.start_date && f.end_date && f.end_date < f.start_date) { err(tr('The end date cannot be before the start date.', 'Tarehe ya kumaliza haiwezi kuwa kabla ya tarehe ya kuanza.')); return; }
      const payload = {
        name: f.name, code: nullIfEmpty(f.code), description: nullIfEmpty(f.description),
        program_id: nullIfEmpty(f.program_id), manager_id: nullIfEmpty(f.manager_id),
        geographic_coverage: nullIfEmpty(f.geographic_coverage), start_date: nullIfEmpty(f.start_date), end_date: nullIfEmpty(f.end_date),
        status: f.status || 'planned', is_restricted: !!f.is_restricted,
      };
      if (isEdit) {
        const { data, error } = await sb.from('projects').update(payload).eq('id', project.id).select('id');
        if (error) { err(/duplicate key/i.test(error.message) ? tr('That project code is already in use.', 'Msimbo huo wa mradi tayari unatumika.') : friendlyError(error)); return; }
        if (!data?.length) { err(tr('You do not have permission to do that.', 'Huna ruhusa ya kufanya hivyo.')); return; }
        saved = project.id;
      } else {
        const { data, error } = await sb.from('projects').insert(payload).select('id').single();
        if (error) { err(/duplicate key/i.test(error.message) ? tr('That project code is already in use.', 'Msimbo huo wa mradi tayari unatumika.') : friendlyError(error)); return; }
        saved = data.id;
      }
      invalidateRef('projects');
      toast(isEdit ? tr('Project saved.', 'Mradi umehifadhiwa.') : tr('Project created.', 'Mradi umeundwa.'), 'success');
      m.close();
    }));
  });
}

export default async function projects(ctx) {
  const f = { q: ctx.query.q || '', program: ctx.query.program || '', status: ctx.query.status || '' };
  const canCreate = can('manage_projects');

  mount(ctx.view, html`
    <div class="page-head">
      <div><h1>${t('nav.projects')}</h1><p>${tr('Every project and the files that belong to it.', 'Kila mradi na mafaili yake.')}</p></div>
      <div class="page-actions">${canCreate ? html`<button class="btn btn-primary" id="new">${raw(icon('plus', 18))}${tr('New project', 'Mradi mpya')}</button>` : ''}</div>
    </div>
    <div class="toolbar">
      <label class="search-field">${raw(icon('search', 18))}
        <input type="search" id="q" value="${f.q}" placeholder="${tr('Search by name, code or place…', 'Tafuta kwa jina, msimbo au mahali…')}" aria-label="${t('common.search')}"></label>
      <select class="input" id="program" aria-label="${tr('Programme area', 'Eneo la programu')}">${options(state.programs, f.program, { label: programName, blank: tr('All programme areas', 'Maeneo yote ya programu') })}</select>
      <select class="input" id="status" aria-label="${tr('Status', 'Hali')}">${options(PROJECT_STATUSES, f.status, { value: (x) => x, label: projectStatusLabel, blank: tr('Any status', 'Hali yoyote') })}</select>
    </div>
    <p class="result-count" id="count" aria-live="polite"></p>
    <div id="list"><div class="spinner" role="status" aria-label="Loading"></div></div>`);
  const $q = (s) => ctx.view.querySelector(s);
  $q('#new')?.addEventListener('click', async () => { const id = await openProjectForm(); if (id) go(`/app/projects/${id}`); });

  const { data, error } = await sb.from('projects').select(PROJECT_SELECT).order('name');
  if (!ctx.isCurrent()) return;
  if (error) {
    mount($q('#list'), emptyState({ icon: 'alert', title: tr('Could not load projects', 'Imeshindwa kupakia miradi'), text: friendlyError(error) }));
    return;
  }
  const all = data || [];

  const paint = () => {
    const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = all.filter((p) => (!f.program || p.program_id === f.program) && (!f.status || p.status === f.status)
      && words.every((w) => [p.name, p.code, p.geographic_coverage, p.description].some((x) => (x || '').toLowerCase().includes(w))));
    $q('#count').textContent = all.length ? `${rows.length} / ${all.length}` : '';
    const filtered = f.q || f.program || f.status;
    if (!rows.length) {
      mount($q('#list'), emptyState({
        icon: filtered ? 'search' : 'folder',
        title: filtered ? tr('No projects match', 'Hakuna miradi inayolingana') : tr('No projects yet', 'Hakuna miradi bado'),
        text: filtered ? tr('Try a different search or clear the filters.', 'Jaribu utafutaji tofauti au futa vichujio.')
          : (canCreate ? tr('Create the first project to start organising files.', 'Unda mradi wa kwanza ili kuanza kupanga mafaili.') : tr('Projects you can access will appear here.', 'Miradi unayoweza kufikia itaonekana hapa.')),
        action: filtered ? html`<button class="btn btn-ghost" id="clear">${t('common.clear')}</button>`
          : (canCreate ? html`<button class="btn btn-primary" id="emptyNew">${raw(icon('plus', 18))}${tr('New project', 'Mradi mpya')}</button>` : ''),
      }));
      $q('#clear')?.addEventListener('click', () => {
        Object.assign(f, { q: '', program: '', status: '' });
        $q('#q').value = ''; $q('#program').value = ''; $q('#status').value = ''; sync(); paint();
      });
      $q('#emptyNew')?.addEventListener('click', async () => { const id = await openProjectForm(); if (id) go(`/app/projects/${id}`); });
      return;
    }
    mount($q('#list'), html`<div class="project-grid">${rows.map((p) => {
      const dates = dateRange(p);
      return html`<a class="project-card" href="#/app/projects/${p.id}" style="--pc:${p.program?.color || '#006E70'}">
        ${p.program ? html`<span class="pc-tag">${programName(p.program)}</span>` : ''}
        <h3>${p.name}${p.is_restricted ? html` <span class="flag-lock" title="${tr('Restricted to members', 'Kwa wanachama tu')}">${raw(icon('lock', 14))}</span>` : ''}</h3>
        <p class="pc-code">${p.code ? html`<b>${p.code}</b> · ` : ''}<span class="badge pj-${p.status}">${projectStatusLabel(p.status)}</span></p>
        ${p.description ? html`<p class="pc-desc">${p.description}</p>` : ''}
        <ul class="pc-meta">
          ${p.geographic_coverage ? html`<li>${raw(icon('pin', 15))}${p.geographic_coverage}</li>` : ''}
          ${dates ? html`<li>${raw(icon('calendar', 15))}${dates}</li>` : ''}
          ${p.manager ? html`<li>${raw(icon('user', 15))}${p.manager.full_name || p.manager.email}</li>` : ''}
        </ul></a>`;
    })}</div>`);
  };
  const sync = () => replaceHash(ctx.path, f);
  $q('#q').addEventListener('input', debounce(() => { f.q = $q('#q').value.trim(); sync(); paint(); }, 200));
  $q('#program').addEventListener('change', (e) => { f.program = e.target.value; sync(); paint(); });
  $q('#status').addEventListener('change', (e) => { f.status = e.target.value; sync(); paint(); });
  paint();
}
