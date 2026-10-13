// Public explore pages: Explore, Photos, Videos, Publications, Environment, Agriculture.
import { sb } from '../lib/supabase.js';
import { state } from '../lib/state.js';
import { html, raw, mount, debounce, replaceHash, fmtNum } from '../lib/util.js';
import { t, tr } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { assetCard, emptyState, skeletonGrid, pagination, options, programName } from '../lib/ui.js';
import { hydrateThumbs, ref } from '../lib/api.js';
import { searchPublic } from '../lib/publicdata.js';
import { PAGE_SIZE } from '../config.js';

const TITLES = () => ({
  explore: [tr('Explore the library', 'Chunguza maktaba'), tr('Everything Terraviva has approved for public use.', 'Kila kitu ambacho Terraviva imeidhinisha kwa matumizi ya umma.')],
  photos: [t('pub.nav.photos'), tr('Photographs from our field work and community events.', 'Picha kutoka kazi zetu za uwandani na matukio ya jamii.')],
  videos: [t('pub.nav.videos'), tr('Films and recordings from our programmes.', 'Filamu na rekodi kutoka programu zetu.')],
  publications: [t('pub.nav.publications'), tr('Reports, guides and learning materials you can read and download.', 'Ripoti, miongozo na vifaa vya kujifunzia unavyoweza kusoma na kupakua.')],
  environment: [tr('Environmental resources', 'Rasilimali za mazingira'), tr('Conservation, biodiversity, waste management and climate education.', 'Uhifadhi, bioanuwai, usimamizi wa taka na elimu ya hali ya hewa.')],
  agriculture: [tr('Agricultural resources', 'Rasilimali za kilimo'), tr('Agroforestry, soil care and climate-smart farming guides.', 'Kilimo mseto, utunzaji wa udongo na miongozo ya kilimo kinachostahimili tabianchi.')],
});

export default async function explore(ctx) {
  const key = ctx.opts.nav || 'explore';
  const [title, sub] = TITLES()[key] || TITLES().explore;
  const fixedProgram = ctx.opts.program ? state.programs.find((p) => p.slug === ctx.opts.program)?.id : '';
  const f = {
    q: ctx.query.q || '', cat: ctx.opts.cat || ctx.query.cat || '', program: fixedProgram || ctx.query.program || '',
    project: ctx.query.project || '', tag: ctx.query.tag || '', sort: ctx.query.sort || 'new', page: Math.max(1, +ctx.query.page || 1),
  };
  const tags = await ref('tags').catch(() => []);
  const catOptions = ['photo', 'video', 'document', 'audio'];

  mount(ctx.view, html`
    <section class="page-banner"><div class="container"><h1>${title}</h1><p>${sub}</p></div></section>
    <div class="container pub-results">
      <form class="filter-bar" id="filters" role="search">
        <label class="search-field">${raw(icon('search', 18))}
          <input type="search" name="q" value="${f.q}" placeholder="${tr('Search by title, topic or place', 'Tafuta kwa jina, mada au mahali')}" aria-label="${t('common.search')}"></label>
        ${ctx.opts.cat ? '' : html`<select class="input" name="cat" aria-label="${tr('Type', 'Aina')}">
          ${options(catOptions, f.cat, { value: (x) => x, label: (x) => t('cat.' + x), blank: tr('All types', 'Aina zote') })}</select>`}
        ${ctx.opts.program ? '' : html`<select class="input" name="program" aria-label="${tr('Programme area', 'Eneo la programu')}">
          ${options(state.programs, f.program, { label: programName, blank: tr('All programmes', 'Programu zote') })}</select>`}
        <select class="input" name="tag" aria-label="${tr('Topic', 'Mada')}">
          ${options(tags, f.tag, { blank: tr('All topics', 'Mada zote') })}</select>
        <select class="input" name="sort" aria-label="${tr('Sort', 'Panga')}">
          <option value="new" ${f.sort === 'new' ? raw('selected') : ''}>${tr('Newest first', 'Mpya kwanza')}</option>
          <option value="old" ${f.sort === 'old' ? raw('selected') : ''}>${tr('Oldest first', 'Za zamani kwanza')}</option>
          <option value="title" ${f.sort === 'title' ? raw('selected') : ''}>${tr('Title A–Z', 'Jina A–Z')}</option>
        </select>
      </form>
      <p class="result-count" id="count" aria-live="polite"></p>
      <div id="results"></div>
      <div id="pager"></div>
    </div>`);

  const form = ctx.view.querySelector('#filters');
  const results = ctx.view.querySelector('#results');
  const countEl = ctx.view.querySelector('#count');
  const pagerEl = ctx.view.querySelector('#pager');
  let token = 0;

  async function load() {
    const my = ++token;
    mount(results, skeletonGrid(8));
    const params = { q: f.q, cat: ctx.opts.cat ? '' : f.cat, program: ctx.opts.program ? '' : f.program, project: f.project, tag: f.tag, sort: f.sort, page: f.page };
    replaceHash(ctx.path, Object.fromEntries(Object.entries(params).filter(([k, v]) => v && !(k === 'sort' && v === 'new') && !(k === 'page' && v === 1))));
    let res;
    try {
      res = await searchPublic({ ...f, cat: ctx.opts.cat || f.cat, program: fixedProgram || f.program });
    } catch {
      if (my !== token) return;
      mount(results, emptyState({ icon: 'alert', title: tr('The library could not be loaded', 'Maktaba haikuweza kupakiwa'), text: tr('Please check your connection and try again.', 'Tafadhali angalia mtandao wako kisha ujaribu tena.') }));
      return;
    }
    if (my !== token) return;
    countEl.textContent = res.total ? `${fmtNum(res.total)} ${tr('results', 'matokeo')}` : '';
    if (!res.rows.length) {
      mount(results, emptyState({
        icon: 'search', title: tr('Nothing matches yet', 'Hakuna kinacholingana bado'),
        text: f.q || f.tag || f.cat || f.program ? tr('Try fewer filters or a different word.', 'Jaribu vichujio vichache au neno tofauti.') : t('pub.nothing'),
      }));
      mount(pagerEl, html``);
      return;
    }
    mount(results, html`<div class="asset-grid">${res.rows.map((a) => assetCard(a, { href: `#/library/${a.id}`, showStatus: false }))}</div>`);
    hydrateThumbs(results);
    mount(pagerEl, pagination({ page: f.page, total: res.total, pageSize: PAGE_SIZE }));
  }

  const onChange = debounce(() => {
    const d = new FormData(form);
    f.q = (d.get('q') || '').toString().trim();
    if (d.has('cat')) f.cat = d.get('cat').toString();
    if (d.has('program')) f.program = d.get('program').toString();
    f.tag = d.get('tag').toString(); f.sort = d.get('sort').toString(); f.page = 1;
    load();
  }, 250);
  form.addEventListener('input', onChange);
  form.addEventListener('submit', (e) => { e.preventDefault(); onChange(); });
  pagerEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (!b) return;
    f.page = +b.dataset.page; load(); window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  await load();
}
