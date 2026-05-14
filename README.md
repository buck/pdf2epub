# PDF to ePub Converter

A Chrome extension that converts PDFs to ePub files using [Mistral OCR](https://mistral.ai/).

## Features

- Right-click any PDF link → **Convert PDF to ePub**
- Paste a URL directly in the popup
- Pick a local PDF file — for PDFs buried behind JavaScript with no direct link
- Preserves headings, tables, lists, code blocks, images, and inline formatting
- Downloads a ready-to-read `.epub` file

## Setup

1. Clone or download this repo
2. Go to `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the repo folder
3. Get a [Mistral API key](https://console.mistral.ai/), click the extension icon, and save it — the key is stored locally in Chrome and never leaves your machine

## Usage

**Context menu:** Right-click any PDF link on a page and choose *Convert PDF to ePub*. If no API key is saved yet the URL is queued; open the popup, enter your key, and conversion starts automatically.

**Popup — URL:** Click the extension icon, paste a PDF URL, set an optional title, and click *Convert PDF to ePub*.

**Popup — local file:** If the PDF has no direct link (e.g. it loads through JavaScript), download it first, then click **Browse…** in the popup. A small picker window opens — select the PDF there and conversion begins immediately. The window closes itself when done. The title is taken from the filename.

> **Why a separate window?** Chrome dismisses extension popups the instant any OS file dialog steals focus, so the file `change` event would never fire. The picker window doesn't have this limitation.

The extension icon badge shows live status: `↑` uploading · `OCR` processing · `✓` done · `ERR` failed. The `.epub` is saved via Chrome's normal download dialog.

## How it works

1. **OCR** — the PDF is sent to Mistral's `mistral-ocr-latest` model. If Mistral can't fetch the URL directly the extension downloads and uploads the file itself. Local files are uploaded directly.
2. **Conversion** — the returned markdown (headings, tables, lists, code, inline images) is converted to XHTML.
3. **Packaging** — the XHTML, images, and stylesheet are bundled into a valid EPUB 2 archive using [JSZip](https://stuk.github.io/jszip/) and downloaded.

## Requirements

- Chrome (Manifest V3)
- A [Mistral API](https://console.mistral.ai/) key with access to the OCR endpoint
