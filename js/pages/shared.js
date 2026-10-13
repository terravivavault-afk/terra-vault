// Shared Assets: what I have shared (staff) and what has been shared with me.
import { sb } from '../lib/supabase.js';
import { state, can, isStaff } from '../lib/state.js';
import { html, raw, mount, fmtDate, timeAgo } from '../lib/util.js';
import { t, tr } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { emptyState, assetThumb } from '../lib/ui.js';
import { hydrateThumbs, friendlyError } from '../lib/api.js';
import { shareListHtml, bindShareList } from '../lib/actions.js';

const SELECT = 'id,asset_id,collection_id,token,shared_with_email,allow_download,require_auth,expires_at,revoked_at,note,access_count,created_by,created_at,' +
  'asset:assets(id,title,category,thumbnail_path,file_size,confidentiality,status,deleted_at),' +
  'collection:collections(id,name,visibility),sharer:profiles!created_by(full_name)';

const isActive = (s) => !s.revoked_at && (!s.expires_at || new Date(s.expires_at) > new Date());
const daysLeft = (d) => Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);

function expiryText(s) {
  if (s.revoked_at) return tr('Access withdrawn', 'Ufikiaji umeondolewa');
  if (!s.expires_at) return tr('No expiry date', 'Haina tarehe ya mwisho');
  if (new Date(s.expires_at) < new Date()) return tr('Expired on ', 'Uliisha tarehe ') + fmtDate(s.expires_at);
  const n = daysLeft(s.expires_at);
  return n <= 1 ? tr('Expires today or tomorrow', 'Unaisha leo au kesho') : tr(`Expires in ${n} days (${fmtDate(s.expires_at)})`, `Unaisha baada ya siku ${n} (${fmtDate(s.expires_at)})`);
}

export default async function shared(ctx) {
  const staff = isStaff();
  const me = state.user.id;
  const myEmail = (state.user.email || state.profile?.email || '').toLowerCase();
  let tab = staff && ctx.query.tab === 'with' ? 'with' : staff ? 'by' : 'with';

  mount(ctx.view, html`
    <div class="page-head">
      <div><h1>${t('nav.shared')}</h1>
        <p>${staff ? tr('Links and invitations you have created, and items others have shared with you.', 'Viungo na mialiko uliyounda, na vitu ambavyo wengine wamekushirikisha.')
          : tr('Files and collections shared with you. Access ends when a share expires or is withdrawn.', 'Mafaili na mikusanyiko uliyoshirikiwa. Ufikiaji huisha ushiriki unapokwisha muda au ukiondolewa.')}</p></div>
    </div>
    ${staff ? html`<div class="toolbar"><div class="tabs" role="tablist">
      <button class="tab" role="tab" data-tab="by">${tr('Shared by me', 'Nilizoshiriki')}<em class="count-pill" id="nBy" hidden></em></button>
      <button class="tab" role="tab" data-tab="with">${tr('Shared with me', 'Niliyoshirikiwa')}<em class="count-pill" id="nWith" hidden></em></button>
    </div></div>` : ''}
    <div id="body"><div class="spinner" role="status" aria-label="Loading"></div></div>`);
  const $q = (s) => ctx.view.querySelector(s);
  const body = $q('#body');

  let all = [];
  async function load() {
    const safeEmail = myEmail.replace(/["\\]/g, '');
    // Admins can read every share; only fetch the ones that are theirs or addressed to them.
    const { data, error } = await sb.from('shares').select(SELECT)
      .or(`created_by.eq.${me}${safeEmail ? `,shared_with_email.eq."${safeEmail}"` : ''}`)
      .order('created_at', { ascending: false }).limit(300);
    if (!ctx.isCurrent()) return false;
    if (error) { mount(body, emptyState({ icon: 'alert', title: tr('Could not load shared items', 'Imeshindwa kupakia vilivyoshirikiwa'), text: friendlyError(error) })); return false; }
    all = data || [];
    return true;
  }
  const byMe = () => all.filter((s) => s.created_by === me);
  const withMe = () => all.filter((s) => s.created_by !== me && myEmail && (s.shared_with_email || '').toLowerCase() === myEmail);

  // ---- shared by me: group by target so each file/collection lists its shares
  function paintBy() {
    const mine = byMe();
    if (!mine.length) {
      mount(body, emptyState({
        icon: 'share', title: tr('You have not shared anything yet', 'Hujashiriki chochote bado'),
        text: can('share') ? tr('Open an asset or collection and choose Share to create a link or invite a named person.', 'Fungua mali au mkusanyiko kisha chagua Shiriki ili kuunda kiungo au kumwalika mtu aliyetajwa.') : tr('Your role does not include sharing.', 'Wadhifa wako hauruhusu kushiriki.'),
        action: html`<a class="btn btn-ghost" href="#/app/assets">${t('nav.assets')}</a>`,
      }));
      return;
    }
    const groups = new Map();
    mine.forEach((s) => {
      const key = s.asset_id || s.collection_id;
      if (!groups.has(key)) groups.set(key, { asset: s.asset, collection: s.collection, shares: [] });
      groups.get(key).shares.push(s);
    });
    mount(body, html`<div class="share-groups">${[...groups.values()].map((g) => {
      const active = g.shares.filter(isActive).length;
      const restricted = g.shares.some((s) => !s.allow_download);
      const title = g.asset?.title || g.collection?.name || tr('Item no longer available', 'Kitu hakipatikani tena');
      const href = g.asset ? `#/app/assets/${g.asset.id}` : g.collection ? `#/app/collections/${g.collection.id}` : '';
      return html`<section class="panel share-group">
        <header class="panel-head">
          <div class="sg-title">${g.asset ? assetThumb(g.asset, { overlay: false }) : html`<span class="sg-ic">${raw(icon('layers', 22))}</span>`}
            <span>${href ? html`<a class="link" href="${href}"><b>${title}</b></a>` : html`<b>${title}</b>`}
              <small>${g.asset ? tr('Asset', 'Mali') : tr('Collection', 'Mkusanyiko')} · ${active} ${tr('active', 'zinaendelea')}${restricted ? ' · ' + tr('download restricted', 'kupakua kumezuiwa') : ''}</small></span></div>
        </header>
        <div class="share-host">${shareListHtml(g.shares)}</div>
      </section>`;
    })}</div>`);
    hydrateThumbs(body);
  }

  // ---- shared with me
  function paintWith() {
    const rows = withMe();
    if (!rows.length) {
      mount(body, emptyState({
        icon: 'share', title: tr('Nothing has been shared with you', 'Hakuna kilichoshirikiwa nawe'),
        text: tr('When someone shares a file or collection with your email address, it will appear here.', 'Mtu akishiriki faili au mkusanyiko kwa barua pepe yako, utaonekana hapa.'),
      }));
      return;
    }
    const sorted = [...rows].sort((a, b) => Number(isActive(b)) - Number(isActive(a)));
    mount(body, html`<ul class="shared-with-list">${sorted.map((s) => {
      const active = isActive(s);
      const target = s.asset || s.collection;
      const title = s.asset?.title || s.collection?.name;
      const href = s.asset ? `#/app/assets/${s.asset.id}` : s.collection ? `#/app/collections/${s.collection.id}` : '';
      const label = active ? html`<span class="badge st-approved">${tr('Active', 'Hai')}</span>` : html`<span class="badge st-rejected">${s.revoked_at ? tr('Withdrawn', 'Imeondolewa') : tr('Expired', 'Imeisha')}</span>`;
      const inner = html`${s.asset ? assetThumb(s.asset, { overlay: false }) : html`<span class="sg-ic">${raw(icon(s.collection ? 'layers' : 'lock', 22))}</span>`}
        <span class="sw-main"><b>${title || tr('Item no longer available', 'Kitu hakipatikani tena')}</b>
          <small>${s.asset ? tr('Asset', 'Mali') : s.collection ? tr('Collection', 'Mkusanyiko') : ''}${s.sharer?.full_name ? ' · ' + tr('from ', 'kutoka kwa ') + s.sharer.full_name : ''} · ${timeAgo(s.created_at)}</small>
          <small class="${active && s.expires_at && daysLeft(s.expires_at) <= 3 ? 'warn-text' : ''}">${raw(icon('clock', 12))} ${expiryText(s)}</small>
          ${s.note ? html`<small class="sw-note">“${s.note}”</small>` : ''}</span>
        <span class="sw-flags">${label}${s.allow_download ? '' : html`<span class="badge" title="${tr('You can view this item but not download it', 'Unaweza kuona kitu hiki lakini huwezi kukipakua')}">${raw(icon('eye', 12))}${tr('View only', 'Kutazama tu')}</span>`}</span>`;
      return html`<li class="shared-with ${active ? '' : 'is-inactive'}">${active && href && target ? html`<a class="sw-link" href="${href}">${inner}</a>` : html`<div class="sw-link">${inner}</div>`}</li>`;
    })}</ul>`);
    hydrateThumbs(body);
  }

  function paint() {
    ctx.view.querySelectorAll('[data-tab]').forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    if (staff) {
      [['#nBy', byMe().filter(isActive).length], ['#nWith', withMe().filter(isActive).length]].forEach(([sel, n]) => { const el = $q(sel); el.textContent = n; el.hidden = !n; });
    }
    if (tab === 'by') paintBy(); else paintWith();
  }

  ctx.view.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; paint(); }));
  // The share list buttons (copy / revoke) are delegated from the stable body container.
  bindShareList(body, async () => { if (await load()) paint(); });

  if (await load()) paint();
}
