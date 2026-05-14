const params = new URLSearchParams(location.search);
const status = document.getElementById('status');

document.getElementById('pdfFile').addEventListener('change', async () => {
  const file = document.getElementById('pdfFile').files[0];
  if (!file) return;

  status.className = '';
  status.textContent = 'Reading file…';

  const { mistralApiKey } = await chrome.storage.local.get('mistralApiKey');
  if (!mistralApiKey) {
    status.className = 'error';
    status.textContent = 'No API key saved — open the extension popup and save your Mistral API key first.';
    return;
  }

  const title = params.get('title') ||
    file.name.replace(/\.pdf$/i, '').replace(/[-_+]/g, ' ').trim();

  let base64;
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsDataURL(file);
    });
    base64 = dataUrl.split(',')[1];
  } catch (e) {
    status.className = 'error';
    status.textContent = 'Could not read file: ' + e.message;
    return;
  }

  chrome.runtime.sendMessage({
    action: 'convertFile', base64, filename: file.name, apiKey: mistralApiKey, title
  });

  status.className = 'ok';
  status.textContent = 'Conversion started — watch the extension badge for progress.';
  setTimeout(() => window.close(), 3000);
});
