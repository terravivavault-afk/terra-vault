// Public detail page for one published asset. No private filenames or internal fields appear here.
import { sb } from '../lib/supabase.js';
import { html, raw, mount, fmtBytes, fmtDate, extOf, copyText, slugify } from '../lib/util.js';
import { t, tr } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { assetCard, emptyState, programName, toast, withBusy } from '../lib/ui.js';
import { PUBLIC_ASSET_SELECT, signedUrls, downloadAsset, hydrateThumbs } from '../lib/api.js';
import { renderPreview } from '../lib/preview.js';
import { cdnUrl, cdnThumb } from '../lib/cloudinary.js';

export default async function publicAsset(ctx) {
  const { data: a } = await sb.from('assets').select(PUBLIC_ASSET_SELECT)
    .eq('id', ctx.id).eq('status', 'published').is('deleted_at', null).maybeSingle();
  if (!ctx.isCurrent()) return;
  if (!a) {
    mount(ctx.view, html`<div class="container pad-xl">${emptyState({
      icon: 'lock', title: tr('This item is not available', 'Kipengee hiki hakipatikani'),
      text: tr('It may have been unpublished or the link is wrong.', 'Huenda kimeondolewa au kiungo si sahihi.'),
      action: html`<a class="btn btn-primary" href="#/explore">${tr('Browse the library', 'Tazama maktaba')}</a>`,
    })}</div>`);
    return;
  }

  const tagNames = (a.asset_tags || []).map((x) => x.tag?.name).filter(Boolean);
  const place = [a.district, a.region, a.country].filter(Boolean).join(', ');
  const kv = [
    [tr('Published', 'Imechapishwa'), fmtDate(a.published_at)],
    [tr('Topic', 'Mada'), a.program ? programName(a.program) : ''],
    [tr('Project', 'Mradi'), a.project?.name],
    [tr('Credit', 'Shukrani'), a.creator],
    [tr('Copyright', 'Hakimiliki'), a.copyright_holder],
    [tr('Place', 'Mahali'), place],
    [tr('File', 'Faili'), `${t('cat.' + a.category)} · ${fmtBytes(a.file_size)}`],
  ].filter(([, v]) => v);

  mount(ctx.view, html`
    <div class="container asset-page pad-lg">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#/explore">${t('pub.nav.explore')}</a>${raw(icon('chevron-right', 14))}<span>${a.title}</span></nav>
      <div class="asset-layout">
        <div class="asset-stage"><div id="preview" class="preview loading"><div class="spinner"></div></div></div>
        <aside class="asset-side">
          <h1>${a.title}</h1>
          ${a.description ? html`<p class="asset-desc">${a.description}</p>` : ''}
          <div class="side-actions">
            ${a.public_download ? html`<button class="btn btn-primary" id="dl">${raw(icon('download', 18))}${t('common.download')}</button>` : ''}
            <button class="btn btn-ghost" id="copy">${raw(icon('link', 18))}${tr('Copy link', 'Nakili kiungo')}</button>
          </div>
          <dl class="kv">${kv.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
          ${a.usage_rights ? html`<div class="note-box"><b>${tr('Usage terms', 'Masharti ya matumizi')}</b><p>${a.usage_rights}</p></div>` : ''}
          ${tagNames.length ? html`<div class="chips chips-static">${tagNames.map((n) => html`<span class="chip">${n}</span>`)}</div>` : ''}
        </aside>
      </div>
      <section class="related" id="related" hidden>
        <h2>${tr('More like this', 'Zaidi kama hiki')}</h2><div id="relatedGrid"></div>
      </section>
    </div>`);

  document.title = `${a.title} · TerraVault`;
  const urls = await signedUrls([a.storage_path, a.thumbnail_path]);
  if (!ctx.isCurrent()) return;
  const host = ctx.view.querySelector('#preview');
  host.classList.remove('loading');
  await renderPreview(host, { category: a.category, mime: a.mime_type, url: cdnUrl(a) || urls.get(a.storage_path), thumb: cdnThumb(a, 1280, 720) || urls.get(a.thumbnail_path), title: a.title });

  ctx.view.querySelector('#dl')?.addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    try {
      await downloadAsset(a, { filename: `${slugify(a.title) || 'terraviva'}.${extOf(a.storage_path) || 'file'}` });
    } catch (err) { toast(err.message, 'error'); }
  }));
  ctx.view.querySelector('#copy').addEventListener('click', async () => {
    await copyText(location.href); toast(tr('Link copied.', 'Kiungo kimenakiliwa.'), 'success');
  });

  sb.rpc('track_asset_event', { p_asset: a.id, p_kind: 'view' }).then(() => {}, () => {});

  // Related items from the same programme
  if (a.program?.id) {
    const { data } = await sb.from('assets').select(PUBLIC_ASSET_SELECT).eq('status', 'published').is('deleted_at', null)
      .eq('program_id', a.program.id).neq('id', a.id).order('published_at', { ascending: false }).limit(4);
    if (ctx.isCurrent() && data?.length) {
      ctx.view.querySelector('#related').hidden = false;
      const g = ctx.view.querySelector('#relatedGrid');
      mount(g, html`<div class="asset-grid">${data.map((x) => assetCard(x, { href: `#/library/${x.id}`, showStatus: false }))}</div>`);
      hydrateThumbs(g);
    }
  }
}
