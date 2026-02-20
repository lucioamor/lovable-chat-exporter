// popup.js — handles the extension popup UI

const STORAGE_KEY_PREFIX = 'lce_thread_';

function getThreadKey(url) {
  const path = new URL(url).pathname.replace(/\/$/, '');
  return STORAGE_KEY_PREFIX + btoa(path).replace(/[^a-z0-9]/gi, '_');
}

function isLovableChatUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'lovable.dev' && /\/(projects|chat)\/[a-zA-Z0-9_-]+/.test(u.pathname);
  } catch { return false; }
}

async function getActiveTab() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0]));
  });
}

async function getMessages(tabUrl) {
  const key = getThreadKey(tabUrl);
  return new Promise(resolve => {
    chrome.storage.local.get([key], result => {
      resolve(result[key] || {});
    });
  });
}

async function clearMessages(tabUrl) {
  const key = getThreadKey(tabUrl);
  return new Promise(resolve => {
    chrome.storage.local.remove([key], resolve);
  });
}

function sendToContent(tabId, action, data = {}) {
  chrome.tabs.sendMessage(tabId, { action, ...data });
}

// ── Render ────────────────────────────────────────────────────────────

async function render() {
  const tab = await getActiveTab();

  if (!tab || !isLovableChatUrl(tab.url)) {
    document.getElementById('not-on-chat').style.display = 'block';
    document.getElementById('on-chat').style.display = 'none';
    return;
  }

  document.getElementById('not-on-chat').style.display = 'none';
  document.getElementById('on-chat').style.display = 'block';

  const messages = await getMessages(tab.url);
  const count = Object.keys(messages).length;

  document.getElementById('msg-count').textContent = count;
  document.getElementById('msg-sub').textContent = count === 0
    ? 'Scroll the chat or click "Capture full history"'
    : 'Ready to export';

  // Wire up buttons
  document.getElementById('btn-scroll').onclick = () => {
    sendToContent(tab.id, 'autoScroll');
    window.close();
  };

  document.getElementById('btn-md').onclick = () => {
    sendToContent(tab.id, 'exportMD');
    window.close();
  };

  document.getElementById('btn-html').onclick = () => {
    sendToContent(tab.id, 'exportHTML');
    window.close();
  };

  document.getElementById('btn-json').onclick = () => {
    sendToContent(tab.id, 'exportJSON');
    window.close();
  };

  document.getElementById('btn-clear').onclick = async () => {
    if (confirm('Clear all captured messages for this thread?')) {
      await clearMessages(tab.url);
      sendToContent(tab.id, 'clearMessages');
      render(); // refresh
    }
  };

  // Disable exports if no messages yet
  const exportBtns = ['btn-md', 'btn-html', 'btn-json'];
  exportBtns.forEach(id => {
    document.getElementById(id).disabled = count === 0;
  });
}

render();
