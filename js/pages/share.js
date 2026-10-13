// Opens a share link. The share-access edge function re-checks everything and returns short-lived URLs.
import { sb } from '../lib/supabase.js';
import { state } from '../lib/state.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { html, raw, mount, fmtBytes, fmtDate, CATEGORY_ICON } from '../lib/util.js';
import { t, tr } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { emptyState, openModal } from '../lib/ui.js';
import { renderPreview } from '../lib/preview.js';

async function fetchShare(token) {
  const { data } = await sb.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/share-access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${data.session?.access_token || SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ token }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

export default async function share(ctx) {
  const token = ctx.id;
  mount(ctx.view, html`<div class="view-loading"><div class="spinner" role="status"></div></div>`);
  let r;
  try { r = await fetchShare(token); } catch { r = { status: 0, body: {} }; }
  if (!ctx.isCurrent()) return;
  const { status, body } = r;

  const wrap = (inner) => mount(ctx.view, html`<div class="container pad-xl narrow">${inner}</div>`);

  if (status === 401) {
    wrap(emptyState({
      icon: 'lock', title: tr('Sign in to open this share', 'Ingia ili kufungua kilichoshirikiwa'),
      text: body.hint ? tr(`This was shared with ${body.hint}. Sign in with that email address.`, `Hii ilishirikiwa na ${body.hint}. Ingia kwa barua pepe hiyo.`) : tr('The person who shared this asked you to sign in first.', 'Aliyeshiriki hii anakuomba uingie kwanza.'),
      action: html`<a class="btn btn-primary" href="#/login?next=${encodeURIComponent('/s/' + token)}">${t('common.signin')}</a>`,
    }));
    return;
  }
  if (status === 403) {
    wrap(emptyState({
      icon: 'lock', title: tr('This is shared with a different account', 'Hii imeshirikiwa na akaunti nyingine'),
      text: tr(`You are signed in as ${state.user?.email || 'another user'}. It was shared with ${body.hint || 'someone else'}.`, `Umeingia kama ${state.user?.email || 'mtumiaji mwingine'}. Ilishirikiwa na ${body.hint || 'mtu mwingine'}.`),
      action: html`<button class="btn btn-primary" id="so">${tr('Sign out and switch account', 'Toka na ubadilishe akaunti')}</button>`,
    }));
    ctx.view.querySelector('#so').onclick = async () => { await sb.auth.signOut(); location.hash = `#/login?next=${encodeURIComponent('/s/' + token)}`; location.reload(); };
    return;
  }
  if (status !== 200) {
    wrap(emptyState({
      icon: 'link', title: tr('This link no longer works', 'Kiungo hiki hakifanyi kazi tena'),
      text: tr('It may have expired or been revoked. Ask the sender for a new one.', 'Huenda kimeisha muda au kimefutwa. Muulize aliyekutumia kiungo kipya.'),
      action: html`<a class="btn btn-ghost" href="#/">${tr('Go to the public library', 'Nenda kwenye maktaba ya umma')}</a>`,
    }));
    return;
  }

  const { share: s, items } = body;
  mount(ctx.view, html`
    <section class="page-banner share-banner"><div class="container">
      <p class="banner-kicker">${raw(icon('share', 16))}${tr('Shared with you', 'Imeshirikiwa nawe')}</p>
      <h1>${s.title}</h1>
      ${s.note ? html`<p>${s.note}</p>` : ''}
      <p class="share-meta">${s.expires_at ? tr(`Available until ${fmtDate(s.expires_at)}`, `Inapatikana hadi ${fmtDate(s.expires_at)}`) : tr('No expiry date', 'Haina tarehe ya kuisha')}
        ${s.allow_download ? '' : html` · ${tr('Downloads are turned off', 'Kupakua kumezimwa')}`}</p>
    </div></section>
    <div class="container pad-lg">
      ${items.length ? html`<div class="asset-grid">${items.map((a, i) => html`
        <article class="asset-card">
          <button class="card-link card-btn" type="button" data-open="${i}">
            <span class="thumb cat-${a.category}">
              ${a.thumbnail_url ? html`<img src="${a.thumbnail_url}" alt="" loading="lazy">` : ''}
              <span class="thumb-ph">${raw(icon(CATEGORY_ICON[a.category] || 'file', 30))}</span>
              <span class="type-chip">${t('cat.' + a.category)}</span>
            </span>
            <span class="meta"><h3>${a.title}</h3><p>${fmtBytes(a.file_size)}</p></span>
          </button>
          ${a.download_url ? html`<a class="card-dl icon-btn" href="${a.download_url}" aria-label="${t('common.download')}" download>${raw(icon('download', 18))}</a>` : ''}
        </article>`)}</div>`
        : emptyState({ icon: 'folder', title: tr('Nothing to show', 'Hakuna cha kuonyesha'), text: tr('The shared files are no longer available.', 'Mafaili yaliyoshirikiwa hayapatikani tena.') })}
    </div>`);

  ctx.view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
    const a = items[+b.dataset.open];
    const m = openModal({
      title: a.title, size: 'xl',
      body: html`<div id="pv"></div>
        ${a.description ? html`<p class="muted-text">${a.description}</p>` : ''}
        ${a.usage_rights || a.copyright_holder ? html`<p class="small-note">${[a.copyright_holder, a.usage_rights].filter(Boolean).join(' · ')}</p>` : ''}`,
      footer: a.download_url ? html`<a class="btn btn-primary" href="${a.download_url}" download>${raw(icon('download', 18))}${t('common.download')}</a>` : '',
    });
    renderPreview(m.el.querySelector('#pv'), { category: a.category, mime: a.mime_type, url: a.view_url, thumb: a.thumbnail_url, title: a.title });
  }));
}
