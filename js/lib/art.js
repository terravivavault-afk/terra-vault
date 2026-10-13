// Brand artwork: the layered landscape from the Terraviva emblem, drawn as SVG.
// Sky, lagoon, fields and soil stack up as bands; a pale disc rises behind the hills.
import { raw } from './util.js';

export const BRAND = { teal: '#006E70', lagoon: '#16B3A8', moss: '#4A7023', sage: '#84A85C', clay: '#C4874A', cream: '#FEFFF1' };

/** Full scene. Sits behind hero copy; slices to fill any box. */
export function landscape({ sprout = true } = {}) {
  return raw(`<svg class="landscape" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
    <rect width="1200" height="600" fill="${BRAND.teal}"/>
    <g fill="${BRAND.cream}" opacity=".9">
      <circle cx="132" cy="96" r="4"/><circle cx="238" cy="150" r="3"/><circle cx="352" cy="70" r="5"/>
      <circle cx="470" cy="128" r="3"/><circle cx="560" cy="64" r="4"/><circle cx="96" cy="214" r="3"/>
    </g>
    <circle cx="905" cy="270" r="170" fill="${BRAND.cream}" opacity=".96"/>
    <path d="M830 220c20-28 62-34 86-14 18 14 8 36-8 44-22 10-30 38-52 34-22-4-40-40-26-64Z" fill="${BRAND.moss}"/>
    <path d="M960 184c14-8 36-4 42 10 6 12-6 22-18 22-14 0-34-18-24-32Z" fill="${BRAND.moss}"/>
    <path d="M0 330C180 270 360 360 590 300S980 250 1200 300V600H0Z" fill="${BRAND.lagoon}"/>
    <path d="M0 400C220 340 420 450 700 385S1040 340 1200 380V600H0Z" fill="${BRAND.moss}"/>
    <path d="M0 470C260 420 470 520 760 462S1080 430 1200 458V600H0Z" fill="${BRAND.sage}"/>
    <path d="M0 540C240 506 520 580 800 536S1100 512 1200 530V600H0Z" fill="${BRAND.clay}"/>
    ${sprout ? `<g transform="translate(250 262)" fill="${BRAND.moss}" stroke="${BRAND.cream}" stroke-width="6" stroke-linejoin="round">
      <path d="M0 150V60" stroke="${BRAND.cream}" stroke-width="7" stroke-linecap="round" fill="none"/>
      <path d="M0 62C-22 40-18 6 0-18 18 6 22 40 0 62Z"/>
      <path d="M-4 96C-40 98-66 76-70 48-34 46-8 64-4 96Z"/>
      <path d="M4 84C40 86 66 64 70 36 34 34 8 52 4 84Z"/>
    </g>` : ''}
  </svg>`);
}

/** Thin four-band strip used as a quiet signature on cards and footers. */
export const strataStrip = () => raw('<span class="strata-strip" aria-hidden="true"><i></i><i></i><i></i><i></i></span>');
