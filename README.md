# PDF to ePub Converter

A Chrome extension that converts PDF links on the web to ePub files using [Mistral OCR](https://mistral.ai/).

## Features

- Right-click any PDF link and choose **Convert PDF to ePub**
- Or paste a PDF URL directly in the popup
- Preserves headings, tables, lists, code blocks, images, and inline formatting
- Downloads a ready-to-read `.epub` file

## Setup

1. Clone or download this repo
2. Go to `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the repo folder
3. Get a [Mistral API key](https://console.mistral.ai/) and paste it into the extension popup

## Usage

**Via context menu:** Right-click a PDF link on any page and select *Convert PDF to ePub*. If no API key is saved yet, the URL is queued — open the popup, enter your key, and the conversion starts automatically.

**Via popup:** Click the extension icon, paste a PDF URL and an optional title, then click *Convert PDF to ePub*.

The extension badge shows progress (`OCR` → `✓` or `ERR`). The `.epub` is saved through Chrome's normal download dialog.

## How it works

1. Sends the PDF to the Mistral OCR API (`mistral-ocr-latest`)
2. If Mistral can't fetch the URL directly, the extension downloads the PDF and uploads it as a file
3. Converts the returned markdown (including embedded base64 images) to XHTML
4. Packages everything into a valid EPUB 2 archive using [JSZip](https://stuk.github.io/jszip/)

## Requirements

- Chrome (Manifest V3)
- A [Mistral API](https://console.mistral.ai/) key with access to the OCR endpoint
