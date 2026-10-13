// Workspace dashboard. Every number comes from the database, never from sample data.
import { sb } from '../lib/supabase.js';
import { state, can, isAdmin } from '../lib/state.js';
import { html, raw, mount, fmtBytes, fmtNum, timeAgo, go, initials } from '../lib/util.js';
import { t, tr } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { donut, hbars, columns, PALETTE } from '../lib/charts.js';
import { assetThumb, statusBadge, emptyState, confBadge } from '../lib/ui.js';
import { ASSET_LIST_SELECT, hydrateThumbs } from '../lib/api.js';
import { actionLabel, CAT_COLOR } from '../lib/labels.js';
import { openUploader } from '../lib/uploader.js';

const mini = (a, { when = a.created_at, who = true } = {}) => html`
  <li><a class="mini" href="#/app/assets/${a.id}">${assetThumb(a, { overlay: false })}
    <span class="mini-t"><b>${a.title}</b>
      <small>${[a.project?.name, who ? a.uploader?.full_name : '', timeAgo(when)].filter(Boolean).join(' · ')}</small></span>
    ${statusBadge(a.status)}</a></li>`;

const panel = (title, body, { action = '', cls = '' } = {}) => html`
  <section class="panel ${cls}"><header class="panel-head"><h2>${title}</h2>${action}</header>${body}</section>`;

const stat = ({ label, value, icon: ic, href, tone = '', sub = '' }) => html`
  <a class="stat tone-${tone}" href="#${href}"><span class="stat-ic">${raw(icon(ic, 22))}</span>
    <span class="stat-num">${value}</span><span class="stat-lbl">${label}</span>${sub ? html`<small class="stat-sub">${sub}</small>` : ''}</a>`;

export default async function dashboard(ctx) {
  const first = (state.profile?.full_name || '').split(' ')[0];
  const canReview = can('approve') || can('publish');
  const recentSel = ASSET_LIST_SELECT;

  mount(ctx.view, html`
    <div class="page-head">
      <div><h1>${t('dash.title')}${first ? `, ${first}` : ''}</h1><p>${t('dash.subtitle')}</p></div>
      <div class="page-actions">
        ${can('upload') ? html`<button class="btn btn-primary" id="up">${raw(icon('upload', 18))}${t('common.upload')}</button>` : ''}
      </div>
    </div>
    <div class="grid-stats" id="stats">${Array.from({ length: 6 }, () => html`<div class="stat skel"></div>`)}</div>
    <div class="dash-grid" id="body"></div>`);
  ctx.view.querySelector('#up')?.addEventListener('click', () => openUploader());

  const base = () => sb.from('assets').select(recentSel).is('deleted_at', null);
  const [statsRes, recent, updated, pending, shares, published, notes, logs] = await Promise.all([
    sb.rpc('dashboard_stats'),
    base().order('created_at', { ascending: false }).limit(6),
    base().order('updated_at', { ascending: false }).limit(6),
    canReview
      ? base().eq('status', 'pending_review').order('updated_at', { ascending: true }).limit(5)
      : base().eq('uploaded_by', state.user.id).in('status', ['changes_requested', 'draft']).order('updated_at', { ascending: false }).limit(5),
    sb.from('shares').select('id,created_at,shared_with_email,expires_at,revoked_at,asset:assets(id,title),collection:collections(id,name)').order('created_at', { ascending: false }).limit(5),
    base().eq('status', 'published').order('published_at', { ascending: false }).limit(5),
    sb.from('notifications').select('id,title,body,link,read_at,created_at').order('created_at', { ascending: false }).limit(5),
    can('view_logs') ? sb.from('activity_logs').select('id,actor_name,action,entity_title,created_at').order('created_at', { ascending: false }).limit(8) : Promise.resolve({ data: null }),
  ]);
  if (!ctx.isCurrent()) return;

  const s = statsRes.data || {};
  const used = Number(s.storage_used || 0);
  const cap = Number(s.storage_quota || 0);
  const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;

  mount(ctx.view.querySelector('#stats'), html`
    ${stat({ label: t('dash.total'), value: fmtNum(s.total), icon: 'database', href: '/app/assets', tone: 'teal' })}
    ${stat({ label: t('dash.photos'), value: fmtNum(s.photos), icon: 'image', href: '/app/photos', tone: 'lagoon' })}
    ${stat({ label: t('dash.videos'), value: fmtNum(s.videos), icon: 'video', href: '/app/videos', tone: 'moss' })}
    ${stat({ label: t('dash.documents'), value: fmtNum(s.documents), icon: 'file', href: '/app/documents', tone: 'clay' })}
    ${stat({ label: t('dash.audio'), value: fmtNum(s.audio), icon: 'music', href: '/app/audio', tone: 'sage' })}
    ${stat({ label: t('dash.pending'), value: fmtNum(s.pending), icon: 'clock', href: canReview ? '/app/approvals' : '/app/assets?status=pending_review', tone: s.pending ? 'alert' : 'plain' })}`);

  const typeItems = ['photo', 'video', 'document', 'audio', 'other']
    .map((c) => ({ label: t('cat.' + c), value: Number({ photo: s.photos, video: s.videos, document: s.documents, audio: s.audio, other: s.other }[c] || 0), color: CAT_COLOR[c] }))
    .filter((i) => i.value > 0);
  const months = (s.by_month || []).map((m) => ({ label: m.month.slice(5), value: m.count }));
  const projects = (s.by_project || []).map((p, i) => ({ label: p.name, value: p.count, color: PALETTE[i % PALETTE.length] }));

  const list = (rows, opts, emptyMsg) => rows?.length
    ? html`<ul class="mini-list">${rows.map((a) => mini(a, opts))}</ul>`
    : html`<p class="panel-empty">${emptyMsg}</p>`;

  const sharesBody = (shares.data || []).length
    ? html`<ul class="mini-list">${shares.data.map((x) => html`<li><a class="mini" href="#/app/shared">
        <span class="mini-ic">${raw(icon('share', 18))}</span>
        <span class="mini-t"><b>${x.asset?.title || x.collection?.name || '—'}</b>
          <small>${x.shared_with_email || tr('Link', 'Kiungo')} · ${timeAgo(x.created_at)}</small></span></a></li>`)}</ul>`
    : html`<p class="panel-empty">${tr('Nothing shared yet.', 'Hakuna kilichoshirikiwa bado.')}</p>`;

  const noteBody = (notes.data || []).length
    ? html`<ul class="mini-list">${notes.data.map((n) => html`<li><a class="mini ${n.read_at ? '' : 'unread'}" href="#${n.link || '/app/notifications'}">
        <span class="mini-ic">${raw(icon('bell', 18))}</span><span class="mini-t"><b>${n.title}</b><small>${[n.body, timeAgo(n.created_at)].filter(Boolean).join(' · ')}</small></span></a></li>`)}</ul>`
    : html`<p class="panel-empty">${tr('You are all caught up.', 'Hakuna arifa mpya.')}</p>`;

  const storage = html`
    <div class="storage">
      <div class="storage-top"><b>${fmtBytes(used)}</b><span>${cap ? tr(`of ${fmtBytes(cap)}`, `kati ya ${fmtBytes(cap)}`) : ''}</span></div>
      <div class="meter ${pct > 90 ? 'hot' : pct > 75 ? 'warm' : ''}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
      <p class="muted-text">${cap ? tr(`${fmtBytes(Math.max(0, cap - used))} available`, `${fmtBytes(Math.max(0, cap - used))} zinapatikana`) : tr('No storage limit set.', 'Hakuna kikomo cha hifadhi.')}</p>
    </div>`;

  mount(ctx.view.querySelector('#body'), html`
    ${panel(t('dash.bytype'), (s.total ? donut(typeItems, { center: fmtNum(s.total), centerLabel: tr('assets', 'mali') }) : html`<p class="panel-empty">${tr('Upload your first file to see the split by type.', 'Pakia faili lako la kwanza kuona mgawanyo kwa aina.')}</p>`), { cls: 'span-4' })}
    ${panel(t('dash.bymonth'), columns(months, { height: 170 }), { cls: 'span-5' })}
    ${panel(t('dash.storage'), storage, { cls: 'span-3' })}

    ${panel(canReview ? t('dash.pending') : tr('Needs your attention', 'Yanahitaji umakini wako'),
      list(pending.data, { when: pending.data?.[0]?.updated_at }, canReview ? tr('Nothing is waiting for review.', 'Hakuna kinachosubiri ukaguzi.') : tr('No drafts or requested changes.', 'Hakuna rasimu wala marekebisho yaliyoombwa.')),
      { cls: 'span-4', action: canReview ? html`<a class="link" href="#/app/approvals">${tr('Open queue', 'Fungua foleni')}</a>` : '' })}
    ${panel(t('dash.recent'), list(recent.data, {}, tr('No uploads yet.', 'Hakuna upakiaji bado.')), { cls: 'span-4', action: html`<a class="link" href="#/app/assets">${tr('All assets', 'Mali zote')}</a>` })}
    ${panel(t('dash.updated'), list(updated.data, { when: undefined }, tr('Nothing updated yet.', 'Hakuna kilichosasishwa bado.')), { cls: 'span-4' })}

    ${panel(t('dash.published'), list(published.data, { when: published.data?.[0]?.published_at, who: false }, tr('Nothing is published yet.', 'Hakuna kilichochapishwa bado.')), { cls: 'span-4' })}
    ${panel(t('dash.shared'), sharesBody, { cls: 'span-4', action: html`<a class="link" href="#/app/shared">${t('nav.shared')}</a>` })}
    ${panel(t('dash.notifications'), noteBody, { cls: 'span-4', action: html`<a class="link" href="#/app/notifications">${tr('See all', 'Ona zote')}</a>` })}

    ${panel(t('dash.byproject'), hbars(projects), { cls: 'span-6' })}
    ${isAdmin() || can('view_logs')
      ? panel(t('dash.activity'), (logs.data || []).length
          ? html`<ul class="activity">${logs.data.map((l) => html`<li><span class="avatar" aria-hidden="true">${initials(l.actor_name || '?')}</span>
              <span><b>${l.actor_name || tr('Someone', 'Mtu')}</b> ${actionLabel(l.action)} ${l.entity_title ? html`<em>${l.entity_title}</em>` : ''}<small>${timeAgo(l.created_at)}</small></span></li>`)}</ul>`
          : html`<p class="panel-empty">${tr('No activity yet.', 'Hakuna shughuli bado.')}</p>`,
        { cls: 'span-6', action: can('view_logs') ? html`<a class="link" href="#/app/reports">${tr('Full log', 'Kumbukumbu kamili')}</a>` : '' })
      : ''}
    ${isAdmin() ? panel(tr('Library at a glance', 'Maktaba kwa muhtasari'), html`
      <dl class="glance">
        <div><dt>${fmtNum(s.published)}</dt><dd>${tr('published publicly', 'zilizochapishwa kwa umma')}</dd></div>
        <div><dt>${fmtNum(s.active_shares)}</dt><dd>${tr('active shares', 'ushiriki unaoendelea')}</dd></div>
        <div><dt>${fmtNum(s.downloads)}</dt><dd>${tr('downloads recorded', 'upakuaji uliorekodiwa')}</dd></div>
        <div><dt>${fmtNum(s.users)}</dt><dd>${tr('team members', 'wanachama wa timu')}</dd></div>
        <div><dt>${fmtNum(s.trashed)}</dt><dd>${tr('items in trash', 'vipengee kwenye taka')}</dd></div>
      </dl>`, { cls: 'span-12' }) : ''}`);

  hydrateThumbs(ctx.view);
}
