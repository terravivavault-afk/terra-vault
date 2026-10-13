// My profile: details, language, password, role summary, recent activity, sign out of this device.
import { sb } from '../lib/supabase.js';
import { state, myRole, loadProfile } from '../lib/state.js';
import { html, raw, mount, timeAgo, fmtDate, fmtDateTime } from '../lib/util.js';
import { t, tr, getLang, setLang } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { avatar, emptyState, toast, withBusy, options, confirmDialog } from '../lib/ui.js';
import { friendlyError } from '../lib/api.js';
import { actionLabel } from '../lib/labels.js';
import { PERMS } from './users.js';

export default async function profile(ctx) {
  const p = state.profile;
  const name = p.full_name || p.email;
  const granted = PERMS().filter(([k]) => state.perms.has(k));

  mount(ctx.view, html`
    <div class="page-head"><div><h1>${tr('My profile', 'Wasifu wangu')}</h1>
      <p>${tr('Your details, language and password.', 'Taarifa zako, lugha na nenosiri.')}</p></div></div>
    <div class="grid-2">
      <section class="panel"><header class="panel-head"><h2>${tr('Your details', 'Taarifa zako')}</h2></header>
        <div class="cell-user">${avatar(name, 'avatar-lg')}<span><b>${name}</b><small>${p.email}</small></span></div>
        <form id="pf" class="form-grid" novalidate>
          <label class="field"><span class="label">${tr('Full name', 'Jina kamili')} <b class="req">*</b></span><input class="input" name="full_name" required maxlength="120" autocomplete="name" value="${p.full_name || ''}"></label>
          <label class="field"><span class="label">${tr('Email', 'Barua pepe')}</span><input class="input" value="${p.email}" readonly aria-readonly="true"></label>
          <label class="field"><span class="label">${tr('Phone', 'Simu')}</span><input class="input" type="tel" name="phone" maxlength="40" autocomplete="tel" value="${p.phone || ''}"></label>
          <label class="field"><span class="label">${tr('Organisation', 'Shirika')}</span><input class="input" name="organization" maxlength="120" value="${p.organization || ''}"></label>
          <label class="field"><span class="label">${tr('Job title', 'Cheo')}</span><input class="input" name="job_title" maxlength="120" value="${p.job_title || ''}"></label>
          <label class="field"><span class="label">${tr('Preferred language', 'Lugha unayopendelea')}</span>
            <select class="input" name="preferred_language">${options([['en', 'English'], ['sw', 'Kiswahili']], p.preferred_language || getLang(), { value: (o) => o[0], label: (o) => o[1] })}</select></label>
          <p class="field-error" id="pfErr" hidden></p>
          <div class="row end wide"><button class="btn btn-primary" type="submit">${t('common.save')}</button></div>
        </form></section>

      <section class="panel"><header class="panel-head"><h2>${tr('Change password', 'Badilisha nenosiri')}</h2></header>
        <form id="pw" novalidate>
          <label class="field"><span class="label">${tr('New password', 'Nenosiri jipya')}</span><input class="input" type="password" name="password" minlength="8" autocomplete="new-password" required></label>
          <label class="field"><span class="label">${tr('Confirm new password', 'Thibitisha nenosiri jipya')}</span><input class="input" type="password" name="confirm" minlength="8" autocomplete="new-password" required></label>
          <p class="hint-text">${tr('Use at least 8 characters.', 'Tumia angalau herufi 8.')}</p>
          <p class="field-error" id="pwErr" hidden></p>
          <div class="row end"><button class="btn btn-primary" type="submit">${tr('Update password', 'Sasisha nenosiri')}</button></div>
        </form></section>

      <section class="panel"><header class="panel-head"><h2>${tr('Your role', 'Wadhifa wako')}</h2></header>
        <p><span class="badge st-approved">${t('role.' + myRole())}</span> <small class="muted-text">${tr('Member since', 'Mwanachama tangu')} ${fmtDate(p.created_at)}</small></p>
        ${granted.length ? html`<ul class="chips chips-static">${granted.map(([, label]) => html`<li class="chip chip-soft">${raw(icon('check', 13))} ${label}</li>`)}</ul>`
          : html`<p class="muted-text">${tr('Your role does not include any extra permissions.', 'Wadhifa wako hauna ruhusa za ziada.')}</p>`}
        <p class="muted-text small">${tr('Ask an administrator if you need a different role.', 'Mwombe msimamizi ikiwa unahitaji wadhifa tofauti.')}</p></section>

      <section class="panel"><header class="panel-head"><h2>${tr('Recent activity', 'Shughuli za hivi karibuni')}</h2></header><div id="act"><div class="view-loading"><div class="spinner" role="status" aria-label="Loading"></div></div></div></section>

      <section class="panel"><header class="panel-head"><h2>${tr('This device', 'Kifaa hiki')}</h2></header>
        <p class="muted-text">${tr('Sign out here without affecting your other devices.', 'Toka hapa bila kuathiri vifaa vyako vingine.')}</p>
        <button class="btn btn-ghost" id="so">${raw(icon('log-out', 17))}${tr('Sign out of this device', 'Toka kwenye kifaa hiki')}</button></section>
    </div>`);
  const $q = (s) => ctx.view.querySelector(s);
  const showErr = (id, msg) => { const e = $q(id); e.textContent = msg; e.hidden = !msg; };

  // details
  const pf = $q('#pf');
  pf.addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy(pf.querySelector('button[type=submit]'), async () => {
      showErr('#pfErr', '');
      const fd = new FormData(pf);
      const full_name = String(fd.get('full_name')).trim();
      if (!full_name) return showErr('#pfErr', tr('Your name is required.', 'Jina lako linahitajika.'));
      const lang = fd.get('preferred_language') === 'sw' ? 'sw' : 'en';
      const patch = { full_name, phone: String(fd.get('phone')).trim() || null, organization: String(fd.get('organization')).trim() || null, job_title: String(fd.get('job_title')).trim() || null, preferred_language: lang };
      const { data, error } = await sb.from('profiles').update(patch).eq('id', state.user.id).select('id');
      if (error) return showErr('#pfErr', friendlyError(error));
      if (!data?.length) return showErr('#pfErr', tr('You do not have permission to do that.', 'Huna ruhusa ya kufanya hivyo.'));
      await loadProfile();
      toast(tr('Profile saved.', 'Wasifu umehifadhiwa.'), 'success');
      if (lang !== getLang()) setLang(lang);
      window.dispatchEvent(new Event('tv:lang')); // rebuild the shell so the name and language update
    });
  });

  // password
  const pw = $q('#pw');
  pw.addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy(pw.querySelector('button[type=submit]'), async () => {
      showErr('#pwErr', '');
      const { password, confirm } = Object.fromEntries(new FormData(pw));
      if (String(password).length < 8) return showErr('#pwErr', tr('Choose a password of at least 8 characters.', 'Chagua nenosiri lenye angalau herufi 8.'));
      if (password !== confirm) return showErr('#pwErr', tr('The two passwords do not match.', 'Nenosiri mbili hazilingani.'));
      const { error } = await sb.auth.updateUser({ password });
      if (error) {
        const m = error.message || '';
        return showErr('#pwErr', /same/i.test(m) ? tr('The new password must be different from the current one.', 'Nenosiri jipya lazima liwe tofauti na la sasa.')
          : /reauth|recent/i.test(m) ? tr('For safety, please sign in again and then change your password.', 'Kwa usalama, tafadhali ingia tena kisha ubadilishe nenosiri.') : friendlyError(error));
      }
      pw.reset();
      toast(tr('Password updated.', 'Nenosiri limesasishwa.'), 'success');
    });
  });

  // sign out of this device only
  $q('#so').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: tr('Sign out of this device?', 'Toka kwenye kifaa hiki?'), message: tr('You will need to sign in again here.', 'Utahitaji kuingia tena hapa.'), confirmText: t('common.signout') });
    if (!ok) return;
    await sb.auth.signOut({ scope: 'local' });
    state.session = null; state.user = null; state.profile = null; state.perms = new Set();
    location.hash = '#/'; location.reload();
  });

  // recent activity (RLS lets everyone read their own log entries)
  const { data, error } = await sb.from('activity_logs').select('id,action,entity_title,created_at').eq('actor_id', state.user.id).order('created_at', { ascending: false }).limit(10);
  if (!ctx.isCurrent()) return;
  mount($q('#act'), error
    ? emptyState({ icon: 'alert', title: tr('Could not load activity', 'Imeshindwa kupakia shughuli'), text: friendlyError(error) })
    : (data || []).length
      ? html`<ul class="activity">${data.map((l) => html`<li><span><b>${tr('You', 'Wewe')}</b> ${actionLabel(l.action)} ${l.entity_title ? html`<em>${l.entity_title}</em>` : ''}<small title="${fmtDateTime(l.created_at)}">${timeAgo(l.created_at)}</small></span></li>`)}</ul>`
      : html`<p class="panel-empty">${tr('No activity yet.', 'Hakuna shughuli bado.')}</p>`);
}
