# PDF to ePub Converter

A Chrome extension that converts PDFs to ePub files using [Mistral OCR](https://mistral.ai/).

## Features

- Right-click any PDF link and choose **Convert PDF to ePub**
- Or paste a PDF URL directly in the popup
- Or pick a local PDF file — useful when the download link is hidden behind JavaScript
- Preserves headings, tables, lists, code blocks, images, and inline formatting
- Downloads a ready-to-read `.epub` file

## Setup

1. Clone or download this repo
2. Go to `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the repo folder
3. Get a [Mistral API key](https://console.mistral.ai/) and paste it into the extension popup

## Usage

**Via context menu:** Right-click a PDF link on any page and select *Convert PDF to ePub*. If no API key is saved yet, the URL is queued — open the popup, enter your key, and the conversion starts automatically.

**Via popup (URL):** Click the extension icon, paste a PDF URL and an optional title, then click *Convert PDF to ePub*.

**Via popup (local file):** If the PDF isn't directly linkable, download it first, then click **Browse…** in the popup. This opens a small persistent picker window — necessary because Chrome dismisses extension popups the moment a file dialog steals focus (especially on Linux). Select the PDF in that window; conversion starts immediately and the window closes itself. The title is derived from the filename automatically.

The extension badge shows progress (`OCR` → `✓` or `ERR`). The `.epub` is saved through Chrome's normal download dialog.

## How it works

1. Sends the PDF to the Mistral OCR API (`mistral-ocr-latest`) — either by URL, by downloading and uploading when Mistral can't fetch the URL directly, or by uploading a locally picked file
2. Converts the returned markdown (including embedded base64 images) to XHTML
3. Packages everything into a valid EPUB 2 archive using [JSZip](https://stuk.github.io/jszip/)

## Requirements

- Chrome (Manifest V3)
- A [Mistral API](https://console.mistral.ai/) key with access to the OCR endpoint
