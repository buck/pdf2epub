importScripts('jszip.min.js');

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/ocr';
const MISTRAL_MODEL = 'mistral-ocr-latest';

// ── Context menu ──────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'pdf2epub',
    title: 'Convert PDF to ePub',
    contexts: ['link']
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'pdf2epub') return;
  const url = info.linkUrl;
  if (!url) return;

  const { mistralApiKey } = await chrome.storage.local.get('mistralApiKey');
  if (!mistralApiKey) {
    // Queue URL; user needs to open popup and enter API key first
    await chrome.storage.session.set({ pendingPdfUrl: url });
    setBadge('PDF', '#1565C0');
    await saveStatus('queued', 'PDF queued — open extension to set API key.');
    return;
  }

  // API key already saved — start immediately, no popup needed
  convertAndDownload(url, mistralApiKey, urlToTitle(url));
});

// ── Message from popup (manual trigger) ──────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'convert') {
    convertAndDownload(msg.url, msg.apiKey, msg.title);
    sendResponse({ ok: true });
  }
  return false;
});

// ── Conversion pipeline ───────────────────────────────────────────────────────

async function convertAndDownload(pdfUrl, apiKey, title) {
  console.log('[pdf2epub] Starting conversion:', pdfUrl);
  try {
    setBadge('OCR', '#1565C0');
    await saveStatus('running', 'Sending to Mistral OCR…');

    let data;

    // Try passing the URL directly first (fast path)
    const urlResp = await fetch(MISTRAL_API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MISTRAL_MODEL,
        document: { type: 'document_url', document_url: pdfUrl },
        include_image_base64: true
      })
    });

    if (urlResp.status === 400) {
      // Mistral couldn't fetch the URL — download here and upload
      setBadge('↑', '#1565C0');
      await saveStatus('running', 'URL blocked by server — downloading PDF…');
      console.log('[pdf2epub] URL fetch blocked, uploading file directly');
      const fileId = await uploadPdfToMistral(pdfUrl, apiKey);
      try {
        setBadge('OCR', '#1565C0');
        await saveStatus('running', 'PDF uploaded. Running OCR…');
        const fileResp = await fetch(MISTRAL_API_URL, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MISTRAL_MODEL,
            document: { type: 'file', file_id: fileId },
            include_image_base64: true
          })
        });
        if (!fileResp.ok) {
          const err = await fileResp.text();
          throw new Error(`Mistral OCR ${fileResp.status}: ${err}`);
        }
        data = await fileResp.json();
      } finally {
        deleteMistralFile(fileId, apiKey); // fire and forget
      }
    } else if (!urlResp.ok) {
      const errText = await urlResp.text();
      throw new Error(`Mistral API ${urlResp.status}: ${errText}`);
    } else {
      data = await urlResp.json();
    }

    const pages = data.pages || [];
    console.log('[pdf2epub] OCR complete:', pages.length, 'pages');
    await saveStatus('running', `OCR done (${pages.length} pages) — building ePub…`);

    const imageMap = new Map();
    for (const page of pages) {
      for (const img of (page.images || [])) {
        const raw = img.image_base64 || img.imageBase64 || '';
        const b64 = raw.includes(';base64,') ? raw.split(';base64,').pop() : raw;
        if (b64) imageMap.set(img.id, b64);
      }
    }

    const fullMarkdown = pages.map(p => p.markdown || '').join('\n\n---\n\n');
    const htmlContent = markdownToHtml(fullMarkdown, imageMap);
    await generateEpub({ title, url: pdfUrl, content: htmlContent }, imageMap);

    console.log('[pdf2epub] Done:', pages.length, 'pages,', imageMap.size, 'images');
    setBadge('✓', '#2e7d32');
    await saveStatus('done', `Done! ePub downloaded (${pages.length} pages, ${imageMap.size} images).`);
    setTimeout(() => setBadge('', '#000'), 8000);

  } catch (err) {
    console.error('[pdf2epub] Error:', err);
    setBadge('ERR', '#c62828');
    await saveStatus('error', err.message);
    setTimeout(() => setBadge('', '#000'), 30000);
  }
}

// ── Mistral file upload / delete ──────────────────────────────────────────────

async function uploadPdfToMistral(pdfUrl, apiKey) {
  const pdfResp = await fetch(pdfUrl);
  if (!pdfResp.ok) throw new Error(`Could not download PDF: ${pdfResp.status}`);
  const blob = await pdfResp.blob();
  const filename = (pdfUrl.split('/').pop().split('?')[0] || 'document.pdf')
    .replace(/([^.pdf])$/, '$1.pdf');
  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('purpose', 'ocr');
  const upResp = await fetch('https://api.mistral.ai/v1/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData
  });
  if (!upResp.ok) {
    const err = await upResp.text();
    throw new Error(`File upload ${upResp.status}: ${err}`);
  }
  const upData = await upResp.json();
  console.log('[pdf2epub] Uploaded file ID:', upData.id);
  return upData.id;
}

async function deleteMistralFile(fileId, apiKey) {
  try {
    await fetch(`https://api.mistral.ai/v1/files/${fileId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    console.log('[pdf2epub] Deleted file:', fileId);
  } catch (e) {
    console.warn('[pdf2epub] Could not delete uploaded file:', fileId, e);
  }
}

// ── Badge / status helpers ────────────────────────────────────────────────────

function setBadge(text, color) {
  chrome.action.setBadgeText({ text: text || '' });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

async function saveStatus(state, message) {
  console.log('[pdf2epub]', state, '—', message);
  await chrome.storage.session.set({ convStatus: { state, message, timestamp: Date.now() } });
}

function urlToTitle(url) {
  return (url.split('/').pop().split('?')[0] || 'document')
    .replace(/\.pdf$/i, '').replace(/[-_+]/g, ' ').trim() || 'document';
}

// ── Markdown → HTML ───────────────────────────────────────────────────────────

function markdownToHtml(markdown, imageMap) {
  let text = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const codeBlocks = [];
  text = text.replace(/```[\s\S]*?```/g, m => '\x00CODE' + (codeBlocks.push(m) - 1) + '\x00');
  const blocks = text.split(/\n{2,}/);
  let html = blocks.map(b => processBlock(b.trim(), imageMap)).filter(Boolean).join('\n');
  html = html.replace(/\x00CODE(\d+)\x00/g, (_, i) => {
    const raw = codeBlocks[+i];
    const inner = raw.replace(/^```[^\n]*\n/, '').replace(/```$/, '').trimEnd();
    return `<pre><code>${escapeHtml(inner)}</code></pre>`;
  });
  return html;
}

function processBlock(block, imageMap) {
  if (!block) return '';
  if (block.startsWith('\x00CODE')) return block;
  const hm = block.match(/^(#{1,6})\s+(.+)$/s);
  if (hm && !block.includes('\n')) {
    const lvl = hm[1].length;
    return `<h${lvl}>${applyInline(hm[2].trim(), imageMap)}</h${lvl}>`;
  }
  if (/^[-*_]{3,}$/.test(block)) return '<hr/>';
  if (block.startsWith('>')) {
    const inner = block.replace(/^>\s?/gm, '');
    return `<blockquote><p>${applyInline(inner.trim(), imageMap)}</p></blockquote>`;
  }
  const tlines = block.split('\n');
  if (tlines.length >= 2 && tlines[0].includes('|') &&
      /^[\s|:-]+$/.test(tlines[1].trim()) && tlines[1].includes('-')) {
    return processTable(tlines, imageMap);
  }
  if (/^[-*+]\s/.test(block)) return processList(block, imageMap, false);
  if (/^\d+[.)]\s/.test(block)) return processList(block, imageMap, true);
  if (/^!\[[^\]]*\]\([^)]+\)$/.test(block)) {
    return `<div class="figure">${applyInline(block, imageMap)}</div>`;
  }
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
  return `<p>${applyInline(lines.join(' '), imageMap)}</p>`;
}

function processTable(lines, imageMap) {
  const parseRow = line => {
    const parts = line.split('|').map(c => c.trim());
    const start = parts[0] === '' ? 1 : 0;
    const end = parts[parts.length - 1] === '' ? parts.length - 1 : parts.length;
    return parts.slice(start, end);
  };
  const headers = parseRow(lines[0]);
  const rows = lines.slice(2).map(parseRow);
  let t = '<table>\n<thead><tr>';
  t += headers.map(h => `<th>${applyInline(h, imageMap)}</th>`).join('');
  t += '</tr></thead>\n<tbody>\n';
  for (const row of rows) {
    t += '<tr>' + row.map(c => `<td>${applyInline(c, imageMap)}</td>`).join('') + '</tr>\n';
  }
  return t + '</tbody></table>';
}

function processList(block, imageMap, ordered) {
  const tag = ordered ? 'ol' : 'ul';
  const re = ordered ? /^\d+[.)]\s+(.+)/ : /^[-*+]\s+(.+)/;
  const items = block.split('\n')
    .map(l => { const m = l.match(re); return m ? `<li>${applyInline(m[1], imageMap)}</li>` : null; })
    .filter(Boolean);
  return `<${tag}>\n${items.join('\n')}\n</${tag}>`;
}

function applyInline(text, imageMap) {
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    const epubSrc = (imageMap && imageMap.has(src)) ? `images/${src}` : src;
    return `<img src="${epubSrc}" alt="${escapeHtml(alt)}"/>`;
  });
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
    `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`);
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*\s][^*]*[^*\s]|\S)\*/g, '<em>$1</em>');
  text = text.replace(/_([^_\s][^_]*[^_\s]|\S)_/g, '<em>$1</em>');
  text = text.replace(/`([^`]+)`/g, (_, c) => `<code>${escapeHtml(c)}</code>`);
  return text;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── ePub generation ───────────────────────────────────────────────────────────

async function generateEpub(pageData, imageMap) {
  const zip = new JSZip();
  const uuid = generateUUID();

  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

  const imageItems = [];
  imageMap.forEach((_, id) => {
    const mime = id.endsWith('.png') ? 'image/png' : id.endsWith('.gif') ? 'image/gif' : 'image/jpeg';
    imageItems.push(`    <item id="${sanitizeId(id)}" href="images/${id}" media-type="${mime}"/>`);
  });

  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uuid_id" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${escapeXml(pageData.title)}</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="uuid_id">urn:uuid:${uuid}</dc:identifier>
    <dc:creator>PDF to ePub Converter</dc:creator>
    <dc:source>${escapeXml(pageData.url)}</dc:source>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="stylesheet" href="style.css" media-type="text/css"/>
    <item id="content" href="content.html" media-type="application/xhtml+xml"/>
${imageItems.join('\n')}
  </manifest>
  <spine toc="ncx">
    <itemref idref="content"/>
  </spine>
</package>`);

  zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${uuid}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(pageData.title)}</text></docTitle>
  <navMap>
    <navPoint id="navpoint-1" playOrder="1">
      <navLabel><text>${escapeXml(pageData.title)}</text></navLabel>
      <content src="content.html"/>
    </navPoint>
  </navMap>
</ncx>`);

  zip.file('OEBPS/style.css', `
body { font-family: Georgia, serif; font-size: 1em; line-height: 1.65; margin: 1.5em 1em; }
h1 { font-size: 1.5em; margin-top: 1em; }
h2 { font-size: 1.25em; margin-top: 1em; }
h3, h4, h5, h6 { font-size: 1.1em; margin-top: 0.8em; }
h1, h2, h3, h4, h5, h6 { font-family: Arial, sans-serif; line-height: 1.3; }
p { margin: 0.6em 0; text-align: justify; }
img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
.figure { text-align: center; margin: 1.5em 0; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.85em; }
th, td { border: 1px solid #bbb; padding: 4px 8px; vertical-align: top; }
th { background: #f0f0f0; font-weight: bold; }
blockquote { margin: 0.8em 1.5em; font-style: italic; border-left: 3px solid #ccc; padding-left: 0.8em; }
code { font-family: monospace; font-size: 0.9em; background: #f5f5f5; padding: 1px 4px; }
pre { background: #f5f5f5; padding: 1em; overflow-x: auto; font-size: 0.85em; }
pre code { background: none; padding: 0; }
ul, ol { margin: 0.5em 0 0.5em 1.5em; padding: 0; }
li { margin: 0.3em 0; }
hr { border: none; border-top: 1px solid #ccc; margin: 1.5em 0; }
`);

  zip.file('OEBPS/content.html', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeXml(pageData.title)}</title>
  <meta charset="UTF-8"/>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${pageData.content}
<hr/>
<p><small>Source: ${escapeXml(pageData.url)}</small></p>
</body>
</html>`);

  imageMap.forEach((b64, id) => {
    zip.file(`OEBPS/images/${id}`, b64, { base64: true });
  });

  // Service workers don't have URL.createObjectURL — use base64 data URL instead
  const base64 = await zip.generateAsync({
    type: 'base64',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  await chrome.downloads.download({
    url: 'data:application/epub+zip;base64,' + base64,
    filename: sanitizeFilename(pageData.title) + '.epub',
    saveAs: true
  });
}

// ── Utility ───────────────────────────────────────────────────────────────────

function escapeXml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function sanitizeId(id) {
  return 'i_' + id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function sanitizeFilename(name) {
  return (name || 'document').replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').substring(0, 60);
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
