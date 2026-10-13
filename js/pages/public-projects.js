// Public projects: only projects that have at least one published item are visible to visitors.
import { sb } from '../lib/supabase.js';
import { state } from '../lib/state.js';
import { html, raw, mount, fmtDate, fmtNum } from '../lib/util.js';
import { t, tr } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { emptyState, programName } from '../lib/ui.js';

export default async function publicProjects(ctx) {
  mount(ctx.view, html`
    <section class="page-banner"><div class="container"><h1>${t('pub.nav.projects')}</h1>
      <p>${tr('Projects with published photographs, reports and resources.', 'Miradi yenye picha, ripoti na rasilimali zilizochapishwa.')}</p></div></section>
    <div class="container pad-lg" id="list"><div class="view-loading"><div class="spinner"></div></div></div>`);

  const [{ data: projects }, { data: assets }] = await Promise.all([
    sb.from('projects').select('id,name,code,description,program_id,geographic_coverage,start_date,end_date,status').order('name'),
    sb.from('assets').select('project_id').eq('status', 'published').is('deleted_at', null).not('project_id', 'is', null).limit(2000),
  ]);
  if (!ctx.isCurrent()) return;
  const counts = {};
  (assets || []).forEach((r) => { counts[r.project_id] = (counts[r.project_id] || 0) + 1; });
  const list = ctx.view.querySelector('#list');

  if (!projects?.length) {
    mount(list, emptyState({
      icon: 'folder', title: tr('No public projects yet', 'Hakuna miradi ya umma bado'),
      text: tr('A project appears here once it has published material.', 'Mradi huonekana hapa ukishakuwa na vifaa vilivyochapishwa.'),
    }));
    return;
  }
  const prog = (id) => state.programs.find((p) => p.id === id);
  mount(list, html`<div class="project-grid">${projects.map((p) => {
    const pr = prog(p.program_id);
    const dates = [p.start_date && fmtDate(p.start_date), p.end_date && fmtDate(p.end_date)].filter(Boolean).join(' – ');
    return html`<a class="project-card" href="#/explore?project=${p.id}" style="--pc:${pr?.color || '#006E70'}">
      ${pr ? html`<span class="pc-tag">${programName(pr)}</span>` : ''}
      <h3>${p.name}</h3>
      ${p.description ? html`<p>${p.description}</p>` : ''}
      <ul class="pc-meta">
        ${p.geographic_coverage ? html`<li>${raw(icon('pin', 15))}${p.geographic_coverage}</li>` : ''}
        ${dates ? html`<li>${raw(icon('calendar', 15))}${dates}</li>` : ''}
        <li>${raw(icon('image', 15))}${fmtNum(counts[p.id] || 0)} ${tr('published items', 'vipengee vilivyochapishwa')}</li>
      </ul></a>`;
  })}</div>`);
}
