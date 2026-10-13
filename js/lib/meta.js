// The asset metadata form, used by the uploader (shared defaults) and the editor.
import { state, can } from './state.js';
import { html, raw } from './util.js';
import { t, tr, getLang } from './i18n.js';
import { icon } from './icons.js';
import { options, tagInput, nullIfEmpty, programName, toast } from './ui.js';
import { ref } from './api.js';

export async function loadMetaRefs() {
  const [tags, projects, fields] = await Promise.all([ref('tags'), ref('projects'), ref('fields')]);
  return { tags, projects, fields };
}

const CONF_HELP = () => ({
  public: tr('Safe to show anyone once it is published.', 'Salama kuonyeshwa kwa yeyote ikishachapishwa.'),
  internal: tr('Visible to Terraviva staff only.', 'Inaonekana kwa wafanyakazi wa Terraviva tu.'),
  restricted: tr('Only project members and administrators. Named-person sharing only.', 'Wanachama wa mradi na wasimamizi tu. Kushiriki kwa jina tu.'),
  confidential: tr('Administrators and the uploader only. Cannot be shared.', 'Wasimamizi na aliyepakia tu. Haiwezi kushirikiwa.'),
});

const field = (label, control, { wide = false, hint = '' } = {}) => html`<label class="field ${wide ? 'wide' : ''}">
  <span class="label">${label}</span>${control}${hint ? html`<small class="hint-text">${hint}</small>` : ''}</label>`;

export function customFieldControl(f, value) {
  const name = `cf_${f.key}`;
  const label = getLang() === 'sw' && f.label_sw ? f.label_sw : f.label;
  const req = f.is_required ? raw('required') : '';
  let control;
  if (f.field_type === 'select') {
    const opts = Array.isArray(f.options) ? f.options : [];
    control = html`<select class="input" name="${name}" ${req}><option value=""></option>${opts.map((o) => html`<option ${String(value) === String(o) ? raw('selected') : ''}>${o}</option>`)}</select>`;
  } else if (f.field_type === 'textarea') control = html`<textarea class="input" rows="3" name="${name}" ${req}>${value ?? ''}</textarea>`;
  else if (f.field_type === 'date') control = html`<input class="input" type="date" name="${name}" value="${value ?? ''}" ${req}>`;
  else if (f.field_type === 'number') control = html`<input class="input" type="number" name="${name}" value="${value ?? ''}" ${req}>`;
  else if (f.field_type === 'boolean') control = html`<select class="input" name="${name}" ${req}><option value=""></option><option value="true" ${String(value) === 'true' ? raw('selected') : ''}>${tr('Yes', 'Ndiyo')}</option><option value="false" ${String(value) === 'false' ? raw('selected') : ''}>${tr('No', 'Hapana')}</option></select>`;
  else control = html`<input class="input" name="${name}" value="${value ?? ''}" maxlength="300" ${req}>`;
  return field(label, control);
}

/** @param bulk true when the values apply to many files (no title/filename). */
export function metaForm(v = {}, refs, { bulk = false } = {}) {
  const custom = v.custom_metadata || {};
  const visibleProjects = refs.projects;
  return html`
    <div class="form-grid">
      ${bulk ? '' : field(html`${tr('Title', 'Kichwa')} <b class="req">*</b>`, html`<input class="input" name="title" value="${v.title ?? ''}" required maxlength="300">`, { wide: true })}
      ${field(tr('Description', 'Maelezo'), html`<textarea class="input" name="description" rows="3" maxlength="4000">${v.description ?? ''}</textarea>`, { wide: true })}
      ${field(tr('Project', 'Mradi'), html`<select class="input" name="project_id">${options(visibleProjects, v.project_id, { blank: t('common.none') })}</select>`)}
      ${field(tr('Programme area', 'Eneo la programu'), html`<select class="input" name="program_id">${options(state.programs, v.program_id, { label: programName, blank: t('common.none') })}</select>`)}
      ${field(tr('Who can see it', 'Nani anaweza kuiona'), html`<select class="input" name="confidentiality">
        ${['internal', 'public', 'restricted', 'confidential'].map((c) => html`<option value="${c}" ${(v.confidentiality || 'internal') === c ? raw('selected') : ''}>${t('conf.' + c)}</option>`)}</select>`,
        { wide: true, hint: CONF_HELP()[v.confidentiality || 'internal'] })}
      <div class="field wide"><span class="label">${tr('Tags', 'Lebo')}</span><div data-tags></div></div>
      ${field(tr('Keywords', 'Maneno muhimu'), html`<input class="input" name="keywords" value="${(v.keywords || []).join(', ')}" placeholder="${tr('comma separated', 'tenganisha kwa koma')}">`, { wide: true })}
    </div>
    <details class="more" ${bulk ? '' : raw('open')}>
      <summary>${tr('Place, credit and rights', 'Mahali, shukrani na haki')}</summary>
      <div class="form-grid">
        ${field(tr('Country', 'Nchi'), html`<input class="input" name="country" value="${v.country ?? 'Tanzania'}">`)}
        ${field(tr('Region', 'Mkoa'), html`<input class="input" name="region" value="${v.region ?? ''}" placeholder="Mwanza">`)}
        ${field(tr('District', 'Wilaya'), html`<input class="input" name="district" value="${v.district ?? ''}">`)}
        ${field(tr('Ward or community', 'Kata au jamii'), html`<input class="input" name="ward" value="${v.ward ?? ''}">`)}
        ${field(tr('Date captured or created', 'Tarehe ya kupigwa au kuundwa'), html`<input class="input" type="date" name="captured_at" value="${v.captured_at ?? ''}">`)}
        ${field(tr('Language', 'Lugha'), html`<input class="input" name="language" value="${v.language ?? ''}" placeholder="Kiswahili, English">`)}
        ${field(tr('Creator or photographer', 'Muundaji au mpiga picha'), html`<input class="input" name="creator" value="${v.creator ?? ''}">`)}
        ${field(tr('Copyright holder', 'Mmiliki wa hakimiliki'), html`<input class="input" name="copyright_holder" value="${v.copyright_holder ?? ''}" placeholder="Terraviva">`)}
        ${field(tr('Usage terms', 'Masharti ya matumizi'), html`<textarea class="input" name="usage_rights" rows="2">${v.usage_rights ?? ''}</textarea>`, { wide: true })}
        ${field(tr('Department', 'Idara'), html`<input class="input" name="department" value="${v.department ?? ''}">`, { wide: true })}
        <label class="check wide"><input type="checkbox" name="public_download" ${v.public_download === false ? '' : raw('checked')}>
          <span>${tr('Allow visitors to download this file once it is published', 'Ruhusu wageni kupakua faili hii ikishachapishwa')}</span></label>
        ${refs.fields.map((f) => customFieldControl(f, custom[f.key]))}
      </div>
    </details>`;
}

/** Wire tag input and the "sensitive programme" nudge. Returns the tag controller. */
export function bindMetaForm(root, refs, selectedTags = []) {
  const ctl = tagInput(root.querySelector('[data-tags]'), {
    all: refs.tags, selected: selectedTags, canCreate: can('edit_metadata'),
    placeholder: tr('Add a tag…', 'Ongeza lebo…'),
  });
  const program = root.querySelector('[name=program_id]');
  const conf = root.querySelector('[name=confidentiality]');
  const hint = conf?.closest('.field')?.querySelector('.hint-text');
  const help = () => { if (hint) hint.textContent = CONF_HELP()[conf.value]; };
  conf?.addEventListener('change', help);
  program?.addEventListener('change', () => {
    const p = state.programs.find((x) => x.id === program.value);
    if (p?.is_sensitive && ['internal', 'public'].includes(conf.value)) {
      conf.value = 'restricted'; help();
      toast(tr('This programme area is sensitive, so files start as Restricted.', 'Eneo hili la programu ni nyeti, kwa hiyo mafaili huanza kama Yenye vikwazo.'), 'info', 5200);
    }
  });
  return ctl;
}

export function readMeta(form, refs, { bulk = false } = {}) {
  const fd = new FormData(form);
  const g = (k) => nullIfEmpty((fd.get(k) ?? '').toString().trim());
  const out = {
    description: g('description'), project_id: g('project_id'), program_id: g('program_id'),
    confidentiality: g('confidentiality') || 'internal',
    department: g('department'), country: g('country'), region: g('region'), district: g('district'), ward: g('ward'),
    captured_at: g('captured_at'), language: g('language'), creator: g('creator'),
    copyright_holder: g('copyright_holder'), usage_rights: g('usage_rights'),
    public_download: form.querySelector('[name=public_download]')?.checked ?? true,
    keywords: (g('keywords') || '').split(',').map((s) => s.trim()).filter(Boolean),
  };
  if (!bulk) out.title = (fd.get('title') || '').toString().trim();
  const cm = {};
  refs.fields.forEach((f) => {
    const raw_ = g(`cf_${f.key}`);
    if (raw_ == null) return;
    cm[f.key] = f.field_type === 'number' ? Number(raw_) : f.field_type === 'boolean' ? raw_ === 'true' : raw_;
  });
  out.custom_metadata = cm;
  return out;
}

/** Make sure every named tag exists; returns tag ids. */
export async function resolveTagIds(names) {
  const { sb } = await import('./supabase.js');
  const known = await ref('tags');
  const ids = [];
  for (const name of names) {
    const hit = known.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (hit) { ids.push(hit.id); continue; }
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `tag-${Date.now()}`;
    const { data, error } = await sb.from('tags').insert({ name, slug, is_standard: false }).select('id,name,slug,is_standard').single();
    if (error) {
      // Someone may have created it a moment ago.
      const { data: again } = await sb.from('tags').select('id,name').ilike('name', name).maybeSingle();
      if (again) { ids.push(again.id); continue; }
      throw error;
    }
    known.push(data); ids.push(data.id);
  }
  return ids;
}
