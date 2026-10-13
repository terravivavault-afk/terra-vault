// User Management: people, invitations, and the read-only roles x permissions matrix.
import { sb } from '../lib/supabase.js';
import { state, myRole } from '../lib/state.js';
import { html, raw, mount, fmtDate, fmtDateTime, timeAgo, copyText, replaceHash } from '../lib/util.js';
import { t, tr } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { emptyState, openModal, confirmDialog, toast, withBusy, options, avatar } from '../lib/ui.js';
import { friendlyError } from '../lib/api.js';

export const ROLES = ['super_admin', 'org_admin', 'executive', 'project_manager', 'contributor', 'viewer', 'external'];

export const PERMS = () => [
  ['view', tr('View assets', 'Kutazama mali'), tr('See assets they are allowed to access.', 'Kuona mali wanazoruhusiwa kufikia.')],
  ['upload', tr('Upload files', 'Kupakia mafaili'), tr('Add new files to the library.', 'Kuongeza mafaili mapya kwenye maktaba.')],
  ['edit_metadata', tr('Edit details and tags', 'Kuhariri maelezo na lebo'), tr('Change titles, descriptions, tags and other details of their own or managed assets.', 'Kubadilisha vichwa, maelezo, lebo na taarifa nyingine za mali zao au wanazosimamia.')],
  ['replace_files', tr('Replace files', 'Kubadilisha mafaili'), tr('Upload a new version of an existing file.', 'Kupakia toleo jipya la faili lililopo.')],
  ['download', tr('Download', 'Kupakua'), tr('Download original files.', 'Kupakua mafaili halisi.')],
  ['delete', tr('Move to trash', 'Kuhamisha kwenye taka'), tr('Move assets to the trash.', 'Kuhamisha mali kwenye taka.')],
  ['restore', tr('Restore', 'Kurejesha'), tr('Restore assets from trash or archive.', 'Kurejesha mali kutoka kwenye taka au kumbukumbu.')],
  ['share', tr('Share', 'Kushiriki'), tr('Create share links and invitations.', 'Kuunda viungo vya kushiriki na mialiko.')],
  ['approve', tr('Review and approve', 'Kukagua na kuidhinisha'), tr('Approve assets or request changes.', 'Kuidhinisha mali au kuomba marekebisho.')],
  ['publish', tr('Publish', 'Kuchapisha'), tr('Publish approved assets to the public library.', 'Kuchapisha mali zilizoidhinishwa kwenye maktaba ya umma.')],
  ['manage_projects', tr('Manage projects', 'Kusimamia miradi'), tr('Create and edit projects and their members.', 'Kuunda na kuhariri miradi na wanachama wake.')],
  ['manage_users', tr('Manage users', 'Kusimamia watumiaji'), tr('Invite people, change roles, suspend accounts.', 'Kualika watu, kubadilisha wadhifa, kusimamisha akaunti.')],
  ['export_reports', tr('Export reports', 'Kusafirisha ripoti'), tr('Open Reports and export data.', 'Kufungua Ripoti na kusafirisha data.')],
  ['view_logs', tr('View activity log', 'Kuona kumbukumbu za shughuli'), tr('See what everyone has done in the system.', 'Kuona kila mtu amefanya nini kwenye mfumo.')],
  ['manage_settings', tr('Manage settings', 'Kusimamia mipangilio'), tr('Change organisation settings and reference lists.', 'Kubadilisha mipangilio ya shirika na orodha za rejea.')],
];

const signupLink = () => `${location.origin}${location.pathname}#/signup`;
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

const statusBadge = (s) => (s === 'suspended'
  ? html`<span class="badge st-rejected">${tr('Suspended', 'Imesimamishwa')}</span>`
  : html`<span class="badge st-approved">${tr('Active', 'Hai')}</span>`);

export default async function users(ctx) {
  const me = state.user.id;
  const f = { q: '', role: ctx.query.role || '', status: ctx.query.status || '' };
  let tab = ['people', 'invites', 'roles'].includes(ctx.query.tab) ? ctx.query.tab : 'people';
  let profiles = []; let invites = []; let perms = []; let lastAct = new Map();

  mount(ctx.view, html`
    <div class="page-head">
      <div><h1>${t('nav.users')}</h1>
        <p>${tr('Invite colleagues, set what each person can do and pause access when someone leaves.', 'Alika wenzako, weka kila mtu anaweza kufanya nini na sitisha ufikiaji mtu anapoondoka.')}</p></div>
      <div class="page-actions"><button class="btn btn-primary" id="invite">${raw(icon('mail', 18))}${tr('Invite person', 'Alika mtu')}</button></div>
    </div>
    <div class="tabs" role="tablist" id="tabs"></div>
    <div id="body"><div class="view-loading"><div class="spinner" role="status" aria-label="Loading"></div></div></div>`);
  const $q = (s) => ctx.view.querySelector(s);
  const body = $q('#body');

  async function loadData() {
    const [p, i, rp] = await Promise.all([
      sb.from('profiles').select('id,email,full_name,role,status,last_seen_at,created_at,job_title,organization').order('full_name', { nullsFirst: false }),
      sb.from('invitations').select('id,email,role,note,created_at,invited_by,inviter:profiles!invited_by(full_name)').is('accepted_at', null).order('created_at', { ascending: false }),
      sb.from('role_permissions').select('role,permission'),
    ]);
    const err = p.error || i.error || rp.error;
    if (err) throw err;
    profiles = p.data || []; invites = i.data || []; perms = rp.data || [];

    // Last activity: newest audit-log entry per person (needs "view logs"), else last_seen_at.
    lastAct = new Map();
    const logs = await sb.from('activity_logs').select('actor_id,created_at').not('actor_id', 'is', null).order('created_at', { ascending: false }).limit(1000);
    (logs.data || []).forEach((l) => { if (!lastAct.has(l.actor_id)) lastAct.set(l.actor_id, l.created_at); });
  }

  const activeSupers = () => profiles.filter((p) => p.role === 'super_admin' && p.status === 'active').length;
  const lastOf = (p) => {
    const a = lastAct.get(p.id); const b = p.last_seen_at;
    return a && b ? (new Date(a) > new Date(b) ? a : b) : a || b || null;
  };
  /** Why this person's role/status cannot be changed by me ('' when allowed). */
  function guard(p) {
    if (p.id === me) return tr('You cannot change your own role or status.', 'Huwezi kubadilisha wadhifa au hali ya akaunti yako mwenyewe.');
    if (p.role === 'super_admin' && myRole() !== 'super_admin') return tr('Only a Super Administrator can manage Super Administrators.', 'Ni Msimamizi Mkuu pekee anayeweza kusimamia Wasimamizi Wakuu.');
    if (p.role === 'super_admin' && p.status === 'active' && activeSupers() <= 1) return tr('This is the only active Super Administrator.', 'Huyu ndiye Msimamizi Mkuu pekee aliye hai.');
    return '';
  }
  const assignable = () => ROLES.filter((r) => r !== 'super_admin' || myRole() === 'super_admin');

  // ------------------------------------------------------------ tabs
  function paintTabs() {
    const items = [['people', tr('People', 'Watu'), profiles.length], ['invites', tr('Invitations', 'Mialiko'), invites.length], ['roles', tr('Roles & permissions', 'Wadhifa na ruhusa'), null]];
    mount($q('#tabs'), html`${items.map(([k, label, n]) => html`<button class="tab ${tab === k ? 'on' : ''}" role="tab" aria-selected="${tab === k}" data-tab="${k}">${label}${n != null ? html` <em class="count-pill">${n}</em>` : ''}</button>`)}`);
  }
  $q('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab; replaceHash(ctx.path, { tab: tab === 'people' ? '' : tab }); paint();
  });

  // ------------------------------------------------------------ people
  const filtered = () => {
    const q = f.q.toLowerCase();
    return profiles.filter((p) => (!f.role || p.role === f.role) && (!f.status || p.status === f.status)
      && (!q || [p.full_name, p.email, p.organization, p.job_title].some((x) => (x || '').toLowerCase().includes(q))));
  };

  function paintPeopleRows() {
    const list = filtered();
    const host = $q('#prows');
    if (!list.length) {
      mount(host, emptyState({ icon: 'users', title: tr('No one matches', 'Hakuna anayelingana'), text: tr('Try a different search or filter.', 'Jaribu utafutaji au kichujio kingine.') }));
      return;
    }
    mount(host, html`<div class="table-wrap"><table class="table user-table"><thead><tr>
      <th>${tr('Person', 'Mtu')}</th><th>${tr('Role', 'Wadhifa')}</th><th>${tr('Status', 'Hali')}</th><th>${tr('Last activity', 'Shughuli ya mwisho')}</th><th>${tr('Joined', 'Alijiunga')}</th><th><span class="sr-only">${tr('Actions', 'Vitendo')}</span></th></tr></thead>
      <tbody>${list.map((p) => {
        const why = guard(p);
        const last = lastOf(p);
        return html`<tr data-id="${p.id}">
          <td><span class="cell-user">${avatar(p.full_name || p.email)}<span><b>${p.full_name || p.email}${p.id === me ? html` <small class="muted-text">(${tr('you', 'wewe')})</small>` : ''}</b><small>${p.email}${p.job_title ? ' · ' + p.job_title : ''}</small></span></span></td>
          <td>${t('role.' + p.role)}</td>
          <td>${statusBadge(p.status)}</td>
          <td>${last ? html`<span title="${fmtDateTime(last)}">${timeAgo(last)}</span>` : html`<span class="muted-text">${tr('Never', 'Haijawahi')}</span>`}</td>
          <td>${fmtDate(p.created_at)}</td>
          <td class="row-actions">
            <button class="btn btn-ghost btn-sm" data-act="role" data-id="${p.id}" ${why ? raw(`disabled title="${why.replace(/"/g, '&quot;')}"`) : ''}>${raw(icon('key', 15))}${tr('Change role', 'Badili wadhifa')}</button>
            ${p.status === 'active'
              ? html`<button class="btn btn-ghost btn-sm danger-text" data-act="suspend" data-id="${p.id}" ${why ? raw(`disabled title="${why.replace(/"/g, '&quot;')}"`) : ''}>${tr('Suspend', 'Simamisha')}</button>`
              : html`<button class="btn btn-ghost btn-sm" data-act="reactivate" data-id="${p.id}" ${why ? raw(`disabled title="${why.replace(/"/g, '&quot;')}"`) : ''}>${tr('Reactivate', 'Washa tena')}</button>`}
          </td></tr>`;
      })}</tbody></table></div>`);
  }

  function paintPeople() {
    mount(body, html`
      <div class="toolbar">
        <label class="search-field">${raw(icon('search', 18))}
          <input type="search" id="q" value="${f.q}" placeholder="${tr('Search by name, email, organisation…', 'Tafuta kwa jina, barua pepe, shirika…')}" aria-label="${t('common.search')}"></label>
        <select class="input" id="frole" aria-label="${tr('Role', 'Wadhifa')}">${options(ROLES, f.role, { value: (x) => x, label: (x) => t('role.' + x), blank: tr('All roles', 'Wadhifa wote') })}</select>
        <select class="input" id="fstatus" aria-label="${tr('Status', 'Hali')}">${options(['active', 'suspended'], f.status, { value: (x) => x, label: (x) => (x === 'active' ? tr('Active', 'Hai') : tr('Suspended', 'Imesimamishwa')), blank: tr('Any status', 'Hali yoyote') })}</select>
      </div>
      <div id="prows"></div>`);
    $q('#q').addEventListener('input', (e) => { f.q = e.target.value.trim(); paintPeopleRows(); });
    $q('#frole').addEventListener('change', (e) => { f.role = e.target.value; paintPeopleRows(); });
    $q('#fstatus').addEventListener('change', (e) => { f.status = e.target.value; paintPeopleRows(); });
    $q('#prows').addEventListener('click', onPeopleAction);
    paintPeopleRows();
  }

  async function updateProfile(p, patch, okMsg) {
    const { data, error } = await sb.from('profiles').update(patch).eq('id', p.id).select('id');
    if (error) { toast(friendlyError(error), 'error', 6000); return false; }
    if (!data?.length) { toast(tr('You do not have permission to do that.', 'Huna ruhusa ya kufanya hivyo.'), 'error'); return false; }
    toast(okMsg, 'success');
    await reload();
    return true;
  }

  async function onPeopleAction(e) {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const p = profiles.find((x) => x.id === b.dataset.id);
    if (!p) return;
    const why = guard(p);
    if (why) { toast(why, 'error'); return; }
    const name = p.full_name || p.email;
    if (b.dataset.act === 'suspend') {
      const ok = await confirmDialog({
        title: tr(`Suspend ${name}?`, `Simamisha ${name}?`),
        message: tr('They will lose access to the workspace straight away. Their files stay in the library. You can reactivate them at any time.', 'Watapoteza ufikiaji wa nafasi ya kazi mara moja. Mafaili yao yanabaki kwenye maktaba. Unaweza kuwawasha tena wakati wowote.'),
        confirmText: tr('Suspend', 'Simamisha'), danger: true,
      });
      if (ok) await updateProfile(p, { status: 'suspended' }, tr('Account suspended.', 'Akaunti imesimamishwa.'));
    } else if (b.dataset.act === 'reactivate') {
      const ok = await confirmDialog({
        title: tr(`Reactivate ${name}?`, `Washa tena ${name}?`),
        message: tr(`They will regain access with the role "${t('role.' + p.role)}".`, `Watapata tena ufikiaji kwa wadhifa wa "${t('role.' + p.role)}".`),
        confirmText: tr('Reactivate', 'Washa tena'),
      });
      if (ok) await updateProfile(p, { status: 'active' }, tr('Account reactivated.', 'Akaunti imewashwa tena.'));
    } else if (b.dataset.act === 'role') openRoleModal(p);
  }

  function openRoleModal(p) {
    const name = p.full_name || p.email;
    const m = openModal({
      title: tr('Change role', 'Badili wadhifa') + ' · ' + name, size: 'sm',
      body: html`<label class="field"><span class="label">${tr('Role', 'Wadhifa')}</span>
          <select class="input" id="newRole">${options(assignable(), p.role, { value: (x) => x, label: (x) => t('role.' + x) })}</select></label>
        <p class="muted-text" id="roleHelp"></p>`,
      footer: html`<button class="btn btn-ghost" data-close>${t('common.cancel')}</button><button class="btn btn-primary" id="saveRole">${t('common.save')}</button>`,
    });
    const sel = m.el.querySelector('#newRole');
    const help = m.el.querySelector('#roleHelp');
    const paintHelp = () => {
      const have = perms.filter((x) => x.role === sel.value).map((x) => x.permission);
      const labels = PERMS().filter(([k]) => have.includes(k)).map(([, l]) => l);
      help.textContent = labels.length ? `${tr('Can', 'Anaweza')}: ${labels.join(', ')}.` : '';
    };
    sel.addEventListener('change', paintHelp); paintHelp();
    m.el.querySelector('#saveRole').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      if (sel.value === p.role) { m.close(); return; }
      if (await updateProfile(p, { role: sel.value }, tr('Role updated.', 'Wadhifa umebadilishwa.'))) m.close();
    }));
  }

  // ------------------------------------------------------------ invitations
  function paintInvites() {
    if (!invites.length) {
      mount(body, emptyState({
        icon: 'mail', title: tr('No pending invitations', 'Hakuna mialiko inayosubiri'),
        text: tr('Invite a colleague by email. They join by creating an account with that same address.', 'Alika mwenzako kwa barua pepe. Anajiunga kwa kufungua akaunti kwa barua pepe hiyo hiyo.'),
        action: html`<button class="btn btn-primary" id="inv2">${raw(icon('mail', 18))}${tr('Invite person', 'Alika mtu')}</button>`,
      }));
      $q('#inv2').addEventListener('click', openInvite);
      return;
    }
    mount(body, html`
      <p class="hint">${raw(icon('info', 15))}<span>${tr('TerraVault does not send the invitation email itself. Share the sign-up link with the person; the role is applied when they register with the invited address.', 'TerraVault haitumi barua pepe ya mwaliko yenyewe. Mtumie mtu kiungo cha kujisajili; wadhifa utawekwa atakapojisajili kwa barua pepe iliyoalikwa.')}</span></p>
      <div class="table-wrap"><table class="table"><thead><tr>
        <th>${tr('Email', 'Barua pepe')}</th><th>${tr('Role', 'Wadhifa')}</th><th>${tr('Invited by', 'Alialikwa na')}</th><th>${tr('Sent', 'Imetumwa')}</th><th><span class="sr-only">${tr('Actions', 'Vitendo')}</span></th></tr></thead>
        <tbody>${invites.map((i) => html`<tr>
          <td><b>${i.email}</b>${i.note ? html`<small class="muted-text"> · ${i.note}</small>` : ''}</td>
          <td>${t('role.' + i.role)}</td><td>${i.inviter?.full_name || '—'}</td><td title="${fmtDateTime(i.created_at)}">${timeAgo(i.created_at)}</td>
          <td class="row-actions">
            <button class="btn btn-ghost btn-sm" data-copy>${raw(icon('copy', 15))}${tr('Copy sign-up link', 'Nakili kiungo cha kujisajili')}</button>
            <button class="btn btn-ghost btn-sm danger-text" data-revoke="${i.id}">${tr('Revoke', 'Futa mwaliko')}</button></td></tr>`)}</tbody></table></div>`);
    body.onclick = async (e) => {
      if (e.target.closest('[data-copy]')) { await copyText(signupLink()); toast(tr('Sign-up link copied.', 'Kiungo cha kujisajili kimenakiliwa.'), 'success'); return; }
      const r = e.target.closest('[data-revoke]');
      if (!r) return;
      const inv = invites.find((x) => x.id === r.dataset.revoke);
      const ok = await confirmDialog({
        title: tr('Revoke this invitation?', 'Futa mwaliko huu?'),
        message: tr(`${inv?.email || 'This person'} will no longer receive the invited role when they sign up.`, `${inv?.email || 'Mtu huyu'} hataweza tena kupata wadhifa aliyealikwa atakapojisajili.`),
        confirmText: tr('Revoke', 'Futa mwaliko'), danger: true,
      });
      if (!ok) return;
      const { data, error } = await sb.from('invitations').delete().eq('id', r.dataset.revoke).select('id');
      if (error || !data?.length) { toast(error ? friendlyError(error) : tr('You do not have permission to do that.', 'Huna ruhusa ya kufanya hivyo.'), 'error'); return; }
      toast(tr('Invitation revoked.', 'Mwaliko umefutwa.'), 'success');
      await reload();
    };
  }

  function openInvite() {
    const m = openModal({
      title: tr('Invite a person', 'Alika mtu'), size: 'sm',
      body: html`<form id="invForm" novalidate>
        <label class="field"><span class="label">${tr('Email address', 'Barua pepe')} <b class="req">*</b></span>
          <input class="input" type="email" name="email" required autocomplete="off" placeholder="name@organization.org"></label>
        <label class="field"><span class="label">${tr('Role', 'Wadhifa')}</span>
          <select class="input" name="role">${options(assignable(), 'contributor', { value: (x) => x, label: (x) => t('role.' + x) })}</select></label>
        <label class="field"><span class="label">${tr('Note (optional)', 'Maelezo (si lazima)')}</span>
          <input class="input" name="note" maxlength="300" placeholder="${tr('e.g. Mwanza field office', 'mf. Ofisi ya uwandani Mwanza')}"></label>
        <p class="field-error" id="invErr" hidden></p>
      </form>
      <div id="invDone" hidden></div>`,
      footer: html`<button class="btn btn-ghost" data-close>${t('common.cancel')}</button><button class="btn btn-primary" id="sendInv">${tr('Create invitation', 'Unda mwaliko')}</button>`,
    });
    const err = m.el.querySelector('#invErr');
    const fail = (msg) => { err.textContent = msg; err.hidden = false; };
    const form = m.el.querySelector('#invForm');
    const submit = (e) => withBusy(e.currentTarget || m.el.querySelector('#sendInv'), async () => {
      err.hidden = true;
      const fd = new FormData(form);
      const email = String(fd.get('email') || '').trim().toLowerCase();
      if (!isEmail(email)) return fail(tr('Enter a valid email address.', 'Weka barua pepe halali.'));
      if (profiles.some((p) => p.email.toLowerCase() === email)) return fail(tr('This person already has an account. Change their role from the People tab instead.', 'Mtu huyu tayari ana akaunti. Badilisha wadhifa wake kwenye kichupo cha Watu.'));
      if (invites.some((i) => i.email.toLowerCase() === email)) return fail(tr('There is already an open invitation for this email.', 'Tayari kuna mwaliko wazi kwa barua pepe hii.'));
      const { error } = await sb.from('invitations').insert({ email, role: fd.get('role'), note: String(fd.get('note') || '').trim() || null });
      if (error) return fail(/duplicate key/i.test(error.message) ? tr('There is already an open invitation for this email.', 'Tayari kuna mwaliko wazi kwa barua pepe hii.') : friendlyError(error));
      form.hidden = true;
      m.el.querySelector('#sendInv').hidden = true;
      const done = m.el.querySelector('#invDone');
      done.hidden = false;
      mount(done, html`<p>${raw(icon('check-circle', 18))} <b>${tr('Invitation created.', 'Mwaliko umeundwa.')}</b></p>
        <p class="muted-text">${tr(`Ask ${email} to create an account with this exact address. They will receive the role "${t('role.' + fd.get('role'))}" automatically.`, `Mwombe ${email} afungue akaunti kwa barua pepe hii hii. Atapewa wadhifa wa "${t('role.' + fd.get('role'))}" moja kwa moja.`)}</p>
        <div class="copy-row"><input class="input" readonly value="${signupLink()}" aria-label="${tr('Sign-up link', 'Kiungo cha kujisajili')}"><button class="btn btn-ghost" id="cpLink" type="button">${raw(icon('copy', 16))}${t('common.copy')}</button></div>`);
      done.querySelector('#cpLink').addEventListener('click', async () => { await copyText(signupLink()); toast(tr('Sign-up link copied.', 'Kiungo cha kujisajili kimenakiliwa.'), 'success'); });
      m.el.querySelector('[data-close]:not(.icon-btn)').textContent = t('common.close');
      await reload();
    });
    m.el.querySelector('#sendInv').addEventListener('click', submit);
    form.addEventListener('submit', (e) => { e.preventDefault(); submit({ currentTarget: m.el.querySelector('#sendInv') }); });
  }
  $q('#invite').addEventListener('click', openInvite);

  // ------------------------------------------------------------ roles x permissions
  function paintRoles() {
    const has = new Set(perms.map((x) => `${x.role}:${x.permission}`));
    const counts = Object.fromEntries(ROLES.map((r) => [r, profiles.filter((p) => p.role === r).length]));
    mount(body, html`
      <p class="hint">${raw(icon('info', 15))}<span>${tr('This table is read-only. It shows what each role may do; the database enforces it on every request.', 'Jedwali hili ni la kusoma tu. Linaonyesha kila wadhifa unaweza kufanya nini; hifadhidata inalitekeleza kwa kila ombi.')}</span></p>
      <div class="table-wrap"><table class="table perm-matrix"><thead><tr>
        <th>${tr('Permission', 'Ruhusa')}</th>${ROLES.map((r) => html`<th scope="col"><span>${t('role.' + r)}</span><small class="muted-text">${counts[r]} ${tr('people', 'watu')}</small></th>`)}</tr></thead>
        <tbody>${PERMS().map(([k, label, desc]) => html`<tr><th scope="row"><b>${label}</b><small class="muted-text">${desc}</small></th>
          ${ROLES.map((r) => (has.has(`${r}:${k}`)
            ? html`<td class="perm-yes" title="${t('role.' + r)}: ${label}">${raw(icon('check', 18))}<span class="sr-only">${tr('Yes', 'Ndiyo')}</span></td>`
            : html`<td class="perm-no"><span aria-hidden="true">–</span><span class="sr-only">${tr('No', 'Hapana')}</span></td>`))}</tr>`)}</tbody></table></div>
      <p class="muted-text small">${tr('Beyond roles: people can also be project managers or members of individual projects, and confidential or restricted files stay limited to administrators, the uploader and project members.', 'Zaidi ya wadhifa: watu wanaweza pia kuwa mameneja au wanachama wa miradi mahususi, na mafaili ya siri au yenye vikwazo hubaki kwa wasimamizi, aliyepakia na wanachama wa mradi.')}</p>`);
  }

  function paint() {
    paintTabs();
    body.onclick = null;
    if (tab === 'people') paintPeople(); else if (tab === 'invites') paintInvites(); else paintRoles();
  }

  async function reload() {
    try { await loadData(); } catch (err) { toast(friendlyError(err), 'error'); }
    if (ctx.isCurrent()) paint();
  }

  try {
    await loadData();
  } catch (err) {
    if (!ctx.isCurrent()) return;
    mount(body, emptyState({
      icon: 'alert', title: tr('Could not load users', 'Imeshindwa kupakia watumiaji'), text: friendlyError(err),
      action: html`<button class="btn btn-primary" id="retry">${tr('Try again', 'Jaribu tena')}</button>`,
    }));
    $q('#retry').addEventListener('click', () => ctx.refresh());
    return;
  }
  if (!ctx.isCurrent()) return;
  paint();
}
