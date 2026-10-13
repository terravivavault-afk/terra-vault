// Reusable UI building blocks.
import { html, raw, esc, $, fmtBytes, fmtDate, CATEGORY_ICON, initials } from './util.js';
import { icon } from './icons.js';
import { t, getLang } from './i18n.js';
import { cdnThumb } from './cloudinary.js';

// ------------------------------------------------------------------ toasts
export function toast(message, type = 'info', ms = 4200) {
  let host = $('#toasts');
  if (!host) { host = Object.assign(document.createElement('div'), { id: 'toasts' }); document.body.appendChild(host); }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `${icon(type === 'error' ? 'alert' : type === 'success' ? 'check-circle' : 'info', 18)}<span>${esc(message)}</span>`;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 250); }, ms);
}

// ------------------------------------------------------------------ modal
export function openModal({ title, body = '', footer = '', size = 'md', onClose } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = html`
    <div class="modal modal-${size}" role="dialog" aria-modal="true" aria-label="${title}">
      <header class="modal-head"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Close">${raw(icon('x', 20))}</button></header>
      <div class="modal-body">${body}</div>
      ${footer ? html`<footer class="modal-foot">${footer}</footer>` : ''}
    </div>`.s;
  const prevFocus = document.activeElement;
  const close = (result) => {
    document.removeEventListener('keydown', onKey);
    overlay.classList.remove('in');
    setTimeout(() => overlay.remove(), 180);
    document.body.classList.remove('modal-open');
    prevFocus?.focus?.();
    onClose?.(result);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close()));
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => { overlay.classList.add('in'); overlay.querySelector('input,select,textarea,button:not([data-close])')?.focus(); });
  return { el: overlay, body: overlay.querySelector('.modal-body'), close };
}

export function confirmDialog({ title = 'Are you sure?', message = '', confirmText = t('common.confirm'), danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title, size: 'sm',
      body: html`<p class="muted-text">${message}</p>`,
      footer: html`<button class="btn btn-ghost" data-close>${t('common.cancel')}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${confirmText}</button>`,
      onClose: () => { if (!done) resolve(false); },
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => { done = true; m.close(); resolve(true); });
  });
}

export function promptDialog({ title, label, placeholder = '', required = false, multiline = true, confirmText = t('common.confirm'), value = '', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title, size: 'sm',
      body: html`<label class="field"><span class="label">${label}${required ? raw(' <b class="req">*</b>') : ''}</span>
        ${multiline ? html`<textarea class="input" rows="4" placeholder="${placeholder}" maxlength="1000">${value}</textarea>`
          : html`<input class="input" placeholder="${placeholder}" value="${value}" maxlength="300">`}</label>
        <p class="field-error" hidden></p>`,
      footer: html`<button class="btn btn-ghost" data-close>${t('common.cancel')}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${confirmText}</button>`,
      onClose: () => { if (!done) resolve(null); },
    });
    const input = m.el.querySelector('textarea,input');
    m.el.querySelector('[data-ok]').addEventListener('click', () => {
      const v = input.value.trim();
      if (required && !v) { const e = m.el.querySelector('.field-error'); e.textContent = 'This field is required.'; e.hidden = false; return; }
      done = true; m.close(); resolve(v);
    });
  });
}

// ------------------------------------------------------------------ small pieces
export const statusBadge = (s) => html`<span class="badge st-${s}">${t('status.' + s)}</span>`;
export const confBadge = (c) => html`<span class="badge conf-${c}">${raw(c === 'public' ? icon('globe', 12) : icon('lock', 12))}${t('conf.' + c)}</span>`;
export const avatar = (name, cls = '') => html`<span class="avatar ${cls}" aria-hidden="true">${initials(name)}</span>`;
export const programName = (p) => (p ? (getLang() === 'sw' && p.name_sw ? p.name_sw : p.name) : '');

export function emptyState({ icon: ic = 'folder', title, text = '', action = '' } = {}) {
  return html`<div class="empty"><div class="empty-ic">${raw(icon(ic, 28))}</div><h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}${action}</div>`;
}
export function skeletonGrid(n = 8) {
  return html`<div class="asset-grid">${Array.from({ length: n }, () => html`<div class="asset-card skel"><div class="thumb"></div><div class="meta"><i></i><i class="short"></i></div></div>`)}</div>`;
}
export const spinner = () => html`<div class="spinner" role="status" aria-label="Loading"></div>`;

export function options(list, selected, { value = (x) => x.id, label = (x) => x.name, blank } = {}) {
  return html`${blank != null ? html`<option value="">${blank}</option>` : ''}${list.map((x) => html`<option value="${value(x)}" ${String(value(x)) === String(selected ?? '') ? raw('selected') : ''}>${label(x)}</option>`)}`;
}

export function pagination({ page, total, pageSize }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return html``;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return html`<nav class="pager" aria-label="Pagination">
    <button class="btn btn-ghost btn-sm" data-page="${page - 1}" ${page <= 1 ? raw('disabled') : ''}>${raw(icon('chevron-left', 16))}</button>
    <span>${from}–${to} / ${total}</span>
    <button class="btn btn-ghost btn-sm" data-page="${page + 1}" ${page >= pages ? raw('disabled') : ''}>${raw(icon('chevron-right', 16))}</button>
  </nav>`;
}

// ------------------------------------------------------------------ asset cards / rows
export function assetThumb(a, { overlay = true } = {}) {
  const cat = a.category || 'other';
  return html`<span class="thumb cat-${cat}">
    ${cdnThumb(a) ? html`<img src="${cdnThumb(a)}" alt="" loading="lazy" decoding="async" onerror="this.closest('.thumb')?.classList.add('no-img');this.remove()">`
      : a.thumbnail_path ? html`<img data-thumb="${a.thumbnail_path}" alt="" loading="lazy" decoding="async">` : ''}
    <span class="thumb-ph">${raw(icon(CATEGORY_ICON[cat], 30))}</span>
    ${overlay ? html`<span class="type-chip">${t('cat.' + cat)}</span>` : ''}
  </span>`;
}

export function assetCard(a, { href, selectable = false, selected = false, showStatus = true } = {}) {
  const link = href || `#/app/assets/${a.id}`;
  return html`<article class="asset-card ${selected ? 'is-selected' : ''}" data-id="${a.id}">
    ${selectable ? html`<label class="select-box" title="Select"><input type="checkbox" data-select="${a.id}" ${selected ? raw('checked') : ''}><span></span></label>` : ''}
    <a class="card-link" href="${link}">
      ${assetThumb(a)}
      <span class="card-flags">
        ${showStatus && a.status ? statusBadge(a.status) : ''}
        ${a.confidentiality && a.confidentiality !== 'public' && a.confidentiality !== 'internal' ? html`<span class="flag-lock" title="${t('conf.' + a.confidentiality)}">${raw(icon('lock', 13))}</span>` : ''}
      </span>
      <span class="meta">
        <h3>${a.title}</h3>
        <p>${[a.project?.name, fmtBytes(a.file_size), fmtDate(a.created_at, { day: 'numeric', month: 'short' })].filter(Boolean).join(' · ')}</p>
      </span>
    </a>
  </article>`;
}

export function assetRow(a, { selectable = false, selected = false } = {}) {
  return html`<tr class="asset-row" data-id="${a.id}">
    ${selectable ? html`<td class="col-check"><label class="select-box"><input type="checkbox" data-select="${a.id}" ${selected ? raw('checked') : ''}><span></span></label></td>` : ''}
    <td><a class="row-title" href="#/app/assets/${a.id}">${assetThumb(a, { overlay: false })}<span><b>${a.title}</b><small>${a.filename || ''}</small></span></a></td>
    <td>${t('cat.' + a.category)}</td>
    <td>${a.project?.name || '—'}</td>
    <td>${statusBadge(a.status)}</td>
    <td>${confBadge(a.confidentiality)}</td>
    <td>${fmtBytes(a.file_size)}</td>
    <td>${a.uploader?.full_name || '—'}</td>
    <td>${fmtDate(a.created_at)}</td>
  </tr>`;
}

// ------------------------------------------------------------------ tag input
export function tagInput(host, { all = [], selected = [], canCreate = false, placeholder = 'Add a tag…' } = {}) {
  let tags = [...selected];
  host.classList.add('tag-input');
  host.innerHTML = `<div class="chips"></div><input list="tv-taglist" placeholder="${esc(placeholder)}" aria-label="Add tag"><datalist id="tv-taglist">${all.map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist>`;
  const chips = host.querySelector('.chips');
  const input = host.querySelector('input');
  const paint = () => {
    chips.innerHTML = tags.map((n, i) => `<span class="chip">${esc(n)}<button type="button" data-rm="${i}" aria-label="Remove ${esc(n)}">${icon('x', 12)}</button></span>`).join('');
  };
  const add = (name) => {
    name = name.trim();
    if (!name) return;
    const known = all.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!known && !canCreate) { toast('Choose one of the standard tags.', 'error'); return; }
    const final = known ? known.name : name;
    if (!tags.some((x) => x.toLowerCase() === final.toLowerCase())) tags.push(final);
    input.value = ''; paint();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input.value.replace(/,/g, '')); } });
  input.addEventListener('change', () => { if (all.some((x) => x.name === input.value)) add(input.value); });
  input.addEventListener('blur', () => { if (input.value.trim()) add(input.value); });
  chips.addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { tags.splice(+b.dataset.rm, 1); paint(); } });
  paint();
  return { get: () => [...tags], set: (v) => { tags = [...v]; paint(); } };
}

// ------------------------------------------------------------------ dropdown menu helper
export function closeOnOutside(menu, trigger) {
  const handler = (e) => { if (!menu.contains(e.target) && !trigger.contains(e.target)) { menu.hidden = true; document.removeEventListener('click', handler); } };
  setTimeout(() => document.addEventListener('click', handler), 0);
}

export function formData(form) {
  const out = {};
  new FormData(form).forEach((v, k) => { out[k] = typeof v === 'string' ? v.trim() : v; });
  form.querySelectorAll('input[type=checkbox][name]').forEach((c) => { out[c.name] = c.checked; });
  return out;
}
export const nullIfEmpty = (v) => (v === '' || v === undefined ? null : v);

export async function withBusy(btn, fn) {
  const label = btn.innerHTML;
  btn.disabled = true; btn.classList.add('busy');
  try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('busy'); btn.innerHTML = label; }
}
