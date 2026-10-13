// Previews that stream from storage instead of forcing a full download.
import { html, raw, esc, CATEGORY_ICON } from './util.js';
import { icon } from './icons.js';
import { tr } from './i18n.js';
import { openModal } from './ui.js';

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfPromise;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  pdfPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PDFJS; s.async = true;
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; resolve(window.pdfjsLib); };
    s.onerror = () => { pdfPromise = null; reject(new Error('pdf.js failed to load')); };
    document.head.appendChild(s);
  });
  return pdfPromise;
}

async function pdfViewer(host, url) {
  host.innerHTML = `<div class="pdf-bar"><button type="button" class="icon-btn" data-prev aria-label="${esc(tr('Previous page', 'Ukurasa uliopita'))}">${icon('chevron-left', 18)}</button>
    <span data-pg>…</span><button type="button" class="icon-btn" data-next aria-label="${esc(tr('Next page', 'Ukurasa unaofuata'))}">${icon('chevron-right', 18)}</button></div>
    <div class="pdf-stage"><canvas></canvas></div>`;
  const canvas = host.querySelector('canvas');
  const label = host.querySelector('[data-pg]');
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ url }).promise;
  let n = 1; let busy = false;
  const draw = async () => {
    if (busy) return; busy = true;
    try {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const width = Math.min(host.clientWidth || 800, 1000);
      const scale = (width / base.width) * (window.devicePixelRatio || 1);
      const vp = page.getViewport({ scale });
      canvas.width = vp.width; canvas.height = vp.height;
      canvas.style.width = '100%';
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      label.textContent = `${n} / ${pdf.numPages}`;
    } finally { busy = false; }
  };
  host.querySelector('[data-prev]').onclick = () => { if (n > 1) { n--; draw(); } };
  host.querySelector('[data-next]').onclick = () => { if (n < pdf.numPages) { n++; draw(); } };
  await draw();
}

function fallback(host, { category, mime, title }, note) {
  host.innerHTML = `<div class="preview-fallback"><span class="pf-ic">${icon(CATEGORY_ICON[category] || 'file', 40)}</span>
    <b>${esc(title || '')}</b><p>${esc(note || tr('A preview is not available for this file type. Download it to open it.', 'Hakuna onyesho la awali kwa aina hii ya faili. Ipakue ili uifungue.'))}</p></div>`;
}

/**
 * Fill `host` with the right preview.
 * item: { category, mime, url, thumb, title }
 */
export async function renderPreview(host, item) {
  const { category, mime = '', url, thumb, title } = item;
  host.classList.add('preview');
  if (!url) return fallback(host, item);
  try {
    if (category === 'photo' && mime !== 'image/tiff') {
      host.innerHTML = `<button type="button" class="preview-img" aria-label="${esc(tr('Enlarge image', 'Kuza picha'))}"><img src="${esc(url)}" alt="${esc(title || '')}"></button>`;
      const img = host.querySelector('img');
      img.addEventListener('error', () => fallback(host, item), { once: true });
      host.querySelector('button').addEventListener('click', () => {
        openModal({ title: title || '', size: 'xl', body: html`<img class="lightbox-img" src="${url}" alt="${title || ''}">` });
      });
    } else if (category === 'video') {
      host.innerHTML = `<video controls preload="metadata" playsinline ${thumb ? `poster="${esc(thumb)}"` : ''} src="${esc(url)}"></video>`;
    } else if (category === 'audio') {
      host.innerHTML = `<div class="preview-audio"><span class="pf-ic">${icon('music', 40)}</span><audio controls preload="metadata" src="${esc(url)}"></audio></div>`;
    } else if (mime === 'application/pdf') {
      host.classList.add('preview-pdf');
      await pdfViewer(host, url);
    } else if (mime === 'text/plain' || mime === 'text/csv') {
      const r = await fetch(url, { headers: { Range: 'bytes=0-65535' } });
      if (!r.ok && r.status !== 206) throw new Error('text');
      const text = await r.text();
      host.innerHTML = `<pre class="preview-text">${esc(text.split('\n').slice(0, 200).join('\n'))}</pre>`;
    } else {
      fallback(host, item);
    }
  } catch {
    fallback(host, item, tr('We could not load the preview. You can still download the file.', 'Hatukuweza kupakia onyesho la awali. Bado unaweza kupakua faili.'));
  }
}
