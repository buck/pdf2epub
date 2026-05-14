// Popup is now just UI — all conversion runs in background.js.
// Badge on the extension icon shows state at all times:
//   blue "OCR"  — running
//   blue "↑"    — uploading file
//   green "✓"   — done
//   red "ERR"   — failed

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const { mistralApiKey } = await chrome.storage.local.get('mistralApiKey');
  if (mistralApiKey) document.getElementById('apiKey').value = mistralApiKey;

  // Show whatever state background has saved (running, done, error, etc.)
  await refreshStatus();

  // Check if a URL was queued via right-click → context menu
  const { pendingPdfUrl } = await chrome.storage.session.get('pendingPdfUrl');
  if (pendingPdfUrl) {
    await chrome.storage.session.remove('pendingPdfUrl');
    chrome.action.setBadgeText({ text: '' });
    document.getElementById('pdfUrl').value = pendingPdfUrl;
    document.getElementById('docTitle').value = urlToTitle(pendingPdfUrl);
    // If API key is saved, auto-start immediately
    if (mistralApiKey) {
      document.getElementById('convertBtn').click();
    }
    return;
  }

  // Fallback: if the active tab itself is a PDF URL, pre-fill it
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab.url || '';
    if (/\.pdf($|\?|#)/i.test(url)) {
      document.getElementById('pdfUrl').value = url;
    }
    const rawTitle = (tab.title || '').replace(/\s*[-|–]\s*.+$/, '').trim();
    if (rawTitle) document.getElementById('docTitle').value = rawTitle;
  } catch (e) {
    console.warn('Could not read tab:', e);
  }
});

// Poll every 1.5 s while popup is open so status stays live
setInterval(refreshStatus, 1500);

async function refreshStatus() {
  const { convStatus } = await chrome.storage.session.get('convStatus');
  if (!convStatus) return;
  if (Date.now() - convStatus.timestamp > 300_000) return; // ignore if > 5 min old

  const isRunning = convStatus.state === 'running';
  const cls = convStatus.state === 'error' ? 'error'
            : convStatus.state === 'done'  ? 'ok'
            : '';
  setStatus(convStatus.message, cls);
  document.getElementById('convertBtn').disabled = isRunning;
  showProgress(isRunning);
}

// ── File picker ───────────────────────────────────────────────────────────────
// Opens a persistent window so the OS file dialog doesn't dismiss the popup.

document.getElementById('pickFile').addEventListener('click', async () => {
  const title = document.getElementById('docTitle').value.trim();
  const url = chrome.runtime.getURL('picker.html') +
    (title ? '?title=' + encodeURIComponent(title) : '');
  await chrome.windows.create({ url, type: 'popup', width: 440, height: 160, focused: true });
});

// ── Save API key ──────────────────────────────────────────────────────────────

document.getElementById('saveKey').addEventListener('click', async () => {
  const key = document.getElementById('apiKey').value.trim();
  await chrome.storage.local.set({ mistralApiKey: key });
  const el = document.getElementById('keyStatus');
  el.textContent = 'Saved!';
  setTimeout(() => { el.textContent = ''; }, 2000);
});

// ── Convert button ────────────────────────────────────────────────────────────

document.getElementById('convertBtn').addEventListener('click', async () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) { setStatus('Please enter your Mistral API key.', 'error'); return; }

  const pdfUrl = document.getElementById('pdfUrl').value.trim();
  if (!pdfUrl) { setStatus('Please enter a PDF URL or use Browse… for a local file.', 'error'); return; }

  const title = document.getElementById('docTitle').value.trim() || urlToTitle(pdfUrl);
  chrome.runtime.sendMessage({ action: 'convert', url: pdfUrl, apiKey, title });
  setStatus('Conversion running in background — you can close this popup.', '');
  showProgress(true);
  document.getElementById('convertBtn').disabled = true;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function setStatus(msg, cls) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = cls || '';
}

function showProgress(on) {
  document.getElementById('progressBar').className = 'progress-bar' + (on ? ' active' : '');
}

function urlToTitle(url) {
  return (url.split('/').pop().split('?')[0] || 'document')
    .replace(/\.pdf$/i, '').replace(/[-_+]/g, ' ').trim() || 'document';
}
