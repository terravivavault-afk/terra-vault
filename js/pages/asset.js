// Asset details: preview, metadata, workflow, versions, history, sharing and comments.
import { sb } from '../lib/supabase.js';
import { state, can, isAdmin, canManageAsset, canEditAsset } from '../lib/state.js';
import { html, raw, mount, fmtBytes, fmtDate, fmtDateTime, timeAgo, copyText, initials, fmtNum } from '../lib/util.js';
import { t, tr, getLang } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { statusBadge, confBadge, emptyState, toast, withBusy, programName, confirmDialog } from '../lib/ui.js';
import { signedUrls, downloadAsset, friendlyError, ref, makeThumbnailFromUrl, uploadThumbnail } from '../lib/api.js';
import { renderPreview } from '../lib/preview.js';
import * as act from '../lib/actions.js';

const SELECT = `*, project:projects(id,name), program:program_areas(id,name,name_sw,color),
  uploader:profiles!uploaded_by(full_name,email), publisher:profiles!published_by(full_name),
  asset_tags(tag:tags(id,name)), stats:asset_stats(views,downloads)`;

const kvRow = (k, v) => (v === null || v === undefined || v === '' ? '' : html`<div><dt>${k}</dt><dd>${v}</dd></div>`);

export default async function assetPage(ctx) {
  const { data: a } = await sb.from('assets').select(SELECT).eq('id', ctx.id).maybeSingle();
  if (!ctx.isCurrent()) return;
  if (!a) {
    mount(ctx.view, emptyState({
      icon: 'lock', title: tr('Asset not found', 'Mali haijapatikana'),
      text: tr('It may have been deleted, or you may not have permission to see it.', 'Huenda imefutwa, au huna ruhusa ya kuiona.'),
      action: html`<a class="btn btn-primary" href="#/app/assets">${tr('Back to assets', 'Rudi kwenye mali')}</a>`,
    }));
    return;
  }

  const me = state.user.id;
  const manage = canManageAsset(a);
  const edit = canEditAsset(a);
  const trashed = !!a.deleted_at;
  const stats = Array.isArray(a.stats) ? a.stats[0] : a.stats;
  const tagNames = (a.asset_tags || []).map((x) => x.tag?.name).filter(Boolean);
  const customFields = await ref('fields').catch(() => []);

  const [versions, history, comments, colls, shares, urls] = await Promise.all([
    sb.from('asset_versions').select('id,version,storage_path,filename,mime_type,file_size,note,created_at,uploader:profiles!uploaded_by(full_name)').eq('asset_id', a.id).order('version', { ascending: false }),
    state.profile.role === 'external' ? Promise.resolve({ data: [] }) : sb.from('approval_history').select('id,from_status,to_status,comment,created_at,actor:profiles!actor_id(full_name)').eq('asset_id', a.id).order('created_at', { ascending: false }),
    state.profile.role === 'external' ? Promise.resolve({ data: [] }) : sb.from('asset_comments').select('id,body,created_at,author_id,author:profiles!author_id(full_name)').eq('asset_id', a.id).order('created_at'),
    sb.from('collection_assets').select('collection:collections(id,name)').eq('asset_id', a.id),
    can('share') ? sb.from('shares').select('id,revoked_at,expires_at').eq('asset_id', a.id) : Promise.resolve({ data: [] }),
    signedUrls([a.storage_path, a.thumbnail_path]),
  ]);
  if (!ctx.isCurrent()) return;

  const activeShares = (shares.data || []).filter((s) => !s.revoked_at && (!s.expires_at || new Date(s.expires_at) > new Date())).length;
  const place = [a.ward, a.district, a.region, a.country].filter(Boolean).join(', ');
  const publicLink = `${location.origin}${location.pathname}#/library/${a.id}`;

  // ---- which workflow buttons make sense right now
  const btns = [];
  if (!trashed) {
    if (['draft', 'changes_requested', 'rejected'].includes(a.status) && manage && can('edit_metadata'))
      btns.push(['submit', 'btn-primary', 'send', tr('Submit for review', 'Wasilisha kwa ukaguzi')]);
    if (a.status === 'pending_review' && can('approve') && (a.uploaded_by !== me || isAdmin())) {
      btns.push(['approve', 'btn-primary', 'check-circle', tr('Approve', 'Idhinisha')]);
      btns.push(['changes', 'btn-ghost', 'message', tr('Request changes', 'Omba marekebisho')]);
      btns.push(['reject', 'btn-ghost danger-text', 'x', tr('Reject', 'Kataa')]);
    }
    if (a.status === 'approved' && can('publish')) btns.push(['publish', 'btn-primary', 'globe', tr('Publish publicly', 'Chapisha kwa umma')]);
    if (a.status === 'published' && can('publish')) btns.push(['unpublish', 'btn-ghost', 'lock', tr('Unpublish', 'Ondoa kwa umma')]);
    if (a.status === 'archived' && can('restore') && manage) btns.push(['unarchive', 'btn-ghost', 'rotate', tr('Restore from archive', 'Rejesha kutoka kumbukumbu')]);
  }

  mount(ctx.view, html`
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/app/assets">${t('nav.assets')}</a>${raw(icon('chevron-right', 14))}<span>${a.title}</span></nav>
    ${trashed ? html`<div class="banner warn">${raw(icon('trash', 18))}<span>${tr('This asset is in the trash.', 'Mali hii iko kwenye taka.')}</span>
      <span class="banner-actions">
        ${can('restore') && (isAdmin() || a.uploaded_by === me) ? html`<button class="btn btn-ghost btn-sm" data-act="restore">${t('common.restore')}</button>` : ''}
        ${isAdmin() ? html`<button class="btn btn-ghost btn-sm danger-text" data-act="forever">${tr('Delete permanently', 'Futa kabisa')}</button>` : ''}</span></div>` : ''}
    ${a.status === 'changes_requested' || a.status === 'rejected' ? html`<div class="banner ${a.status === 'rejected' ? 'warn' : 'info'}">${raw(icon('message', 18))}
      <span><b>${t('status.' + a.status)}.</b> ${(history.data || []).find((h) => h.to_status === a.status)?.comment || ''}</span></div>` : ''}

    <div class="asset-layout">
      <div class="asset-main">
        <div class="asset-stage"><div id="preview" class="preview loading"><div class="spinner"></div></div></div>

        <section class="panel">
          <header class="panel-head"><h2>${tr('Details', 'Maelezo')}</h2></header>
          ${a.description ? html`<p class="asset-desc">${a.description}</p>` : html`<p class="muted-text">${tr('No description yet.', 'Hakuna maelezo bado.')}</p>`}
          <dl class="kv two">
            ${kvRow(tr('File name', 'Jina la faili'), a.filename)}
            ${kvRow(tr('File type', 'Aina ya faili'), `${t('cat.' + a.category)} · ${a.mime_type}`)}
            ${kvRow(tr('Size', 'Ukubwa'), fmtBytes(a.file_size))}
            ${kvRow(tr('Uploaded', 'Imepakiwa'), `${fmtDateTime(a.created_at)}${a.uploader?.full_name ? ' · ' + a.uploader.full_name : ''}`)}
            ${kvRow(tr('Last modified', 'Imebadilishwa mwisho'), fmtDateTime(a.updated_at))}
            ${kvRow(tr('Project', 'Mradi'), a.project ? html`<a class="link" href="#/app/projects/${a.project.id}">${a.project.name}</a>` : '')}
            ${kvRow(tr('Programme area', 'Eneo la programu'), a.program ? programName(a.program) : '')}
            ${kvRow(tr('Department', 'Idara'), a.department)}
            ${kvRow(tr('Place', 'Mahali'), place)}
            ${kvRow(tr('Date captured', 'Tarehe ya kupigwa'), a.captured_at ? fmtDate(a.captured_at) : '')}
            ${kvRow(tr('Creator', 'Muundaji'), a.creator)}
            ${kvRow(tr('Language', 'Lugha'), a.language)}
            ${kvRow(tr('Copyright holder', 'Mmiliki wa hakimiliki'), a.copyright_holder)}
            ${kvRow(tr('Usage terms', 'Masharti ya matumizi'), a.usage_rights)}
            ${customFields.map((f) => {
              const v = (a.custom_metadata || {})[f.key];
              return kvRow(getLang() === 'sw' && f.label_sw ? f.label_sw : f.label, v === undefined ? '' : String(v));
            })}
          </dl>
          ${tagNames.length || (a.keywords || []).length ? html`<div class="chips chips-static">
            ${tagNames.map((n) => html`<a class="chip" href="#/app/assets?q=${encodeURIComponent(n)}">${raw(icon('tag', 12))}${n}</a>`)}
            ${(a.keywords || []).map((k) => html`<span class="chip chip-soft">${k}</span>`)}</div>` : ''}
        </section>

        ${state.profile.role !== 'external' ? html`<section class="panel" id="comments">
          <header class="panel-head"><h2>${tr('Team comments', 'Maoni ya timu')}</h2><small class="muted-text">${tr('Only visible to Terraviva staff', 'Yanaonekana kwa wafanyakazi wa Terraviva tu')}</small></header>
          <ul class="comment-list" id="commentList"></ul>
          <form class="comment-form" id="commentForm"><textarea class="input" rows="2" name="body" maxlength="2000" placeholder="${tr('Write a comment…', 'Andika maoni…')}" required></textarea>
            <button class="btn btn-primary btn-sm" type="submit">${tr('Post', 'Tuma')}</button></form>
        </section>` : ''}
      </div>

      <aside class="asset-side">
        <section class="panel">
          <h1 class="asset-title">${a.title}</h1>
          <div class="badges">${statusBadge(a.status)}${confBadge(a.confidentiality)}<span class="badge">${t('cat.' + a.category)}</span>
            ${a.version > 1 ? html`<span class="badge">v${a.version}</span>` : ''}</div>
          <div class="action-stack">
            ${can('download') && !trashed ? html`<button class="btn btn-primary" data-act="download">${raw(icon('download', 18))}${t('common.download')}</button>` : ''}
            ${btns.map(([k, cls, ic, label]) => html`<button class="btn ${cls}" data-act="${k}">${raw(icon(ic, 18))}${label}</button>`)}
          </div>
          <div class="action-row">
            ${edit ? html`<button class="btn btn-ghost btn-sm" data-act="edit">${raw(icon('edit', 16))}${t('common.edit')}</button>` : ''}
            ${can('share') && !trashed && a.confidentiality !== 'confidential' || (isAdmin() && !trashed) ? html`<button class="btn btn-ghost btn-sm" data-act="share">${raw(icon('share', 16))}${t('common.share')}</button>` : ''}
            ${can('edit_metadata') && !trashed ? html`<button class="btn btn-ghost btn-sm" data-act="collect">${raw(icon('layers', 16))}${tr('Collect', 'Kusanya')}</button>` : ''}
            ${edit && can('replace_files') ? html`<button class="btn btn-ghost btn-sm" data-act="replace">${raw(icon('upload', 16))}${tr('New version', 'Toleo jipya')}</button>` : ''}
          </div>
          <div class="action-row">
            ${edit && a.status !== 'archived' && can('edit_metadata') && manage ? html`<button class="btn btn-ghost btn-sm" data-act="archive">${raw(icon('archive', 16))}${tr('Archive', 'Kumbukumbu')}</button>` : ''}
            ${!trashed && can('delete') && manage ? html`<button class="btn btn-ghost btn-sm danger-text" data-act="trash">${raw(icon('trash', 16))}${t('common.delete')}</button>` : ''}
          </div>
        </section>

        <section class="panel">
          <header class="panel-head"><h2>${tr('Sharing and publication', 'Kushiriki na kuchapisha')}</h2></header>
          <dl class="kv">
            ${kvRow(tr('Visibility', 'Uonekanaji'), t('conf.' + a.confidentiality))}
            ${kvRow(tr('Status', 'Hali'), t('status.' + a.status))}
            ${a.status === 'published' ? kvRow(tr('Published', 'Imechapishwa'), `${fmtDate(a.published_at)}${a.publisher?.full_name ? ' · ' + a.publisher.full_name : ''}`) : ''}
            ${can('share') ? kvRow(tr('Active shares', 'Ushiriki unaoendelea'), String(activeShares)) : ''}
            ${kvRow(tr('Views', 'Mara kutazamwa'), stats ? fmtNum(stats.views) : '0')}
            ${kvRow(tr('Downloads', 'Upakuaji'), stats ? fmtNum(stats.downloads) : '0')}
          </dl>
          ${a.status === 'published' ? html`<div class="copy-row"><a class="btn btn-ghost btn-sm" href="#/library/${a.id}">${raw(icon('globe', 16))}${tr('View public page', 'Tazama ukurasa wa umma')}</a>
            <button class="btn btn-ghost btn-sm" data-act="copylink">${raw(icon('link', 16))}${tr('Copy link', 'Nakili kiungo')}</button></div>` : ''}
          ${(colls.data || []).length ? html`<p class="mini-h">${tr('In collections', 'Kwenye mikusanyiko')}</p>
            <div class="chips chips-static">${colls.data.map((c) => c.collection ? html`<a class="chip" href="#/app/collections/${c.collection.id}">${c.collection.name}</a>` : '')}</div>` : ''}
        </section>

        <section class="panel">
          <header class="panel-head"><h2>${tr('Versions', 'Matoleo')}</h2></header>
          <ul class="version-list">${(versions.data || []).map((v) => html`<li>
            <span class="v-n">v${v.version}</span>
            <span class="v-main"><b>${v.filename}</b><small>${fmtBytes(v.file_size)} · ${fmtDate(v.created_at)}${v.uploader?.full_name ? ' · ' + v.uploader.full_name : ''}${v.note ? ' · ' + v.note : ''}</small></span>
            ${can('download') ? html`<button class="icon-btn" data-version="${v.id}" aria-label="${t('common.download')} v${v.version}">${raw(icon('download', 17))}</button>` : ''}</li>`)}</ul>
        </section>

        ${(history.data || []).length ? html`<section class="panel">
          <header class="panel-head"><h2>${tr('Approval history', 'Historia ya idhini')}</h2></header>
          <ol class="timeline">${history.data.map((h) => html`<li>
            <b>${h.from_status ? html`${t('status.' + h.from_status)} → ` : ''}${t('status.' + h.to_status)}</b>
            ${h.comment ? html`<p>${h.comment}</p>` : ''}
            <small>${h.actor?.full_name || tr('System', 'Mfumo')} · ${fmtDateTime(h.created_at)}</small></li>`)}</ol>
        </section>` : ''}
      </aside>
    </div>`);

  document.title = `${a.title} · TerraVault`;

  // ---- preview
  const host = ctx.view.querySelector('#preview');
  host.classList.remove('loading');
  renderPreview(host, { category: a.category, mime: a.mime_type, url: urls.get(a.storage_path), thumb: urls.get(a.thumbnail_path), title: a.title });
  sb.rpc('track_asset_event', { p_asset: a.id, p_kind: 'view' }).then(() => {}, () => {});

  // Repair: videos uploaded earlier may have no thumbnail; make one now from the real video.
  if (a.category === 'video' && !a.thumbnail_path && canEditAsset(a) && urls.get(a.storage_path)) {
    makeThumbnailFromUrl(urls.get(a.storage_path), a.mime_type).then(async (blob) => {
      if (!blob) return;
      try { const tp = await uploadThumbnail(a.id, blob); if (!tp) return; const { error } = await sb.from('assets').update({ thumbnail_path: tp }).eq('id', a.id); if (error) return; a.thumbnail_path = tp; toast(tr('Video thumbnail created.', 'Picha ya video imetengenezwa.')); } catch { /* optional */ }
    });
  }

  // ---- actions
  const handlers = {
    download: async (b) => withBusy(b, async () => { try { await downloadAsset(a); } catch (e) { toast(friendlyError(e), 'error'); } }),
    submit: () => act.submitForReview(a),
    approve: () => act.reviewAsset(a, 'approved'),
    changes: () => act.reviewAsset(a, 'changes_requested'),
    reject: () => act.reviewAsset(a, 'rejected'),
    publish: () => act.publishAsset(a),
    unpublish: () => act.unpublishAsset(a),
    archive: () => act.archiveAsset(a),
    unarchive: () => act.unarchiveAsset(a),
    trash: () => act.trashAssets([a]),
    restore: () => act.restoreAsset(a),
    forever: async () => { if (await act.deleteForever(a)) location.hash = '#/app/trash'; },
    edit: () => act.openEditAsset(a),
    share: () => act.openShareModal({ asset: a }),
    collect: () => act.openAddToCollection([a.id]),
    replace: () => act.openReplaceFile(a),
    copylink: async () => { await copyText(publicLink); toast(tr('Link copied.', 'Kiungo kimenakiliwa.'), 'success'); },
  };
  ctx.view.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (b) { await handlers[b.dataset.act]?.(b); return; }
    const v = e.target.closest('[data-version]');
    if (v) {
      const ver = (versions.data || []).find((x) => x.id === v.dataset.version);
      if (ver) withBusy(v, async () => { try { await downloadAsset(a, { path: ver.storage_path, filename: ver.filename }); } catch (err) { toast(friendlyError(err), 'error'); } });
    }
  });

  // ---- comments
  if (state.profile.role !== 'external') {
    const list = ctx.view.querySelector('#commentList');
    let items = comments.data || [];
    const paint = () => mount(list, items.length ? html`${items.map((c) => html`<li>
      <span class="avatar" aria-hidden="true">${initials(c.author?.full_name || '?')}</span>
      <div><b>${c.author?.full_name || tr('Former member', 'Mwanachama wa zamani')}</b> <small>${timeAgo(c.created_at)}</small><p>${c.body}</p></div>
      ${c.author_id === me || isAdmin() ? html`<button class="icon-btn" data-del="${c.id}" aria-label="${t('common.delete')}">${raw(icon('trash', 15))}</button>` : ''}</li>`)}`
      : html`<li class="panel-empty">${tr('No comments yet.', 'Hakuna maoni bado.')}</li>`);
    paint();
    ctx.view.querySelector('#commentForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target; const body = form.body.value.trim();
      if (!body) return;
      await withBusy(form.querySelector('button'), async () => {
        const { data, error } = await sb.from('asset_comments').insert({ asset_id: a.id, body }).select('id,body,created_at,author_id').single();
        if (error) { toast(friendlyError(error), 'error'); return; }
        items = [...items, { ...data, author: { full_name: state.profile.full_name } }]; form.reset(); paint();
      });
    });
    list.addEventListener('click', async (e) => {
      const d = e.target.closest('[data-del]');
      if (!d) return;
      const { error } = await sb.from('asset_comments').delete().eq('id', d.dataset.del);
      if (error) toast(friendlyError(error), 'error'); else { items = items.filter((c) => c.id !== d.dataset.del); paint(); }
    });
  }
}
