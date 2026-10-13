// Approval Queue: assets waiting for review, and approved assets waiting to be published.
import { sb } from '../lib/supabase.js';
import { state, can, isAdmin, myRole, isManagerOf, canManageAsset } from '../lib/state.js';
import { html, raw, mount, fmtBytes, fmtDateTime, timeAgo } from '../lib/util.js';
import { t, tr } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { emptyState, assetThumb, confBadge, statusBadge } from '../lib/ui.js';
import { ASSET_LIST_SELECT, hydrateThumbs, friendlyError } from '../lib/api.js';
import { reviewAsset, publishAsset } from '../lib/actions.js';

export default async function approvals(ctx) {
  const canApprove = can('approve');
  const canPublish = can('publish');
  if (!canApprove && !canPublish) {
    mount(ctx.view, emptyState({ icon: 'lock', title: tr('Not available for your role', 'Haipatikani kwa wadhifa wako'),
      text: tr('Only reviewers and publishers can see the approval queue.', 'Wakaguzi na wachapishaji pekee ndio wanaoweza kuona foleni ya idhini.') }));
    return;
  }
  let tab = ctx.query.tab === 'publish' && canPublish ? 'publish' : canApprove ? 'review' : 'publish';

  mount(ctx.view, html`
    <div class="page-head"><div><h1>${t('nav.approvals')}</h1>
      <p>${tr('Approval decides whether a file is good for internal use. Publishing to the public library is a separate step.', 'Idhini huamua kama faili linafaa kwa matumizi ya ndani. Kuchapisha kwenye maktaba ya umma ni hatua tofauti.')}</p></div></div>
    <div class="toolbar"><div class="tabs" role="tablist">
      ${canApprove ? html`<button class="tab" role="tab" data-tab="review">${tr('Pending review', 'Zinasubiri ukaguzi')}<em class="count-pill" id="nR" hidden></em></button>` : ''}
      ${canPublish ? html`<button class="tab" role="tab" data-tab="publish">${tr('Approved, awaiting publish', 'Zimeidhinishwa, zinasubiri kuchapishwa')}<em class="count-pill" id="nP" hidden></em></button>` : ''}
    </div></div>
    <div id="list"><div class="spinner" role="status" aria-label="Loading"></div></div>`);
  const $q = (s) => ctx.view.querySelector(s);

  const statuses = [...(canApprove ? ['pending_review'] : []), ...(canPublish ? ['approved'] : [])];
  const { data, error } = await sb.from('assets').select(ASSET_LIST_SELECT + ',status_note').is('deleted_at', null)
    .in('status', statuses).order('updated_at', { ascending: true }).limit(200);
  if (!ctx.isCurrent()) return;
  if (error) { mount($q('#list'), emptyState({ icon: 'alert', title: tr('Could not load the queue', 'Imeshindwa kupakia foleni'), text: friendlyError(error) })); return; }
  const rows = data || [];

  const hist = new Map();
  if (rows.length) {
    const { data: h } = await sb.from('approval_history').select('id,asset_id,from_status,to_status,comment,created_at,actor:profiles!actor_id(full_name)')
      .in('asset_id', rows.map((r) => r.id)).order('created_at', { ascending: false });
    (h || []).forEach((x) => { if (!hist.has(x.asset_id)) hist.set(x.asset_id, []); hist.get(x.asset_id).push(x); });
  }
  if (!ctx.isCurrent()) return;

  const me = state.user.id;
  const mayReview = (a) => canApprove && (a.uploaded_by !== me || isAdmin()) && (myRole() !== 'project_manager' || isManagerOf(a.project_id));

  const card = (a, mode) => {
    const h = (hist.get(a.id) || []).slice(0, 8);
    const own = a.uploaded_by === me && !isAdmin();
    const needsPublic = a.confidentiality !== 'public';
    const blockPublish = needsPublic && !canManageAsset(a);
    return html`<article class="queue-item" data-id="${a.id}">
      <a class="qi-thumb" href="#/app/assets/${a.id}" aria-label="${a.title}">${assetThumb(a, { overlay: false })}</a>
      <div class="qi-main">
        <h3><a class="link" href="#/app/assets/${a.id}">${a.title}</a></h3>
        <p class="qi-meta">${[t('cat.' + a.category), a.project?.name, fmtBytes(a.file_size)].filter(Boolean).join(' · ')}</p>
        <p class="qi-meta">${raw(icon('user', 13))} ${a.uploader?.full_name || '—'} · ${tr('waiting since ', 'inasubiri tangu ')}${timeAgo(a.updated_at)}</p>
        <p class="qi-badges">${statusBadge(a.status)} ${confBadge(a.confidentiality)}</p>
        ${a.status_note ? html`<p class="qi-note">${a.status_note}</p>` : ''}
        ${mode === 'publish' && needsPublic ? html`<p class="hint-text">${blockPublish
          ? tr('Visibility is not Public. Only the owner or an administrator can make it Public before it is published.', 'Uonekanaji si wa Umma. Mmiliki au msimamizi pekee ndiye anayeweza kuliweka kuwa la Umma kabla ya kuchapishwa.')
          : tr('Publishing will change visibility to Public.', 'Kuchapisha kutabadilisha uonekanaji kuwa wa Umma.')}</p>` : ''}
        ${h.length ? html`<details class="qi-history"><summary>${raw(icon('history', 14))} ${tr('Approval history', 'Historia ya idhini')} (${h.length})</summary>
          <ul class="timeline">${h.map((x) => html`<li><b>${x.from_status ? t('status.' + x.from_status) + ' → ' : ''}${t('status.' + x.to_status)}</b>
            <small>${x.actor?.full_name || tr('System', 'Mfumo')} · ${fmtDateTime(x.created_at)}</small>${x.comment ? html`<p>${x.comment}</p>` : ''}</li>`)}</ul></details>` : ''}
      </div>
      <div class="qi-actions">
        ${mode === 'review' ? (mayReview(a) ? html`
          <button class="btn btn-primary btn-sm" data-act="approved">${raw(icon('check', 16))}${tr('Approve', 'Idhinisha')}</button>
          <button class="btn btn-ghost btn-sm" data-act="changes_requested">${raw(icon('message', 16))}${tr('Request changes', 'Omba marekebisho')}</button>
          <button class="btn btn-ghost btn-sm danger-text" data-act="rejected">${raw(icon('x', 16))}${tr('Reject', 'Kataa')}</button>`
          : html`<small class="hint-text">${own ? tr('You cannot review your own upload.', 'Huwezi kukagua ulichopakia mwenyewe.') : tr('You can review only assets of projects you manage.', 'Unaweza kukagua mali za miradi unayosimamia tu.')}</small>`)
          : html`<button class="btn btn-primary btn-sm" data-act="publish" ${blockPublish ? raw('disabled') : ''}>${raw(icon('globe', 16))}${tr('Publish', 'Chapisha')}</button>`}
        <a class="btn btn-ghost btn-sm" href="#/app/assets/${a.id}">${tr('Open', 'Fungua')}</a>
      </div>
    </article>`;
  };

  function paint() {
    const review = rows.filter((a) => a.status === 'pending_review');
    const pub = rows.filter((a) => a.status === 'approved');
    [['#nR', review.length], ['#nP', pub.length]].forEach(([s, n]) => { const el = $q(s); if (el) { el.textContent = n; el.hidden = !n; } });
    ctx.view.querySelectorAll('[data-tab]').forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    const list = tab === 'review' ? review : pub;
    if (!list.length) {
      mount($q('#list'), emptyState({ icon: 'check-circle',
        title: tab === 'review' ? tr('Nothing waiting for review', 'Hakuna kinachosubiri ukaguzi') : tr('Nothing waiting to be published', 'Hakuna kinachosubiri kuchapishwa'),
        text: tr('You are all caught up.', 'Umemaliza kila kitu.') }));
      return;
    }
    mount($q('#list'), html`<div class="queue-list">${list.map((a) => card(a, tab))}</div>`);
    hydrateThumbs($q('#list'));
  }
  ctx.view.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; paint(); }));
  $q('#list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = rows.find((x) => x.id === b.closest('[data-id]').dataset.id);
    if (!a) return;
    // Successful actions fire tv:changed, which re-renders this page with fresh data.
    if (b.dataset.act === 'publish') await publishAsset(a); else await reviewAsset(a, b.dataset.act);
  });
  paint();
}
