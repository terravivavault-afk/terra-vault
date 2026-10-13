// Sign in, create account, forgot / reset password.
import { sb } from '../lib/supabase.js';
import { state, loadSession, loadPublicRefs, defaultHome, safeNext } from '../lib/state.js';
import { html, raw, mount, go } from '../lib/util.js';
import { tr, getLang } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { landscape } from '../lib/art.js';
import { withBusy, toast } from '../lib/ui.js';
import { SITE_URL } from '../config.js';

const appUrl = () => SITE_URL || location.origin + location.pathname;

function friendly(err) {
  const m = err?.message || '';
  if (/invalid login/i.test(m)) return tr('The email or password is incorrect.', 'Barua pepe au nenosiri si sahihi.');
  if (/not confirmed/i.test(m)) return tr('Please confirm your email first. Check your inbox for the link.', 'Tafadhali thibitisha barua pepe yako kwanza. Angalia kikasha chako.');
  if (/already registered|already been registered/i.test(m)) return tr('An account with this email already exists. Try signing in.', 'Akaunti yenye barua pepe hii tayari ipo. Jaribu kuingia.');
  if (/password/i.test(m) && /(least|short|weak)/i.test(m)) return tr('Choose a stronger password: at least 8 characters.', 'Chagua nenosiri imara: angalau herufi 8.');
  if (/rate|too many/i.test(m)) return tr('Too many attempts. Please wait a minute and try again.', 'Majaribio mengi mno. Subiri dakika moja kisha ujaribu tena.');
  if (/fetch|network/i.test(m)) return tr('Could not reach the server. Check your connection.', 'Seva haipatikani. Angalia mtandao wako.');
  return m || tr('Something went wrong. Please try again.', 'Kuna tatizo. Tafadhali jaribu tena.');
}

const passwordField = (name, label, autocomplete) => html`
  <label class="field"><span class="label">${label}</span>
    <span class="input-wrap">
      <input class="input" type="password" name="${name}" required minlength="8" autocomplete="${autocomplete}">
      <button class="icon-btn show-pw" type="button" aria-label="${tr('Show password', 'Onyesha nenosiri')}" aria-pressed="false" data-show>${raw(icon('eye', 18))}</button>
    </span></label>`;

function bindShow(form) {
  form.querySelectorAll('[data-show]').forEach((b) => b.addEventListener('click', () => {
    const input = b.parentElement.querySelector('input');
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    b.innerHTML = icon(reveal ? 'eye-off' : 'eye', 18);
    b.setAttribute('aria-pressed', String(reveal));
    b.setAttribute('aria-label', reveal ? tr('Hide password', 'Ficha nenosiri') : tr('Show password', 'Onyesha nenosiri'));
    input.focus({ preventScroll: true });
  }));
}

export default async function auth(ctx) {
  const { mode } = ctx.opts;
  const next = safeNext(ctx.query.next);
  const slogan = getLang() === 'sw' ? 'Kulinda Mazingira, Kuwawezesha Jamii.' : 'Protecting Nature, Empowering Communities.';

  const copy = {
    login: { title: tr('Welcome back', 'Karibu tena'), sub: tr('Sign in to the Terraviva workspace.', 'Ingia kwenye nafasi ya kazi ya Terraviva.') },
    signup: { title: tr('Create your account', 'Fungua akaunti yako'), sub: tr('Join TerraVault to upload, review and share Terraviva materials.', 'Jiunge na TerraVault kupakia, kukagua na kushiriki vifaa vya Terraviva.') },
    forgot: { title: tr('Reset your password', 'Weka nenosiri jipya'), sub: tr('Enter your email and we will send you a reset link.', 'Weka barua pepe yako nasi tutakutumia kiungo cha kuweka upya.') },
    reset: { title: tr('Choose a new password', 'Chagua nenosiri jipya'), sub: tr('Use at least 8 characters.', 'Tumia angalau herufi 8.') },
  }[mode];

  const form = {
    login: html`
      <label class="field"><span class="label">${tr('Email', 'Barua pepe')}</span>
        <input class="input" type="email" name="email" required autocomplete="email" autofocus></label>
      ${passwordField('password', tr('Password', 'Nenosiri'), 'current-password')}
      <div class="row between"><span></span><a class="link" href="#/forgot">${tr('Forgot password?', 'Umesahau nenosiri?')}</a></div>
      <button class="btn btn-primary btn-block" type="submit">${tr('Sign in', 'Ingia')}</button>`,
    signup: html`
      <label class="field"><span class="label">${tr('Full name', 'Jina kamili')}</span>
        <input class="input" name="full_name" required autocomplete="name" maxlength="120"></label>
      <label class="field"><span class="label">${tr('Email', 'Barua pepe')}</span>
        <input class="input" type="email" name="email" required autocomplete="email"></label>
      ${passwordField('password', tr('Password', 'Nenosiri'), 'new-password')}
      <p class="hint">${raw(icon('info', 15))}<span>${tr('Use the email address your administrator invited. Without an invitation your account has no access to internal files.', 'Tumia barua pepe ambayo msimamizi wako aliialika. Bila mwaliko akaunti yako haitaona mafaili ya ndani.')}</span></p>
      <button class="btn btn-primary btn-block" type="submit">${tr('Create account', 'Fungua akaunti')}</button>`,
    forgot: html`
      <label class="field"><span class="label">${tr('Email', 'Barua pepe')}</span>
        <input class="input" type="email" name="email" required autocomplete="email" autofocus></label>
      <button class="btn btn-primary btn-block" type="submit">${tr('Send reset link', 'Tuma kiungo')}</button>`,
    reset: html`
      ${passwordField('password', tr('New password', 'Nenosiri jipya'), 'new-password')}
      ${passwordField('confirm', tr('Confirm new password', 'Thibitisha nenosiri jipya'), 'new-password')}
      <button class="btn btn-primary btn-block" type="submit">${tr('Save password', 'Hifadhi nenosiri')}</button>`,
  }[mode];

  const foot = {
    login: html`${tr('New to TerraVault?', 'Mgeni TerraVault?')} <a class="link" href="#/signup${next ? '?next=' + encodeURIComponent(next) : ''}">${tr('Create an account', 'Fungua akaunti')}</a>`,
    signup: html`${tr('Already have an account?', 'Tayari una akaunti?')} <a class="link" href="#/login">${tr('Sign in', 'Ingia')}</a>`,
    forgot: html`<a class="link" href="#/login">${tr('Back to sign in', 'Rudi kuingia')}</a>`,
    reset: html``,
  }[mode];

  mount(ctx.view, html`
    <section class="auth">
      <aside class="auth-art">
        ${landscape()}
        <div class="auth-art-copy">
          <a class="brand brand-light" href="#/"><img src="assets/emblem.svg" alt="" width="44" height="38"><span><b>TerraVault</b><small>by Terraviva</small></span></a>
          <h2>${slogan}</h2>
          <p>${tr('One secure home for the photographs, videos and reports behind our conservation, agriculture and community work.', 'Makazi salama ya picha, video na ripoti za kazi zetu za uhifadhi, kilimo na maendeleo ya jamii.')}</p>
        </div>
      </aside>
      <div class="auth-panel">
        <a class="auth-back" href="#/">${raw(icon('chevron-left', 16))}${tr('Public library', 'Maktaba ya umma')}</a>
        <div class="auth-card">
          <h1>${copy.title}</h1>
          <p class="muted-text">${copy.sub}</p>
          <form id="authForm" novalidate>
            <p class="form-msg" id="msg" role="alert" hidden></p>
            ${form}
          </form>
          <p class="auth-foot">${foot}</p>
        </div>
      </div>
    </section>`);

  const formEl = ctx.view.querySelector('#authForm');
  const msg = ctx.view.querySelector('#msg');
  bindShow(formEl);
  const show = (text, kind = 'error') => { msg.textContent = text; msg.className = `form-msg ${kind}`; msg.hidden = false; };

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.hidden = true;
    if (!formEl.reportValidity()) return;
    const f = Object.fromEntries(new FormData(formEl));
    const btn = formEl.querySelector('button[type=submit]');
    await withBusy(btn, async () => {
      btn.textContent = tr('Please wait…', 'Subiri…');
      try {
        if (mode === 'login') {
          const { error } = await sb.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
          if (error) throw error;
          await loadSession(); await loadPublicRefs(true);
          go(next || defaultHome());
        } else if (mode === 'signup') {
          const { data, error } = await sb.auth.signUp({
            email: f.email.trim(), password: f.password,
            options: { data: { full_name: f.full_name.trim() }, emailRedirectTo: appUrl() },
          });
          if (error) throw error;
          if (data.session) { await loadSession(); await loadPublicRefs(true); go(next || defaultHome()); }
          else {
            formEl.querySelectorAll('.field,.hint,button[type=submit]').forEach((x) => { x.hidden = true; });
            show(tr('Account created. Open the confirmation link we emailed you, then sign in.', 'Akaunti imefunguliwa. Fungua kiungo cha uthibitisho tulichokutumia kwa barua pepe, kisha uingie.'), 'ok');
          }
        } else if (mode === 'forgot') {
          const { error } = await sb.auth.resetPasswordForEmail(f.email.trim(), { redirectTo: appUrl() });
          if (error) throw error;
          show(tr('If an account exists for that email, a reset link is on its way.', 'Ikiwa akaunti ipo kwa barua pepe hiyo, kiungo cha kuweka upya kimetumwa.'), 'ok');
        } else if (mode === 'reset') {
          if (f.password !== f.confirm) throw new Error(tr('The two passwords do not match.', 'Nenosiri mbili hazilingani.'));
          const { error } = await sb.auth.updateUser({ password: f.password });
          if (error) throw error;
          state.recovering = false;
          toast(tr('Password updated.', 'Nenosiri limesasishwa.'), 'success');
          go(defaultHome());
        }
      } catch (err) {
        show(friendly(err));
      } finally {
        if (btn.isConnected) btn.textContent = { login: tr('Sign in', 'Ingia'), signup: tr('Create account', 'Fungua akaunti'), forgot: tr('Send reset link', 'Tuma kiungo'), reset: tr('Save password', 'Hifadhi nenosiri') }[mode];
      }
    });
  });
}
