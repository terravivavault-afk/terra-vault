// TerraVault — application entry: session, hash router and page loading.
import { sb } from './lib/supabase.js';
import { state, loadSession, loadPublicRefs, defaultHome, safeNext } from './lib/state.js';
import { parseHash, hashFor, go, html, mount } from './lib/util.js';
import { tr } from './lib/i18n.js';
import { emptyState } from './lib/ui.js';
import { buildShell, markActive, refreshChrome, closeNav } from './shell.js';

// [pattern, loader, area, options]
const R = (re, load, area, opts = {}) => ({ re, load, area, opts });
const ROUTES = [
  R(/^\/$/, () => import('./pages/home.js'), 'public', { nav: 'home' }),
  R(/^\/explore$/, () => import('./pages/explore.js'), 'public', { nav: 'explore' }),
  R(/^\/photos$/, () => import('./pages/explore.js'), 'public', { nav: 'photos', cat: 'photo' }),
  R(/^\/videos$/, () => import('./pages/explore.js'), 'public', { nav: 'videos', cat: 'video' }),
  R(/^\/publications$/, () => import('./pages/explore.js'), 'public', { nav: 'publications', cat: 'document' }),
  R(/^\/environment$/, () => import('./pages/explore.js'), 'public', { nav: 'environment', program: 'environmental-conservation' }),
  R(/^\/agriculture$/, () => import('./pages/explore.js'), 'public', { nav: 'agriculture', program: 'sustainable-agriculture' }),
  R(/^\/library\/([0-9a-f-]{36})$/, () => import('./pages/public-asset.js'), 'public', { nav: 'explore' }),
  R(/^\/projects$/, () => import('./pages/public-projects.js'), 'public', { nav: 'projects' }),
  R(/^\/about$/, () => import('./pages/info.js'), 'public', { nav: 'about', page: 'about' }),
  R(/^\/contact$/, () => import('./pages/info.js'), 'public', { nav: 'contact', page: 'contact' }),
  R(/^\/privacy$/, () => import('./pages/info.js'), 'public', { page: 'privacy' }),
  R(/^\/terms$/, () => import('./pages/info.js'), 'public', { page: 'terms' }),
  R(/^\/s\/([A-Za-z0-9]{32,128})$/, () => import('./pages/share.js'), 'public'),

  R(/^\/login$/, () => import('./pages/auth.js'), 'auth', { mode: 'login' }),
  R(/^\/signup$/, () => import('./pages/auth.js'), 'auth', { mode: 'signup' }),
  R(/^\/forgot$/, () => import('./pages/auth.js'), 'auth', { mode: 'forgot' }),
  R(/^\/reset$/, () => import('./pages/auth.js'), 'auth', { mode: 'reset' }),

  R(/^\/app$/, () => import('./pages/dashboard.js'), 'app', { nav: 'dashboard' }),
  R(/^\/app\/assets$/, () => import('./pages/assets.js'), 'app', { nav: 'assets' }),
  R(/^\/app\/photos$/, () => import('./pages/assets.js'), 'app', { nav: 'photos', cat: 'photo' }),
  R(/^\/app\/videos$/, () => import('./pages/assets.js'), 'app', { nav: 'videos', cat: 'video' }),
  R(/^\/app\/documents$/, () => import('./pages/assets.js'), 'app', { nav: 'documents', cat: 'document' }),
  R(/^\/app\/audio$/, () => import('./pages/assets.js'), 'app', { nav: 'audio', cat: 'audio' }),
  R(/^\/app\/assets\/([0-9a-f-]{36})$/, () => import('./pages/asset.js'), 'app', { nav: 'assets' }),
  R(/^\/app\/projects$/, () => import('./pages/projects.js'), 'app', { nav: 'projects' }),
  R(/^\/app\/projects\/([0-9a-f-]{36})$/, () => import('./pages/project.js'), 'app', { nav: 'projects' }),
  R(/^\/app\/collections$/, () => import('./pages/collections.js'), 'app', { nav: 'collections' }),
  R(/^\/app\/collections\/([0-9a-f-]{36})$/, () => import('./pages/collection.js'), 'app', { nav: 'collections' }),
  R(/^\/app\/shared$/, () => import('./pages/shared.js'), 'app', { nav: 'shared' }),
  R(/^\/app\/approvals$/, () => import('./pages/approvals.js'), 'app', { nav: 'approvals' }),
  R(/^\/app\/trash$/, () => import('./pages/trash.js'), 'app', { nav: 'trash' }),
  R(/^\/app\/reports$/, () => import('./pages/reports.js'), 'app', { nav: 'reports' }),
  R(/^\/app\/users$/, () => import('./pages/users.js'), 'app', { nav: 'users' }),
  R(/^\/app\/settings$/, () => import('./pages/settings.js'), 'app', { nav: 'settings' }),
  R(/^\/app\/notifications$/, () => import('./pages/notifications.js'), 'app', { nav: '' }),
  R(/^\/app\/profile$/, () => import('./pages/profile.js'), 'app', { nav: '' }),
];

let seq = 0;
let cleanup = null;
let shell = null; // { area, view }

export function refresh() { return render(); }
window.addEventListener('tv:changed', () => { render({ keepScroll: true }); });
window.addEventListener('tv:lang', () => { render({ rebuild: true, keepScroll: true }); });

function match(path) {
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (m) return { route: r, params: m.slice(1) };
  }
  return null;
}

async function render({ rebuild = false, keepScroll = false } = {}) {
  const my = ++seq;
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  closeNav();

  const { path, query } = parseHash();
  const hit = match(path);
  const route = hit?.route || R(/./, null, 'public', {});
  const next = hashFor(path, query).slice(1);

  // Guards ------------------------------------------------------------
  if (route.area === 'app' && !state.user) { go('/login', { next: hashFor(path, query).slice(1) }); return; }
  if (route.area === 'auth' && state.user && !state.recovering && route.opts.mode !== 'reset') { go(safeNext(query.next) || defaultHome()); return; }
  if (route.opts.mode === 'reset' && !state.user) { go('/login'); return; }
  if (route.area === 'app' && state.user && !state.profile) {
    await sb.auth.signOut(); go('/login'); return;
  }

  if (state.suspended && route.area === 'app') {
    shell = buildShell('bare', { rebuild: true });
    mount(shell.view, html`<div class="center-page">${emptyState({
      icon: 'lock',
      title: tr('Your account is suspended', 'Akaunti yako imesimamishwa'),
      text: tr('An administrator has paused your access. Please contact Terraviva if you think this is a mistake.', 'Msimamizi amesitisha ufikiaji wako. Tafadhali wasiliana na Terraviva ikiwa unadhani ni kosa.'),
      action: html`<button class="btn btn-primary" id="so">${tr('Sign out', 'Toka')}</button>`,
    })}</div>`);
    shell.view.querySelector('#so').onclick = async () => { await sb.auth.signOut(); location.hash = '#/'; location.reload(); };
    return;
  }

  // Shell -------------------------------------------------------------
  shell = buildShell(route.area, { rebuild });
  markActive(route.opts.nav || '');
  if (route.area === 'app') refreshChrome();
  const view = shell.view;
  if (!keepScroll) window.scrollTo(0, 0);

  if (!hit) {
    mount(view, html`<div class="container pad-xl">${emptyState({
      icon: 'search', title: tr('Page not found', 'Ukurasa haujapatikana'),
      text: tr('The page you are looking for does not exist or has moved.', 'Ukurasa unaoutafuta haupo au umehamishwa.'),
      action: html`<a class="btn btn-primary" href="#/">${tr('Back to home', 'Rudi mwanzo')}</a>`,
    })}</div>`);
    return;
  }

  if (!keepScroll) mount(view, html`<div class="view-loading"><div class="spinner" role="status" aria-label="Loading"></div></div>`);
  try {
    const mod = await route.load();
    if (my !== seq) return;
    const ctx = {
      view, query, path, params: hit.params, id: hit.params[0], opts: route.opts,
      isCurrent: () => my === seq, refresh: () => render({ keepScroll: true }), next,
    };
    const out = await mod.default(ctx);
    if (my !== seq) { if (typeof out === 'function') out(); return; }
    if (typeof out === 'function') cleanup = out;
  } catch (err) {
    if (my !== seq) return;
    console.error(err);
    mount(view, html`<div class="container pad-xl">${emptyState({
      icon: 'alert', title: tr('Something went wrong', 'Kuna tatizo limetokea'),
      text: tr('We could not load this page. Check your connection and try again.', 'Hatukuweza kupakia ukurasa huu. Angalia mtandao wako kisha ujaribu tena.'),
      action: html`<button class="btn btn-primary" onclick="location.reload()">${tr('Reload', 'Pakia upya')}</button>`,
    })}</div>`);
  }
}

async function boot() {
  try {
    await loadSession();
    await loadPublicRefs(true);
  } catch (err) {
    console.error(err);
  }

  sb.auth.onAuthStateChange((event, session) => {
    // Never await Supabase calls inside this callback; defer instead.
    setTimeout(async () => {
      if (event === 'PASSWORD_RECOVERY') {
        await loadSession(); state.recovering = true; location.hash = '#/reset'; return;
      }
      if (event === 'SIGNED_IN' && session?.user?.id !== state.user?.id) {
        await loadSession(); await loadPublicRefs(true); render({ rebuild: true });
      } else if (event === 'SIGNED_OUT' && state.user) {
        await loadSession(); render({ rebuild: true });
      }
    }, 0);
  });

  window.addEventListener('hashchange', () => render());
  if (!location.hash) location.hash = '#/';
  await render({ rebuild: true });
  refreshChrome();
}

boot();
export { render };
