# Lovable Chat Exporter 💬

A Chrome extension that captures and exports your [Lovable.dev](https://lovable.dev) project chat history as **Markdown**, **HTML**, or **JSON**.

> Lovable doesn't offer a native export feature. This extension fills that gap.

---

## The Problem

Lovable renders its chat using a virtualized list — only ~20 messages exist in the DOM at any given time. Older messages disappear as you scroll, and there's no built-in way to save or download your conversation history.

This extension solves that by capturing every message as it enters the screen and storing it locally in your browser.

---

## Features

- **One-click export** to Markdown, HTML, or JSON
- **Auto-scroll capture** — automatically scrolls to the top to load the full history
- **Deduplication by message ID** — no repeated entries, even after reloads
- **Persists between sessions** per project thread
- **100% local** — all data stays in your browser, nothing is ever transmitted
- **Minimal permissions** — only activates on `lovable.dev`
- Works alongside other Lovable extensions (e.g. Quick Transfer)

---

## How It Works

1. When you open a Lovable project, an **Export (N)** button appears in the top navigation bar
2. A `MutationObserver` watches the DOM and captures each message as it renders
3. Messages are stored in `chrome.storage.local`, keyed by thread URL
4. Each message has a unique `data-message-id` — duplicates are ignored automatically

To capture the **complete history**, click **"Capture full history"** — the extension will scroll to the top automatically and wait for each batch of older messages to load before continuing.

---

## Export Formats

| Format | Use case |
|--------|----------|
| `.md` | Obsidian, Notion, Git repositories |
| `.html` | Readable offline in any browser |
| `.json` | Raw structured data for scripting or archiving |

---

## Installation

### From the Chrome Web Store
*(Coming soon)*

### Manual (Developer Mode)
1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the `lovable-exporter` folder

---

## Usage

1. Open any project on [lovable.dev](https://lovable.dev)
2. Click the **Export** button in the top nav bar
3. Select **"Capture full history"** to load all past messages
4. Choose your export format: Markdown, HTML, or JSON
5. The file downloads automatically

You can also click the extension icon in the Chrome toolbar to see how many messages have been captured and trigger exports from there.

---

## Privacy

All data is stored exclusively in your local browser via `chrome.storage.local`. Nothing is sent to any server — not to us, not to Lovable, not anywhere.

You can clear stored data at any time using the **"Clear captured data"** button in the extension popup.

Full privacy policy: https://github.com/lucioamor/lovable-chat-exporter/blob/main/privacy-policy.md

---

## File Structure

```
lovable-exporter/
├── manifest.json     # Extension configuration
├── content.js        # Injected script (capture + Export button)
├── popup.html        # Extension popup UI
├── popup.js          # Popup logic
└── icon128.png
```

---

## Contributing

Bug reports and pull requests are welcome. If Lovable updates their DOM structure and the extension breaks, opening an issue with a sample of the new HTML is the fastest way to get it fixed.

---

## License

MIT
