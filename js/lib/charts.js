// Tiny dependency-free SVG charts in the Terraviva palette.
import { html, raw, esc, fmtNum } from './util.js';

export const PALETTE = ['#007C7E', '#4A7023', '#C4874A', '#16B3A8', '#84A85C', '#B5547A', '#3B5F73', '#9AA58A'];

export function donut(items, { size = 168, thickness = 26, center = '', centerLabel = '' } = {}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const arcs = total
    ? items.filter((i) => i.value > 0).map((i) => {
        const len = (i.value / total) * circ;
        const seg = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${i.color}" stroke-width="${thickness}" stroke-dasharray="${Math.max(0, len - 2)} ${circ - Math.max(0, len - 2)}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${c} ${c})"><title>${esc(i.label)}: ${fmtNum(i.value)}</title></circle>`;
        offset += len;
        return seg;
      }).join('')
    : `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#E7EBD9" stroke-width="${thickness}"/>`;
  return html`<div class="donut">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Distribution chart">${raw(arcs)}
      <text x="${c}" y="${c - 2}" text-anchor="middle" class="donut-num">${center}</text>
      <text x="${c}" y="${c + 16}" text-anchor="middle" class="donut-lbl">${centerLabel}</text></svg>
    <ul class="legend">${items.map((i) => html`<li><i style="background:${i.color}"></i><span>${i.label}</span><b>${fmtNum(i.value)}</b></li>`)}</ul>
  </div>`;
}

export function hbars(items, { color = '#007C7E' } = {}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return html`<p class="muted-text">No data yet.</p>`;
  return html`<ul class="hbars">${items.map((i) => html`<li>
    <span class="hb-label" title="${i.label}">${i.label}</span>
    <span class="hb-track"><span class="hb-fill" style="width:${Math.max(3, (i.value / max) * 100)}%;background:${i.color || color}"></span></span>
    <b>${fmtNum(i.value)}</b></li>`)}</ul>`;
}

export function columns(items, { height = 150, color = '#007C7E' } = {}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const w = 100 / Math.max(1, items.length);
  return html`<div class="cols" style="height:${height}px" role="img" aria-label="Column chart">
    ${items.map((i) => html`<div class="col" style="width:${w}%" title="${i.label}: ${fmtNum(i.value)}">
      <span class="col-val">${i.value || ''}</span>
      <span class="col-bar" style="height:${Math.max(i.value ? 6 : 2, (i.value / max) * (height - 46))}px;background:${color}"></span>
      <span class="col-lbl">${i.label}</span></div>`)}
  </div>`;
}
