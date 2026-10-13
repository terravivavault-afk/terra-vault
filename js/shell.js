// Page chrome: public header/footer, the signed-in workspace shell, and auth layout.
import { sb } from './lib/supabase.js';
import { state, can, isAdmin, isStaff, signOut } from './lib/state.js';
import { html, raw, mount, $, $$, esc, initials, timeAgo, go, debounce } from './lib/util.js';
import { icon } from './lib/icons.js';
import { t, getLang, setLang, tr } from './lib/i18n.js';
import { closeOnOutside } from './lib/ui.js';

const root = () => document.getElementById('root');
let current = null; // { area, view }
let pollTimer = null;

export const setting = (key, fallback = '') => {
  const v = state.settings?.[key];
  return v === undefined || v === null || v === '' ? fallback : v;
};

// ------------------------------------------------------------------ shared bits
function langButton() {
  const sw = getLang() === 'sw';
  return html`<button class="lang-btn" type="button" data-lang aria-label="${sw ? 'Switch to English' : 'Badili kwa Kiswahili'}">
    ${raw(icon('globe', 16))}<span>${sw ? 'English' : 'Kiswahili'}</span></button>`;
}
function bindLang(scope) {
  scope.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
    setLang(getLang() === 'sw' ? 'en' : 'sw');
    window.dispatchEvent(new Event('tv:lang'));
  }));
}
const brand = (href, light = false) => html`<a class="brand ${light ? 'brand-light' : ''}" href="${href}">
  <img src="assets/emblem.svg" alt="" width="40" height="35"><span><b>TerraVault</b><small>by Terraviva</small></span></a>`;

// ------------------------------------------------------------------ public shell
const PUB_NAV = [
  ['explore', '/explore', 'pub.nav.explore'], ['photos', '/photos', 'pub.nav.photos'], ['videos', '/videos', 'pub.nav.videos'],
  ['publications', '/publications', 'pub.nav.publications'], ['environment', '/environment', 'pub.nav.environment'],
  ['agriculture', '/agriculture', 'pub.nav.agriculture'], ['projects', '/projects', 'pub.nav.projects'],
  ['about', '/about', 'pub.nav.about'], ['contact', '/contact', 'pub.nav.contact'],
];

function publicShell() {
  const email = setting('contact_email');
  const phone = setting('contact_phone');
  const address = setting('contact_address', 'Mwanza, Tanzania');
  const slogan = getLang() === 'sw' ? setting('slogan_sw', 'Kulinda Mazingira, Kuwawezesha Jamii.') : setting('slogan', 'Protecting Nature, Empowering Communities.');
  mount(root(), html`
    <div class="pub">
      <header class="pub-header">
        <div class="container pub-bar">
          ${brand('#/')}
          <nav class="pub-nav" id="pubnav" aria-label="Main">
            ${PUB_NAV.map(([k, href, key]) => html`<a href="#${href}" data-nav="${k}">${t(key)}</a>`)}
          </nav>
          <div class="pub-actions">
            ${langButton()}
            ${state.user
              ? html`<a class="btn btn-primary btn-sm" href="#/app">${tr('Open workspace', 'Fungua nafasi ya kazi')}</a>`
              : html`<a class="btn btn-ghost btn-sm" href="#/login">${t('pub.staff')}</a>`}
            <button class="icon-btn pub-toggle" type="button" aria-label="Menu" aria-expanded="false" aria-controls="pubnav">${raw(icon('menu', 22))}</button>
          </div>
        </div>
      </header>
      <main id="view" class="pub-main" tabindex="-1"></main>
      <footer class="pub-footer">
        <div class="strata-edge" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div class="container foot-grid">
          <div class="foot-brand">
            ${brand('#/', true)}
            <p class="foot-slogan">${slogan}</p>
            <p class="foot-small">${tr('TerraVault is the digital asset library of Terraviva, a non-profit organization based in Mwanza, Tanzania.', 'TerraVault ni maktaba ya mali za kidijitali ya Terraviva, shirika lisilo la kiserikali lenye makao yake Mwanza, Tanzania.')}</p>
          </div>
          <div>
            <h4>${tr('Library', 'Maktaba')}</h4>
            <ul>
              <li><a href="#/explore">${t('pub.nav.explore')}</a></li>
              <li><a href="#/photos">${t('pub.nav.photos')}</a></li>
              <li><a href="#/videos">${t('pub.nav.videos')}</a></li>
              <li><a href="#/publications">${t('pub.nav.publications')}</a></li>
              <li><a href="#/projects">${t('pub.nav.projects')}</a></li>
            </ul>
          </div>
          <div>
            <h4>${tr('Contact Terraviva', 'Wasiliana na Terraviva')}</h4>
            <ul class="foot-contact">
              <li>${raw(icon('pin', 15))}<span>${address}</span></li>
              ${email ? html`<li>${raw(icon('mail', 15))}<a href="mailto:${email}">${email}</a></li>` : ''}
              ${phone ? html`<li>${raw(icon('phone', 15))}<a href="tel:${phone}">${phone}</a></li>` : ''}
            </ul>
          </div>
        </div>
        <div class="container foot-legal">
          <span>© ${new Date().getFullYear()} Terraviva</span>
          <span class="foot-links">
            <a href="#/privacy">${tr('Privacy policy', 'Sera ya faragha')}</a>
            <a href="#/terms">${tr('Terms of use', 'Masharti ya matumizi')}</a>
            <a href="#/login">${t('pub.staff')}</a>
          </span>
        </div>
      </footer>
    </div>`);
  const scope = root();
  bindLang(scope);
  const toggle = $('.pub-toggle', scope);
  toggle.addEventListener('click', () => {
    const open = document.body.classList.toggle('pubnav-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  return { area: 'public', view: $('#view') };
}

// ------------------------------------------------------------------ auth + bare shells
function authShell() {
  mount(root(), html`<main id="view" class="auth-wrap" tabindex="-1"></main>`);
  return { area: 'auth', view: $('#view') };
}
function bareShell() {
  mount(root(), html`<main id="view" tabindex="-1"></main>`);
  return { area: 'bare', view: $('#view') };
}

// ------------------------------------------------------------------ workspace shell
function navModel() {
  const staff = isStaff();
  const canReview = can('approve') || can('publish');
  return [
    { items: [{ key: 'dashboard', href: '/app', icon: 'home', show: staff }] },
    { sec: 'nav.section.library', items: [
      { key: 'assets', href: '/app/assets', icon: 'grid', show: staff },
      { key: 'photos', href: '/app/photos', icon: 'image', show: staff },
      { key: 'videos', href: '/app/videos', icon: 'video', show: staff },
      { key: 'documents', href: '/app/documents', icon: 'file', show: staff },
      { key: 'audio', href: '/app/audio', icon: 'music', show: staff },
    ] },
    { sec: 'nav.section.organise', items: [
      { key: 'projects', href: '/app/projects', icon: 'folder', show: true },
      { key: 'collections', href: '/app/collections', icon: 'layers', show: true },
      { key: 'shared', href: '/app/shared', icon: 'share', show: true },
      { key: 'approvals', href: '/app/approvals', icon: 'check-circle', show: canReview, badge: 'approvals' },
      { key: 'trash', href: '/app/trash', icon: 'trash', show: staff },
    ] },
    { sec: 'nav.section.manage', items: [
      { key: 'reports', href: '/app/reports', icon: 'chart', show: can('export_reports') || can('view_logs') },
      { key: 'users', href: '/app/users', icon: 'users', show: can('manage_users') },
      { key: 'settings', href: '/app/settings', icon: 'settings', show: can('manage_settings') },
    ] },
  ].map((g) => ({ ...g, items: g.items.filter((i) => i.show) })).filter((g) => g.items.length);
}

function workspaceShell() {
  const p = state.profile;
  const name = p?.full_name || p?.email || '';
  const nav = navModel();
  mount(root(), html`
    <div class="app">
      <div class="scrim" data-scrim></div>
      <aside class="sidebar" id="sidebar" aria-label="Workspace">
        <div class="side-top">
          ${brand('#/app', true)}
          <button class="icon-btn side-close" type="button" aria-label="Close menu" data-navclose>${raw(icon('x', 20))}</button>
        </div>
        <nav class="side-nav">
          ${nav.map((g) => html`<div class="side-group">
            ${g.sec ? html`<p class="side-sec">${t(g.sec)}</p>` : ''}
            ${g.items.map((i) => html`<a class="nav-item" href="#${i.href}" data-nav="${i.key}">
              ${raw(icon(i.icon, 19))}<span>${t('nav.' + i.key)}</span>
              ${i.badge ? html`<em class="nav-count" data-badge="${i.badge}" hidden></em>` : ''}</a>`)}
          </div>`)}
        </nav>
        <div class="side-foot">
          <a class="nav-item" href="#/" data-pubsite>${raw(icon('globe', 19))}<span>${t('nav.library')}</span></a>
          <div class="side-user">
            <span class="avatar avatar-lg" aria-hidden="true">${initials(name)}</span>
            <span class="side-user-text"><b>${name}</b><small>${p ? t('role.' + p.role) : ''}</small></span>
          </div>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="icon-btn nav-toggle" type="button" aria-label="Menu" data-navopen>${raw(icon('menu', 22))}</button>
          <form class="search-box" role="search" id="gsearch">
            ${raw(icon('search', 18))}
            <input type="search" name="q" placeholder="${tr('Search assets by title, tag, place…', 'Tafuta mali kwa jina, lebo, mahali…')}" aria-label="${t('common.search')}" autocomplete="off">
            <kbd aria-hidden="true">/</kbd>
          </form>
          <div class="top-actions">
            ${can('upload') ? html`<button class="btn btn-primary" type="button" id="topUpload">${raw(icon('upload', 18))}<span>${t('common.upload')}</span></button>` : ''}
            ${langButton()}
            <div class="menu-host">
              <button class="icon-btn bell" type="button" id="bell" aria-label="${t('dash.notifications')}" aria-haspopup="true">${raw(icon('bell', 20))}<i class="bell-dot" hidden></i></button>
              <div class="pop notif-pop" id="notifPop" hidden></div>
            </div>
            <div class="menu-host">
              <button class="avatar-btn" type="button" id="userBtn" aria-label="Account" aria-haspopup="true"><span class="avatar" aria-hidden="true">${initials(name)}</span></button>
              <div class="pop user-pop" id="userPop" hidden>
                <div class="pop-head"><b>${name}</b><small>${p?.email || ''}</small></div>
                <a href="#/app/profile">${raw(icon('user', 17))}${tr('My profile', 'Wasifu wangu')}</a>
                <a href="#/app/notifications">${raw(icon('bell', 17))}${t('dash.notifications')}</a>
                <a href="#/">${raw(icon('globe', 17))}${t('nav.library')}</a>
                <button type="button" id="signOut">${raw(icon('log-out', 17))}${t('common.signout')}</button>
              </div>
            </div>
          </div>
        </header>
        <main id="view" class="view" tabindex="-1"></main>
      </div>
    </div>`);

  const scope = root();
  bindLang(scope);
  $('[data-navopen]', scope).addEventListener('click', () => document.body.classList.add('nav-open'));
  $$('[data-navclose],[data-scrim]', scope).forEach((e) => e.addEventListener('click', closeNav));
  $$('.nav-item', scope).forEach((a) => a.addEventListener('click', closeNav));

  $('#gsearch', scope).addEventListener('submit', (e) => {
    e.preventDefault();
    const q = new FormData(e.target).get('q').toString().trim();
    go('/app/assets', q ? { q } : {});
    e.target.querySelector('input').blur();
  });
  $('#topUpload', scope)?.addEventListener('click', async () => {
    const { openUploader } = await import('./lib/uploader.js');
    openUploader();
  });

  // Menus
  const userBtn = $('#userBtn', scope); const userPop = $('#userPop', scope);
  userBtn.addEventListener('click', () => { userPop.hidden = !userPop.hidden; $('#notifPop').hidden = true; if (!userPop.hidden) closeOnOutside(userPop, userBtn); });
  userPop.addEventListener('click', (e) => { if (e.target.closest('a')) userPop.hidden = true; });
  $('#signOut', scope).addEventListener('click', async () => { await signOut(); location.hash = '#/'; location.reload(); });
  const bell = $('#bell', scope); const pop = $('#notifPop', scope);
  bell.addEventListener('click', async () => {
    pop.hidden = !pop.hidden; userPop.hidden = true;
    if (!pop.hidden) { closeOnOutside(pop, bell); await paintNotifications(pop); }
  });

  document.onkeydown = (e) => {
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '') && !document.body.classList.contains('modal-open')) {
      e.preventDefault(); $('#gsearch input')?.focus();
    }
  };
  return { area: 'app', view: $('#view') };
}

async function paintNotifications(pop) {
  pop.innerHTML = `<p class="pop-empty">${esc(t('common.loading'))}</p>`;
  const { data } = await sb.from('notifications').select('id,title,body,link,read_at,created_at').order('created_at', { ascending: false }).limit(8);
  const list = data || [];
  mount(pop, html`
    <div class="pop-head row between"><b>${t('dash.notifications')}</b>
      <button type="button" class="link-btn" id="readAll">${tr('Mark all read', 'Weka zote zimesomwa')}</button></div>
    ${list.length ? html`<ul class="notif-list">${list.map((n) => html`<li class="${n.read_at ? '' : 'unread'}">
      <a href="#${n.link || '/app/notifications'}" data-nid="${n.id}"><b>${n.title}</b>${n.body ? html`<span>${n.body}</span>` : ''}<small>${timeAgo(n.created_at)}</small></a></li>`)}</ul>`
      : html`<p class="pop-empty">${tr('You are all caught up.', 'Hakuna arifa mpya.')}</p>`}
    <a class="pop-foot" href="#/app/notifications">${tr('See all notifications', 'Ona arifa zote')}</a>`);
  pop.querySelector('#readAll')?.addEventListener('click', async () => {
    await sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
    refreshChrome(); paintNotifications(pop);
  });
  pop.querySelectorAll('[data-nid]').forEach((a) => a.addEventListener('click', async () => {
    pop.hidden = true;
    await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', a.dataset.nid);
    refreshChrome();
  }));
}

// ------------------------------------------------------------------ public API
export function buildShell(area, { rebuild = false } = {}) {
  if (current && current.area === area && !rebuild && document.getElementById('view')) {
    current.view = document.getElementById('view');
    return current;
  }
  document.onkeydown = null;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  document.body.classList.remove('nav-open', 'pubnav-open');
  document.body.dataset.area = area;
  current = area === 'app' ? workspaceShell() : area === 'public' ? publicShell() : area === 'auth' ? authShell() : bareShell();
  if (area === 'app') pollTimer = setInterval(refreshChrome, 60000);
  return current;
}

export function markActive(key) {
  document.body.classList.remove('nav-open', 'pubnav-open');
  $$('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === key;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

export function closeNav() { document.body.classList.remove('nav-open', 'pubnav-open'); }

export const refreshChrome = debounce(async () => {
  if (current?.area !== 'app' || !state.user) return;
  try {
    const jobs = [sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)];
    const wantsQueue = can('approve') || can('publish');
    if (wantsQueue) jobs.push(sb.from('assets').select('id', { count: 'exact', head: true }).eq('status', 'pending_review').is('deleted_at', null));
    const [n, q] = await Promise.all(jobs);
    const dot = $('.bell-dot');
    if (dot) { dot.hidden = !n.count; dot.textContent = ''; }
    const badge = $('[data-badge="approvals"]');
    if (badge && q) { badge.hidden = !q.count; badge.textContent = q.count > 99 ? '99+' : q.count; }
  } catch { /* chrome counters are optional */ }
}, 200);
