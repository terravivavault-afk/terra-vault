// Full notifications list: filter unread, mark read, mark all read, follow the link.
import { sb } from '../lib/supabase.js';
import { html, raw, mount, timeAgo, fmtDateTime, replaceHash } from '../lib/util.js';
import { t, tr } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { emptyState, toast, withBusy, pagination } from '../lib/ui.js';
import { friendlyError } from '../lib/api.js';
import { refreshChrome } from '../shell.js';

const PAGE = 25;

export default async function notifications(ctx) {
  let unreadOnly = ctx.query.filter === 'unread';
  let page = Math.max(1, +ctx.query.page || 1);
  let unread = 0;

  mount(ctx.view, html`
    <div class="page-head"><div><h1>${t('dash.notifications')}</h1>
      <p>${tr('Updates about your files, reviews and shares.', 'Taarifa kuhusu mafaili yako, ukaguzi na ushiriki.')}</p></div>
      <div class="page-actions"><button class="btn btn-ghost" id="readAll" disabled>${raw(icon('check-circle', 18))}${tr('Mark all read', 'Weka zote zimesomwa')}</button></div></div>
    <div class="toolbar"><div class="seg" role="group" aria-label="${tr('Filter', 'Chuja')}">
      <button type="button" data-f="all" class="${unreadOnly ? '' : 'on'}">${t('common.all')}</button>
      <button type="button" data-f="unread" class="${unreadOnly ? 'on' : ''}">${tr('Unread', 'Zisizosomwa')}<em class="count-pill" id="ucount" hidden></em></button></div></div>
    <div id="list"></div><div id="pager"></div>`);
  const $q = (s) => ctx.view.querySelector(s);
  const list = $q('#list');

  async function load() {
    mount(list, html`<div class="view-loading"><div class="spinner" role="status" aria-label="Loading"></div></div>`);
    let q = sb.from('notifications').select('id,title,body,link,read_at,created_at', { count: 'exact' });
    if (unreadOnly) q = q.is('read_at', null);
    const from = (page - 1) * PAGE;
    const [res, un] = await Promise.all([
      q.order('created_at', { ascending: false }).range(from, from + PAGE - 1),
      sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
    ]);
    if (!ctx.isCurrent()) return;
    if (res.error) {
      mount(list, emptyState({ icon: 'alert', title: tr('Could not load notifications', 'Imeshindwa kupakia arifa'), text: friendlyError(res.error), action: html`<button class="btn btn-primary" id="retry">${tr('Try again', 'Jaribu tena')}</button>` }));
      $q('#retry').addEventListener('click', load);
      return;
    }
    unread = un.count || 0;
    const c = $q('#ucount'); c.hidden = !unread; c.textContent = unread;
    $q('#readAll').disabled = !unread;
    const rows = res.data || [];
    if (!rows.length) {
      mount(list, emptyState({
        icon: 'bell', title: unreadOnly ? tr('You are all caught up', 'Hakuna arifa mpya') : tr('No notifications yet', 'Hakuna arifa bado'),
        text: unreadOnly ? tr('Nothing unread right now.', 'Hakuna ambazo hazijasomwa kwa sasa.') : tr('We will let you know when something needs your attention.', 'Tutakujulisha kitu kikihitaji umakini wako.'),
      }));
    } else {
      mount(list, html`<ul class="notif-list notif-page">${rows.map((n) => html`<li class="notif-item ${n.read_at ? '' : 'unread'}" data-id="${n.id}">
        <a class="mini ${n.read_at ? '' : 'unread'}" href="#${n.link || '/app/notifications'}" data-open="${n.id}" data-link="${n.link || ''}">
          <span class="mini-ic">${raw(icon('bell', 18))}</span>
          <span class="mini-t"><b>${n.title}</b>${n.body ? html`<span>${n.body}</span>` : ''}<small title="${fmtDateTime(n.created_at)}">${timeAgo(n.created_at)}</small></span></a>
        ${n.read_at ? '' : html`<button class="btn btn-ghost btn-sm" data-read="${n.id}">${raw(icon('check', 15))}${tr('Mark read', 'Weka imesomwa')}</button>`}
      </li>`)}</ul>`);
    }
    mount($q('#pager'), pagination({ page, total: res.count || 0, pageSize: PAGE }));
  }

  async function markRead(id) {
    const { error } = await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null);
    if (error) { toast(friendlyError(error), 'error'); return false; }
    refreshChrome();
    return true;
  }

  $q('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    unreadOnly = b.dataset.f === 'unread'; page = 1;
    ctx.view.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b));
    replaceHash(ctx.path, { filter: unreadOnly ? 'unread' : '' });
    load();
  });
  $q('#readAll').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const { error } = await sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
    if (error) { toast(friendlyError(error), 'error'); return; }
    toast(tr('All notifications marked as read.', 'Arifa zote zimewekwa zimesomwa.'), 'success');
    refreshChrome(); await load();
  }));
  $q('#pager').addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (b) { page = +b.dataset.page; load(); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
  list.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-read]');
    if (r) { if (await markRead(r.dataset.read)) await load(); return; }
    const a = e.target.closest('[data-open]');
    if (a) {
      // The link navigates by itself; mark as read in the background.
      if (a.closest('.unread')) markRead(a.dataset.open);
      if (!a.dataset.link) { e.preventDefault(); await load(); }
    }
  });
  await load();
}
