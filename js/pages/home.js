// Public home: hero, live numbers, programme areas and the latest published items.
import { state } from '../lib/state.js';
import { html, raw, mount, go, fmtNum } from '../lib/util.js';
import { t, tr, getLang } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { landscape } from '../lib/art.js';
import { assetCard, programName, emptyState } from '../lib/ui.js';
import { hydrateThumbs } from '../lib/api.js';
import { searchPublic, publicCounts } from '../lib/publicdata.js';

export default async function home(ctx) {
  const slogan = getLang() === 'sw' ? 'Kulinda Mazingira, Kuwawezesha Jamii.' : 'Protecting Nature, Empowering Communities.';
  mount(ctx.view, html`
    <section class="hero">
      ${landscape()}
      <div class="container hero-grid">
        <div class="hero-copy">
          <p class="hero-slogan">${slogan}</p>
          <h1>${t('pub.hero.title')}</h1>
          <p class="hero-sub">${t('pub.hero.sub')}</p>
          <form class="hero-search" id="heroSearch" role="search">
            ${raw(icon('search', 20))}
            <input type="search" name="q" placeholder="${tr('Search photos, reports, videos…', 'Tafuta picha, ripoti, video…')}" aria-label="${t('common.search')}">
            <button class="btn btn-clay" type="submit">${t('common.search')}</button>
          </form>
          <div class="hero-links">
            <a href="#/photos">${raw(icon('image', 17))}${t('pub.nav.photos')}</a>
            <a href="#/videos">${raw(icon('video', 17))}${t('pub.nav.videos')}</a>
            <a href="#/publications">${raw(icon('file', 17))}${t('pub.nav.publications')}</a>
          </div>
        </div>
        <dl class="hero-stats" id="heroStats" aria-live="polite"></dl>
      </div>
    </section>

    <section class="pub-section">
      <div class="container">
        <header class="section-head"><h2>${t('pub.programs')}</h2>
          <p>${tr('Every item in the library belongs to one of our work areas.', 'Kila kipengee kwenye maktaba kiko chini ya moja ya maeneo yetu ya kazi.')}</p></header>
        <div class="program-grid" id="programs"></div>
      </div>
    </section>

    <section class="pub-section tint">
      <div class="container">
        <header class="section-head row between"><h2>${t('pub.latest')}</h2>
          <a class="link" href="#/explore">${tr('Browse everything', 'Tazama vyote')}</a></header>
        <div id="latest"></div>
      </div>
    </section>

    <section class="pub-section">
      <div class="container band">
        <div>
          <h2>${tr('Working with Terraviva?', 'Unafanya kazi na Terraviva?')}</h2>
          <p>${tr('Partners, donors and researchers can be invited to see selected projects and files that are not public. Ask your Terraviva contact for an invitation.', 'Washirika, wafadhili na watafiti wanaweza kualikwa kuona miradi na mafaili teule ambayo si ya umma. Muulize mwasiliani wako wa Terraviva akualike.')}</p>
        </div>
        <div class="band-actions">
          <a class="btn btn-primary" href="#/contact">${tr('Contact Terraviva', 'Wasiliana na Terraviva')}</a>
          <a class="btn btn-ghost" href="${state.user ? '#/app' : '#/login'}">${state.user ? tr('Open workspace', 'Fungua nafasi ya kazi') : t('pub.staff')}</a>
        </div>
      </div>
    </section>`);

  ctx.view.querySelector('#heroSearch').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = new FormData(e.target).get('q').toString().trim();
    go('/explore', q ? { q } : {});
  });

  const [counts, latest] = await Promise.all([publicCounts().catch(() => null), searchPublic({ page: 1 }).catch(() => null)]);
  if (!ctx.isCurrent()) return;

  // Live numbers (hidden until there is something real to show).
  const stats = ctx.view.querySelector('#heroStats');
  if (counts && counts.total > 0) {
    const items = [
      [counts.total, tr('published items', 'vipengee vilivyochapishwa')],
      [counts.byCat.photo || 0, tr('photographs', 'picha')],
      [counts.byCat.video || 0, tr('videos', 'video')],
      [counts.byCat.document || 0, tr('publications', 'machapisho')],
    ].filter(([n]) => n > 0);
    mount(stats, html`${items.map(([n, l]) => html`<div><dt>${fmtNum(n)}</dt><dd>${l}</dd></div>`)}`);
  } else stats.hidden = true;

  // Programme areas
  const programs = state.programs.filter((p) => p.slug);
  mount(ctx.view.querySelector('#programs'), html`${programs.map((p) => {
    const n = counts?.byProgram?.[p.id] || 0;
    return html`<a class="program-card" href="#/explore?program=${p.id}" style="--pc:${p.color}">
      <span class="pc-ic">${raw(icon(p.icon || 'leaf', 24))}</span>
      <h3>${programName(p)}</h3>
      <p>${p.description || ''}</p>
      <span class="pc-count">${n ? `${fmtNum(n)} ${tr('items', 'vipengee')}` : tr('Coming soon', 'Inakuja hivi karibuni')}</span>
    </a>`;
  })}`);

  // Latest
  const host = ctx.view.querySelector('#latest');
  if (latest?.rows.length) {
    mount(host, html`<div class="asset-grid">${latest.rows.slice(0, 8).map((a) => assetCard(a, { href: `#/library/${a.id}`, showStatus: false }))}</div>`);
    hydrateThumbs(host);
  } else {
    mount(host, emptyState({
      icon: 'leaf', title: t('pub.nothing'),
      text: tr('New photographs, videos and publications appear here as soon as Terraviva publishes them.', 'Picha, video na machapisho mapya huonekana hapa mara Terraviva inapoyachapisha.'),
    }));
  }
}
