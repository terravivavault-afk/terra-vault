// Settings: organisation, programme areas, tags, custom metadata fields, storage and security notes.
import { sb } from '../lib/supabase.js';
import { state, isAdmin, loadPublicRefs } from '../lib/state.js';
import { html, raw, mount, fmtBytes, fmtNum, slugify, replaceHash } from '../lib/util.js';
import { t, tr } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { emptyState, openModal, confirmDialog, toast, withBusy, options, programName } from '../lib/ui.js';
import { friendlyError, invalidateRef } from '../lib/api.js';
import { CAT_COLOR } from '../lib/labels.js';

const HARD_LIMIT = 52428800; // storage bucket file_size_limit (50 MB)
const CATS = ['photo', 'video', 'document', 'audio', 'other'];
const PROGRAM_ICONS = ['leaf', 'trees', 'sprout', 'users', 'heart-pulse', 'building-2', 'globe', 'star', 'folder', 'tag'];
const FIELD_TYPES = () => [['text', tr('Short text', 'Maandishi mafupi')], ['textarea', tr('Long text', 'Maandishi marefu')], ['select', tr('Choice list', 'Orodha ya machaguo')], ['date', tr('Date', 'Tarehe')], ['boolean', tr('Yes / No', 'Ndiyo / Hapana')], ['number', tr('Number', 'Namba')]];
const noPerm = () => tr('You do not have permission to do that.', 'Huna ruhusa ya kufanya hivyo.');

async function fetchAll(make, size = 1000, cap = 20000) {
  let out = [];
  for (let from = 0; from < cap; from += size) {
    const { data, error } = await make().range(from, from + size - 1);
    if (error) throw error;
    out = out.concat(data || []);
    if ((data || []).length < size) break;
  }
  return out;
}

export default async function settings(ctx) {
  const TABS = [
    ['org', tr('Organisation', 'Shirika')], ['programs', tr('Programme areas', 'Maeneo ya programu')], ['tags', tr('Standard tags', 'Lebo za kawaida')],
    ['fields', tr('Custom fields', 'Sehemu maalum')], ['storage', tr('Storage & limits', 'Hifadhi na vikomo')], ['security', tr('Security', 'Usalama')],
  ];
  let tab = TABS.some(([k]) => k === ctx.query.tab) ? ctx.query.tab : 'org';
  const admin = isAdmin();

  mount(ctx.view, html`
    <div class="page-head"><div><h1>${t('nav.settings')}</h1>
      <p>${tr('Organisation details, reference lists and limits used across TerraVault.', 'Taarifa za shirika, orodha za rejea na vikomo vinavyotumika kote TerraVault.')}</p></div></div>
    <div class="tabs" role="tablist" id="tabs">${TABS.map(([k, l]) => html`<button class="tab ${tab === k ? 'on' : ''}" role="tab" aria-selected="${tab === k}" data-tab="${k}">${l}</button>`)}</div>
    <div id="body"></div>`);
  const $q = (s) => ctx.view.querySelector(s);
  const body = $q('#body');
  const adminNote = () => (admin ? '' : html`<p class="hint">${raw(icon('lock', 15))}<span>${tr('Only administrators can change this list. You can view it but saving will be refused.', 'Wasimamizi pekee ndio wanaoweza kubadilisha orodha hii. Unaweza kuiona lakini kuhifadhi kutakataliwa.')}</span></p>`);
  const loading = () => mount(body, html`<div class="view-loading"><div class="spinner" role="status" aria-label="Loading"></div></div>`);
  const failed = (err, retry) => {
    mount(body, emptyState({ icon: 'alert', title: tr('Could not load this section', 'Imeshindwa kupakia sehemu hii'), text: friendlyError(err), action: html`<button class="btn btn-primary" id="retry">${tr('Try again', 'Jaribu tena')}</button>` }));
    $q('#retry').addEventListener('click', retry);
  };
  /** Run a write; returns true on success. Detects RLS silently filtering rows. */
  async function write(promise, okMsg) {
    const { data, error } = await promise;
    if (error) { toast(friendlyError(error), 'error', 6000); return false; }
    if (Array.isArray(data) && !data.length) { toast(noPerm(), 'error'); return false; }
    if (okMsg) toast(okMsg, 'success');
    return true;
  }

  $q('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab; replaceHash(ctx.path, { tab: tab === 'org' ? '' : tab });
    ctx.view.querySelectorAll('.tab').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
    paint();
  });

  // ================================================================ organisation
  async function paintOrg() {
    loading();
    const { data, error } = await sb.from('site_settings').select('key,value,is_public');
    if (error) return failed(error, paintOrg);
    if (!ctx.isCurrent() || tab !== 'org') return;
    const rows = new Map((data || []).map((r) => [r.key, r]));
    const val = (k) => { const v = rows.get(k)?.value; return typeof v === 'string' ? v : v == null ? '' : String(v); };
    const FIELDS = [
      ['org_name', tr('Organisation name', 'Jina la shirika'), 'text'], ['product_name', tr('Platform name', 'Jina la jukwaa'), 'text'],
      ['slogan', tr('Slogan (English)', 'Kauli mbiu (Kiingereza)'), 'text'], ['slogan_sw', tr('Slogan (Kiswahili)', 'Kauli mbiu (Kiswahili)'), 'text'],
      ['contact_email', tr('Contact email', 'Barua pepe ya mawasiliano'), 'email'], ['contact_phone', tr('Contact phone', 'Simu ya mawasiliano'), 'tel'],
      ['contact_address', tr('Address', 'Anwani'), 'text'], ['website', tr('Website', 'Tovuti'), 'url'],
    ];
    mount(body, html`<section class="panel"><header class="panel-head"><h2>${tr('Organisation', 'Shirika')}</h2></header>
      <p class="muted-text">${tr('These details appear on the public library: footer, About and Contact pages.', 'Taarifa hizi huonekana kwenye maktaba ya umma: sehemu ya chini, kurasa za Kuhusu na Wasiliana.')}</p>
      <form id="orgForm" class="form-grid" novalidate>
        ${FIELDS.map(([k, label, type]) => html`<label class="field"><span class="label">${label}</span><input class="input" type="${type}" name="${k}" value="${val(k)}" maxlength="300"></label>`)}
        <p class="field-error" id="orgErr" hidden></p>
        <div class="row end wide"><button class="btn btn-primary" type="submit">${t('common.save')}</button></div>
      </form></section>`);
    const form = $q('#orgForm');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      withBusy(form.querySelector('button[type=submit]'), async () => {
        const err = $q('#orgErr'); err.hidden = true;
        const v = Object.fromEntries(new FormData(form).entries());
        Object.keys(v).forEach((k) => { v[k] = String(v[k]).trim(); });
        if (v.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.contact_email)) { err.textContent = tr('Enter a valid contact email.', 'Weka barua pepe halali ya mawasiliano.'); err.hidden = false; return; }
        if (v.website && !/^https?:\/\//i.test(v.website)) { err.textContent = tr('The website must start with http:// or https://', 'Tovuti lazima ianze na http:// au https://'); err.hidden = false; return; }
        let ok = true;
        for (const [k] of FIELDS) {
          if (v[k] === val(k)) continue;
          const stamp = { updated_at: new Date().toISOString(), updated_by: state.user.id };
          // existing rows keep their is_public flag; new keys are public (they feed the public pages)
          const q = rows.has(k)
            ? sb.from('site_settings').update({ value: v[k], ...stamp }).eq('key', k).select('key')
            : sb.from('site_settings').insert({ key: k, value: v[k], is_public: true, ...stamp }).select('key');
          if (!(await write(q))) { ok = false; break; }
        }
        if (ok) { toast(tr('Settings saved.', 'Mipangilio imehifadhiwa.'), 'success'); await loadPublicRefs(true); paintOrg(); }
      });
    });
  }

  // ================================================================ programme areas
  async function paintPrograms() {
    loading();
    const { data, error } = await sb.from('program_areas').select('*').order('sort_order');
    if (error) return failed(error, paintPrograms);
    if (!ctx.isCurrent() || tab !== 'programs') return;
    const list = data || [];
    mount(body, html`<section class="panel"><header class="panel-head"><h2>${tr('Programme areas', 'Maeneo ya programu')}</h2>
      ${admin ? html`<button class="btn btn-primary btn-sm" id="add">${raw(icon('plus', 16))}${tr('Add programme area', 'Ongeza eneo la programu')}</button>` : ''}</header>
      ${adminNote()}
      ${list.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>${tr('Name', 'Jina')}</th><th>${tr('Kiswahili name', 'Jina la Kiswahili')}</th><th>${tr('Sensitive', 'Nyeti')}</th><th>${tr('Order', 'Mpangilio')}</th><th></th></tr></thead>
        <tbody>${list.map((p) => html`<tr><td><span class="chip chip-soft" style="border-left:4px solid ${p.color}">${raw(icon(p.icon, 14))} ${p.name}</span><small class="muted-text"> ${p.slug}</small></td>
          <td>${p.name_sw || '—'}</td><td>${p.is_sensitive ? tr('Yes', 'Ndiyo') : tr('No', 'Hapana')}</td><td>${p.sort_order}</td>
          <td class="row-actions"><button class="btn btn-ghost btn-sm" data-edit="${p.id}">${raw(icon('edit', 15))}${t('common.edit')}</button>
            <button class="btn btn-ghost btn-sm danger-text" data-del="${p.id}">${t('common.delete')}</button></td></tr>`)}</tbody></table></div>`
        : emptyState({ icon: 'leaf', title: tr('No programme areas yet', 'Hakuna maeneo ya programu bado') })}</section>`);
    $q('#add')?.addEventListener('click', () => programModal(null, list));
    body.onclick = async (e) => {
      const ed = e.target.closest('[data-edit]'); const dl = e.target.closest('[data-del]');
      if (ed) programModal(list.find((x) => x.id === ed.dataset.edit), list);
      if (dl) {
        const p = list.find((x) => x.id === dl.dataset.del);
        const { count } = await sb.from('assets').select('id', { count: 'exact', head: true }).eq('program_id', p.id);
        const ok = await confirmDialog({
          title: tr(`Delete "${p.name}"?`, `Futa "${p.name}"?`),
          message: tr(`${fmtNum(count || 0)} asset(s) are filed under this area; they will keep existing but lose the programme link. This cannot be undone.`, `Mali ${fmtNum(count || 0)} zimewekwa chini ya eneo hili; zitabaki lakini zitapoteza kiungo cha programu. Hili haliwezi kutenduliwa.`),
          confirmText: t('common.delete'), danger: true,
        });
        if (ok && await write(sb.from('program_areas').delete().eq('id', p.id).select('id'), tr('Programme area deleted.', 'Eneo la programu limefutwa.'))) { await loadPublicRefs(true); paintPrograms(); }
      }
    };
  }

  function programModal(p, list) {
    const m = openModal({
      title: p ? tr('Edit programme area', 'Hariri eneo la programu') : tr('Add programme area', 'Ongeza eneo la programu'),
      body: html`<form id="pf" class="form-grid" novalidate>
        <label class="field"><span class="label">${tr('Name (English)', 'Jina (Kiingereza)')} <b class="req">*</b></span><input class="input" name="name" required maxlength="120" value="${p?.name || ''}"></label>
        <label class="field"><span class="label">${tr('Name (Kiswahili)', 'Jina (Kiswahili)')}</span><input class="input" name="name_sw" maxlength="120" value="${p?.name_sw || ''}"></label>
        <label class="field wide"><span class="label">${tr('Description', 'Maelezo')}</span><textarea class="input" name="description" rows="3" maxlength="1000">${p?.description || ''}</textarea></label>
        <label class="field"><span class="label">${tr('Colour', 'Rangi')}</span><input class="input" type="color" name="color" value="${p?.color || '#007C7E'}"></label>
        <label class="field"><span class="label">${tr('Icon', 'Ikoni')}</span><select class="input" name="icon">${options(PROGRAM_ICONS, p?.icon || 'leaf', { value: (x) => x, label: (x) => x })}</select></label>
        <label class="field"><span class="label">${tr('Order', 'Mpangilio')}</span><input class="input" type="number" name="sort_order" value="${p?.sort_order ?? (list.length + 1)}"></label>
        <label class="check"><input type="checkbox" name="is_sensitive" ${p?.is_sensitive ? raw('checked') : ''}><span>${tr('Sensitive content (protected by default)', 'Maudhui nyeti (hulindwa kwa chaguo-msingi)')}</span></label>
        <p class="field-error" id="pfErr" hidden></p></form>`,
      footer: html`<button class="btn btn-ghost" data-close>${t('common.cancel')}</button><button class="btn btn-primary" id="save">${t('common.save')}</button>`,
    });
    m.el.querySelector('#save').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      const form = m.el.querySelector('#pf'); const err = m.el.querySelector('#pfErr');
      const fd = new FormData(form);
      const name = String(fd.get('name')).trim();
      if (!name) { err.textContent = tr('Name is required.', 'Jina linahitajika.'); err.hidden = false; return; }
      const row = {
        name, name_sw: String(fd.get('name_sw')).trim() || null, description: String(fd.get('description')).trim() || null,
        color: fd.get('color'), icon: fd.get('icon'), sort_order: parseInt(fd.get('sort_order'), 10) || 0, is_sensitive: form.elements.is_sensitive.checked,
      };
      const q = p ? sb.from('program_areas').update(row).eq('id', p.id).select('id')
        : sb.from('program_areas').insert({ ...row, slug: slugify(name) || `area-${Date.now().toString(36)}` }).select('id');
      if (await write(q, tr('Saved.', 'Imehifadhiwa.'))) { m.close(); await loadPublicRefs(true); paintPrograms(); }
    }));
  }

  // ================================================================ tags
  async function paintTags() {
    loading();
    let tags; let use = new Map();
    try {
      const [tr1, links] = await Promise.all([sb.from('tags').select('id,name,slug,is_standard').order('name'), fetchAll(() => sb.from('asset_tags').select('tag_id,asset_id').order('asset_id'))]);
      if (tr1.error) throw tr1.error;
      tags = tr1.data || [];
      links.forEach((l) => use.set(l.tag_id, (use.get(l.tag_id) || 0) + 1));
    } catch (err) { return failed(err, paintTags); }
    if (!ctx.isCurrent() || tab !== 'tags') return;
    mount(body, html`<section class="panel"><header class="panel-head"><h2>${tr('Standard tags', 'Lebo za kawaida')}</h2></header>
      <p class="muted-text">${tr('Standard tags are the shared vocabulary everyone picks from. Contributors can only choose standard tags; other tags were created ad hoc.', 'Lebo za kawaida ni msamiati wa pamoja ambao kila mtu huchagua. Wachangiaji wanaweza kuchagua lebo za kawaida tu; zingine ziliundwa kwa muda.')}</p>
      ${adminNote()}
      ${admin ? html`<form class="toolbar" id="tagForm"><input class="input" name="name" placeholder="${tr('New tag name', 'Jina la lebo mpya')}" maxlength="60" required aria-label="${tr('New tag name', 'Jina la lebo mpya')}">
        <label class="check"><input type="checkbox" name="std" checked><span>${tr('Standard', 'Ya kawaida')}</span></label>
        <button class="btn btn-primary" type="submit">${raw(icon('plus', 16))}${t('common.add')}</button></form>` : ''}
      ${tags.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>${tr('Tag', 'Lebo')}</th><th>${tr('Used on', 'Imetumika kwenye')}</th><th>${tr('Standard', 'Ya kawaida')}</th><th></th></tr></thead>
        <tbody>${tags.map((x) => html`<tr><td><b>${x.name}</b></td><td>${fmtNum(use.get(x.id) || 0)} ${tr('assets', 'mali')}</td>
          <td><label class="check"><input type="checkbox" data-std="${x.id}" ${x.is_standard ? raw('checked') : ''} ${admin ? '' : raw('disabled')}><span class="sr-only">${tr('Standard', 'Ya kawaida')}</span></label></td>
          <td class="row-actions">${admin ? html`<button class="btn btn-ghost btn-sm" data-ren="${x.id}">${raw(icon('edit', 15))}${tr('Rename', 'Badili jina')}</button>
            <button class="btn btn-ghost btn-sm danger-text" data-del="${x.id}">${t('common.delete')}</button>` : ''}</td></tr>`)}</tbody></table></div>`
        : emptyState({ icon: 'tag', title: tr('No tags yet', 'Hakuna lebo bado') })}</section>`);
    const done = async () => { invalidateRef('tags'); paintTags(); };
    $q('#tagForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target; const name = f.elements.name.value.trim();
      if (!name) return;
      if (tags.some((x) => x.name.toLowerCase() === name.toLowerCase())) { toast(tr('That tag already exists.', 'Lebo hiyo tayari ipo.'), 'error'); return; }
      withBusy(f.querySelector('button'), async () => {
        if (await write(sb.from('tags').insert({ name, slug: slugify(name) || `tag-${Date.now().toString(36)}`, is_standard: f.elements.std.checked }).select('id'), tr('Tag added.', 'Lebo imeongezwa.'))) await done();
      });
    });
    body.onchange = async (e) => {
      const c = e.target.closest('[data-std]');
      if (c && await write(sb.from('tags').update({ is_standard: c.checked }).eq('id', c.dataset.std).select('id'), tr('Updated.', 'Imesasishwa.'))) await done(); else if (c) paintTags();
    };
    body.onclick = async (e) => {
      const rn = e.target.closest('[data-ren]'); const dl = e.target.closest('[data-del]');
      if (rn) {
        const x = tags.find((y) => y.id === rn.dataset.ren);
        const m = openModal({
          title: tr('Rename tag', 'Badili jina la lebo'), size: 'sm',
          body: html`<label class="field"><span class="label">${tr('Tag name', 'Jina la lebo')}</span><input class="input" id="nn" maxlength="60" value="${x.name}"></label><p class="field-error" id="nnErr" hidden></p>`,
          footer: html`<button class="btn btn-ghost" data-close>${t('common.cancel')}</button><button class="btn btn-primary" id="ok">${t('common.save')}</button>`,
        });
        m.el.querySelector('#ok').addEventListener('click', (ev) => withBusy(ev.currentTarget, async () => {
          const name = m.el.querySelector('#nn').value.trim();
          if (!name) return;
          if (tags.some((y) => y.id !== x.id && y.name.toLowerCase() === name.toLowerCase())) { const er = m.el.querySelector('#nnErr'); er.textContent = tr('That tag already exists.', 'Lebo hiyo tayari ipo.'); er.hidden = false; return; }
          if (await write(sb.from('tags').update({ name }).eq('id', x.id).select('id'), tr('Tag renamed.', 'Jina la lebo limebadilishwa.'))) { m.close(); await done(); }
        }));
      }
      if (dl) {
        const x = tags.find((y) => y.id === dl.dataset.del);
        const ok = await confirmDialog({
          title: tr(`Delete the tag "${x.name}"?`, `Futa lebo "${x.name}"?`),
          message: tr(`It will be removed from ${fmtNum(use.get(x.id) || 0)} asset(s). This cannot be undone.`, `Itaondolewa kutoka mali ${fmtNum(use.get(x.id) || 0)}. Hili haliwezi kutenduliwa.`),
          confirmText: t('common.delete'), danger: true,
        });
        if (ok && await write(sb.from('tags').delete().eq('id', x.id).select('id'), tr('Tag deleted.', 'Lebo imefutwa.'))) await done();
      }
    };
  }

  // ================================================================ metadata fields
  async function paintFields() {
    loading();
    const { data, error } = await sb.from('metadata_fields').select('*').order('sort_order');
    if (error) return failed(error, paintFields);
    if (!ctx.isCurrent() || tab !== 'fields') return;
    const list = data || [];
    const typeLabel = (k) => FIELD_TYPES().find(([x]) => x === k)?.[1] || k;
    mount(body, html`<section class="panel"><header class="panel-head"><h2>${tr('Custom metadata fields', 'Sehemu maalum za taarifa')}</h2>
      ${admin ? html`<button class="btn btn-primary btn-sm" id="add">${raw(icon('plus', 16))}${tr('Add field', 'Ongeza sehemu')}</button>` : ''}</header>
      <p class="muted-text">${tr('Extra questions shown when describing an asset. Turn a field off instead of deleting it to keep the answers already recorded.', 'Maswali ya ziada yanayoonyeshwa wakati wa kuelezea mali. Zima sehemu badala ya kuifuta ili kuhifadhi majibu yaliyokwisha rekodiwa.')}</p>
      ${adminNote()}
      ${list.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>${tr('Label', 'Jina')}</th><th>${tr('Key', 'Ufunguo')}</th><th>${tr('Type', 'Aina')}</th><th>${tr('Required', 'Lazima')}</th><th>${tr('Status', 'Hali')}</th><th></th></tr></thead>
        <tbody>${list.map((x) => html`<tr><td><b>${x.label}</b>${x.label_sw ? html`<small class="muted-text"> · ${x.label_sw}</small>` : ''}</td><td><code>${x.key}</code></td><td>${typeLabel(x.field_type)}</td>
          <td>${x.is_required ? tr('Yes', 'Ndiyo') : tr('No', 'Hapana')}</td><td>${x.is_active ? html`<span class="badge st-approved">${tr('On', 'Imewashwa')}</span>` : html`<span class="badge st-archived">${tr('Off', 'Imezimwa')}</span>`}</td>
          <td class="row-actions">${admin ? html`<button class="btn btn-ghost btn-sm" data-edit="${x.id}">${raw(icon('edit', 15))}${t('common.edit')}</button>
            <button class="btn btn-ghost btn-sm danger-text" data-del="${x.id}">${t('common.delete')}</button>` : ''}</td></tr>`)}</tbody></table></div>`
        : emptyState({ icon: 'list', title: tr('No custom fields yet', 'Hakuna sehemu maalum bado') })}</section>`);
    $q('#add')?.addEventListener('click', () => fieldModal(null, list));
    body.onclick = async (e) => {
      const ed = e.target.closest('[data-edit]'); const dl = e.target.closest('[data-del]');
      if (ed) fieldModal(list.find((x) => x.id === ed.dataset.edit), list);
      if (dl) {
        const x = list.find((y) => y.id === dl.dataset.del);
        const ok = await confirmDialog({
          title: tr(`Delete the field "${x.label}"?`, `Futa sehemu "${x.label}"?`),
          message: tr('The field disappears from forms. Answers already saved on assets stay in the database but will no longer be shown. Consider turning it off instead.', 'Sehemu itatoweka kwenye fomu. Majibu yaliyohifadhiwa kwenye mali yatabaki kwenye hifadhidata lakini hayataonyeshwa tena. Fikiria kuizima badala yake.'),
          confirmText: t('common.delete'), danger: true,
        });
        if (ok && await write(sb.from('metadata_fields').delete().eq('id', x.id).select('id'), tr('Field deleted.', 'Sehemu imefutwa.'))) { invalidateRef('fields'); paintFields(); }
      }
    };
  }

  function fieldModal(x, list) {
    const m = openModal({
      title: x ? tr('Edit field', 'Hariri sehemu') : tr('Add field', 'Ongeza sehemu'),
      body: html`<form id="ff" class="form-grid" novalidate>
        <label class="field"><span class="label">${tr('Label (English)', 'Jina (Kiingereza)')} <b class="req">*</b></span><input class="input" name="label" required maxlength="120" value="${x?.label || ''}"></label>
        <label class="field"><span class="label">${tr('Label (Kiswahili)', 'Jina (Kiswahili)')}</span><input class="input" name="label_sw" maxlength="120" value="${x?.label_sw || ''}"></label>
        <label class="field"><span class="label">${tr('Key', 'Ufunguo')}</span><input class="input" name="key" maxlength="40" pattern="[a-z][a-z0-9_]*" value="${x?.key || ''}" ${x ? raw('readonly') : ''} placeholder="event_name">
          <small class="hint-text">${x ? tr('The key cannot change once created.', 'Ufunguo hauwezi kubadilishwa baada ya kuundwa.') : tr('Lowercase letters, numbers and underscores. Leave blank to generate from the label.', 'Herufi ndogo, namba na mstari-chini. Acha wazi ili uundwe kutoka kwenye jina.')}</small></label>
        <label class="field"><span class="label">${tr('Type', 'Aina')}</span><select class="input" name="field_type">${options(FIELD_TYPES(), x?.field_type || 'text', { value: (o) => o[0], label: (o) => o[1] })}</select></label>
        <label class="field wide" id="optWrap"><span class="label">${tr('Choices (one per line)', 'Machaguo (moja kwa kila mstari)')}</span><textarea class="input" name="options" rows="4">${(Array.isArray(x?.options) ? x.options : []).join('\n')}</textarea></label>
        <label class="field"><span class="label">${tr('Order', 'Mpangilio')}</span><input class="input" type="number" name="sort_order" value="${x?.sort_order ?? list.length + 1}"></label>
        <label class="check"><input type="checkbox" name="is_required" ${x?.is_required ? raw('checked') : ''}><span>${tr('Required', 'Lazima')}</span></label>
        <label class="check"><input type="checkbox" name="is_active" ${x ? (x.is_active ? raw('checked') : '') : raw('checked')}><span>${tr('Shown on forms', 'Inaonyeshwa kwenye fomu')}</span></label>
        <p class="field-error" id="ffErr" hidden></p></form>`,
      footer: html`<button class="btn btn-ghost" data-close>${t('common.cancel')}</button><button class="btn btn-primary" id="save">${t('common.save')}</button>`,
    });
    const form = m.el.querySelector('#ff');
    const sync = () => { m.el.querySelector('#optWrap').hidden = form.elements.field_type.value !== 'select'; };
    form.elements.field_type.addEventListener('change', sync); sync();
    m.el.querySelector('#save').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      const err = m.el.querySelector('#ffErr'); const fd = new FormData(form);
      const label = String(fd.get('label')).trim();
      const key = x ? x.key : (String(fd.get('key')).trim() || slugify(label).replace(/-/g, '_'));
      const fail = (s) => { err.textContent = s; err.hidden = false; };
      if (!label) return fail(tr('Label is required.', 'Jina linahitajika.'));
      if (!/^[a-z][a-z0-9_]*$/.test(key)) return fail(tr('The key must start with a letter and use only lowercase letters, numbers and underscores.', 'Ufunguo lazima uanze na herufi na utumie herufi ndogo, namba na mstari-chini tu.'));
      if (!x && list.some((y) => y.key === key)) return fail(tr('A field with this key already exists.', 'Sehemu yenye ufunguo huu tayari ipo.'));
      const type = fd.get('field_type');
      const opts = type === 'select' ? String(fd.get('options')).split('\n').map((s) => s.trim()).filter(Boolean) : [];
      if (type === 'select' && !opts.length) return fail(tr('Add at least one choice.', 'Ongeza angalau chaguo moja.'));
      const row = { label, label_sw: String(fd.get('label_sw')).trim() || null, field_type: type, options: opts, sort_order: parseInt(fd.get('sort_order'), 10) || 0, is_required: form.elements.is_required.checked, is_active: form.elements.is_active.checked };
      const q = x ? sb.from('metadata_fields').update(row).eq('id', x.id).select('id') : sb.from('metadata_fields').insert({ ...row, key }).select('id');
      if (await write(q, tr('Saved.', 'Imehifadhiwa.'))) { m.close(); invalidateRef('fields'); paintFields(); }
    }));
  }

  // ================================================================ storage & limits
  async function paintStorage() {
    loading();
    let assets; let st; let quotaRow; let maxRow;
    try {
      const [a, s, set] = await Promise.all([
        fetchAll(() => sb.from('assets').select('id,category,file_size,deleted_at').order('id')),
        sb.rpc('dashboard_stats'),
        sb.from('site_settings').select('key,value').in('key', ['storage_quota_bytes', 'max_upload_bytes']),
      ]);
      if (s.error) throw s.error;
      if (set.error) throw set.error;
      assets = a; st = s.data || {};
      quotaRow = (set.data || []).find((r) => r.key === 'storage_quota_bytes'); maxRow = (set.data || []).find((r) => r.key === 'max_upload_bytes');
    } catch (err) { return failed(err, paintStorage); }
    if (!ctx.isCurrent() || tab !== 'storage') return;
    const live = assets.filter((a) => !a.deleted_at);
    const liveBytes = live.reduce((s, a) => s + Number(a.file_size || 0), 0);
    const trashBytes = assets.filter((a) => a.deleted_at).reduce((s, a) => s + Number(a.file_size || 0), 0);
    const versionBytes = Number(st.storage_used || 0);
    const quota = Number(quotaRow?.value || 0);
    const maxUp = Math.min(Number(maxRow?.value || HARD_LIMIT), HARD_LIMIT);
    const used = Math.max(versionBytes, liveBytes + trashBytes);
    const pct = quota ? Math.min(100, Math.round((used / quota) * 100)) : 0;
    const byCat = CATS.map((c) => ({ c, bytes: live.filter((a) => a.category === c).reduce((s, a) => s + Number(a.file_size || 0), 0), n: live.filter((a) => a.category === c).length }));
    const maxCat = Math.max(1, ...byCat.map((x) => x.bytes));
    mount(body, html`<div class="grid-2">
      <section class="panel"><header class="panel-head"><h2>${tr('Storage used', 'Hifadhi iliyotumika')}</h2></header>
        <div class="storage"><div class="storage-top"><b>${fmtBytes(used)}</b><span>${quota ? tr(`of ${fmtBytes(quota)}`, `kati ya ${fmtBytes(quota)}`) : ''}</span></div>
          <div class="meter ${pct > 90 ? 'hot' : pct > 75 ? 'warm' : ''}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
          <p class="muted-text">${quota ? tr(`${pct}% used · ${fmtBytes(Math.max(0, quota - used))} available`, `${pct}% imetumika · ${fmtBytes(Math.max(0, quota - used))} zinapatikana`) : tr('No storage limit set.', 'Hakuna kikomo cha hifadhi.')}</p></div>
        <dl class="kv"><div><dt>${tr('Current files', 'Faili za sasa')}</dt><dd>${fmtBytes(liveBytes)} · ${fmtNum(live.length)} ${tr('assets', 'mali')}</dd></div>
          <div><dt>${tr('In trash', 'Kwenye taka')}</dt><dd>${fmtBytes(trashBytes)}</dd></div>
          <div><dt>${tr('Including old versions', 'Pamoja na matoleo ya zamani')}</dt><dd>${fmtBytes(versionBytes)}</dd></div></dl>
        <h3 class="mini-h">${tr('By category', 'Kwa kundi')}</h3>
        <ul class="hbars">${byCat.map((x) => html`<li><span class="hb-label">${t('cat.' + x.c)}</span><span class="hb-track"><span class="hb-fill" style="width:${x.bytes ? Math.max(3, (x.bytes / maxCat) * 100) : 0}%;background:${CAT_COLOR[x.c]}"></span></span><b>${fmtBytes(x.bytes)}</b></li>`)}</ul>
      </section>
      <section class="panel"><header class="panel-head"><h2>${tr('Limits', 'Vikomo')}</h2></header>
        ${adminNote()}
        <form id="limForm" novalidate>
          <label class="field"><span class="label">${tr('Storage quota (GB)', 'Kikomo cha hifadhi (GB)')}</span><input class="input" type="number" name="quota" min="0" step="0.1" value="${quota ? +(quota / 1073741824).toFixed(2) : ''}" placeholder="0 = ${tr('no limit', 'bila kikomo')}"></label>
          <label class="field"><span class="label">${tr('Largest single upload (MB)', 'Ukubwa wa juu wa faili moja (MB)')}</span><input class="input" type="number" name="maxup" min="1" max="${HARD_LIMIT / 1048576}" step="1" value="${Math.round(maxUp / 1048576)}">
            <small class="hint-text">${tr(`The storage service itself caps files at ${HARD_LIMIT / 1048576} MB, so higher values have no effect.`, `Huduma ya hifadhi yenyewe inaweka kikomo cha MB ${HARD_LIMIT / 1048576} kwa faili, kwa hivyo thamani kubwa zaidi haina athari.`)}</small></label>
          <p class="field-error" id="limErr" hidden></p>
          <div class="row end"><button class="btn btn-primary" type="submit">${t('common.save')}</button></div></form>
      </section></div>`);
    const form = $q('#limForm');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      withBusy(form.querySelector('button[type=submit]'), async () => {
        const err = $q('#limErr'); err.hidden = true;
        const gb = parseFloat(form.elements.quota.value || '0'); const mb = parseInt(form.elements.maxup.value, 10);
        if (!(gb >= 0) || !(mb >= 1) || mb > HARD_LIMIT / 1048576) { err.textContent = tr(`Enter a quota of 0 or more and an upload limit between 1 and ${HARD_LIMIT / 1048576} MB.`, `Weka kikomo cha 0 au zaidi na kikomo cha upakiaji kati ya MB 1 na ${HARD_LIMIT / 1048576}.`); err.hidden = false; return; }
        const stamp = { updated_at: new Date().toISOString(), updated_by: state.user.id };
        const vals = { storage_quota_bytes: Math.round(gb * 1073741824), max_upload_bytes: mb * 1048576 };
        for (const [k, v] of Object.entries(vals)) {
          const exists = k === 'storage_quota_bytes' ? quotaRow : maxRow;
          const q = exists ? sb.from('site_settings').update({ value: v, ...stamp }).eq('key', k).select('key') : sb.from('site_settings').insert({ key: k, value: v, is_public: false, ...stamp }).select('key');
          if (!(await write(q))) return;
        }
        toast(tr('Limits saved.', 'Vikomo vimehifadhiwa.'), 'success');
        await loadPublicRefs(true); paintStorage();
      });
    });
  }

  // ================================================================ security notes
  function paintSecurity() {
    const notes = [
      ['shield', tr('Turn on two-step sign-in (MFA) for administrators', 'Washa uthibitisho wa hatua mbili (MFA) kwa wasimamizi'),
        tr('Administrators can see and publish everything. Ask every Super Administrator and Organization Administrator to protect their account with a second step, such as an authenticator app. Two-step sign-in is configured on the Supabase project and is not yet switchable from this page.', 'Wasimamizi wanaweza kuona na kuchapisha kila kitu. Waombe Wasimamizi Wakuu na Wasimamizi wa Shirika wote walinde akaunti zao kwa hatua ya pili, kama programu ya uthibitisho. MFA huwekwa kwenye mradi wa Supabase na bado haiwezi kuwashwa kutoka ukurasa huu.')],
      ['key', tr('Use strong, unique passwords', 'Tumia nenosiri imara na la kipekee'), tr('At least 8 characters is required; longer passphrases are better. Never share an account between colleagues.', 'Angalau herufi 8 zinahitajika; nenosiri refu ni bora zaidi. Usishiriki akaunti kati ya wenzako.')],
      ['users', tr('Give the least access needed', 'Toa ufikiaji unaohitajika tu'), tr('Invite people as Contributors or Viewers by default, and keep the number of administrators small. Review the Roles & permissions table under User Management.', 'Alika watu kama Wachangiaji au Watazamaji kwa chaguo-msingi, na punguza idadi ya wasimamizi. Pitia jedwali la Wadhifa na ruhusa chini ya Watumiaji.')],
      ['lock', tr('Suspend leavers promptly', 'Simamisha walioondoka haraka'), tr('When someone leaves Terraviva, suspend their account the same day. Their files and history are kept.', 'Mtu anapoondoka Terraviva, simamisha akaunti yake siku hiyo hiyo. Mafaili na historia yake hubaki.')],
      ['globe', tr('Only publish what is safe to show anyone', 'Chapisha tu kilicho salama kuonyeshwa kwa yeyote'), tr('Only files classified as Public can be published, and every file must be approved first. Check consent for photographs of people and keep sensitive programme material internal.', 'Mafaili yaliyoainishwa kama ya Umma pekee ndiyo yanaweza kuchapishwa, na kila faili lazima liidhinishwe kwanza. Hakikisha ridhaa kwa picha za watu na weka nyenzo nyeti za programu ndani ya shirika.')],
      ['history', tr('Review the activity log', 'Pitia kumbukumbu za shughuli'), tr('Open Reports & Analytics regularly to look for unusual downloads, shares or role changes.', 'Fungua Ripoti na Takwimu mara kwa mara kutafuta upakuaji, ushiriki au mabadiliko ya wadhifa yasiyo ya kawaida.')],
    ];
    mount(body, html`<section class="panel"><header class="panel-head"><h2>${tr('Security notes', 'Maelezo ya usalama')}</h2></header>
      <ul class="plain-list">${notes.map(([ic, title, text]) => html`<li class="note-box"><b>${raw(icon(ic, 17))} ${title}</b><p class="muted-text">${text}</p></li>`)}</ul></section>`);
  }

  function paint() {
    body.onclick = null; body.onchange = null;
    ({ org: paintOrg, programs: paintPrograms, tags: paintTags, fields: paintFields, storage: paintStorage, security: paintSecurity })[tab]();
  }
  paint();
}
