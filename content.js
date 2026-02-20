/**
 * Lovable Chat Exporter — Content Script
 * ========================================
 * Captures chat messages from the Lovable UI (which is virtualized),
 * persists them in chrome.storage.local by thread ID, and provides
 * Export (MD / HTML / JSON) functionality via an injected button.
 */

(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────

  const BUTTON_ID     = 'lce-export-btn';
  const STORAGE_KEY_PREFIX = 'lce_thread_';

  // ── Helpers ───────────────────────────────────────────────────────────

  function getThreadKey() {
    // Use pathname as thread identifier. Lovable URLs look like:
    //   /projects/:id  or  /chat/:id
    const path = location.pathname.replace(/\/$/, '');
    return STORAGE_KEY_PREFIX + btoa(path).replace(/[^a-z0-9]/gi, '_');
  }

  function isOnChatPage() {
    return /\/(projects|chat)\/[a-zA-Z0-9_-]+/.test(location.pathname);
  }

  // ── Storage helpers ───────────────────────────────────────────────────

  async function loadMessages() {
    const key = getThreadKey();
    return new Promise(resolve => {
      chrome.storage.local.get([key], result => {
        resolve(result[key] || {});
      });
    });
  }

  async function saveMessages(messagesMap) {
    const key = getThreadKey();
    return new Promise(resolve => {
      chrome.storage.local.set({ [key]: messagesMap }, resolve);
    });
  }

  // ── Message parsing ───────────────────────────────────────────────────

  function parseMessageElement(el) {
    const id = el.getAttribute('data-message-id') || el.id;
    if (!id) return null;

    const role = id.startsWith('umsg_') ? 'user' : 'ai';

    // Timestamp — grab the visible date+time spans
    const dateSpan = el.querySelector('.text-muted-foreground.font-medium');
    const timeSpan = dateSpan ? dateSpan.nextElementSibling : null;
    const timestampText = [dateSpan?.textContent?.trim(), timeSpan?.textContent?.trim()]
      .filter(Boolean).join(' ');

    // For ordering we also capture the CSS top value (virtualised list position)
    const topPx = parseFloat(el.style.top) || 0;

    // Content: for user messages grab the prose div; for AI grab the main prose block
    let contentHtml = '';
    let contentText = '';

    if (role === 'user') {
      const prose = el.querySelector('.PromptBox_customProse__le_d3, .prose');
      contentHtml = prose ? prose.innerHTML : '';
      contentText = prose ? prose.textContent.trim() : '';
    } else {
      // AI message: collect all prose content blocks
      const proseBlocks = el.querySelectorAll('.prose');
      const parts = [];
      proseBlocks.forEach(p => { if (p.textContent.trim()) parts.push(p.innerHTML); });
      contentHtml = parts.join('\n');
      contentText = proseBlocks.length
        ? Array.from(proseBlocks).map(p => p.textContent.trim()).join('\n\n')
        : el.textContent.trim();

      // Also capture "Thought for Xs" and "N tools used" as metadata
      const thoughtBtn = el.querySelector('button span.truncate');
      const toolBtn    = el.querySelector('button .truncate');
      const meta = [];
      if (thoughtBtn?.textContent) meta.push(thoughtBtn.textContent.trim());
      if (toolBtn?.textContent && toolBtn !== thoughtBtn) meta.push(toolBtn.textContent.trim());
      if (meta.length) contentText = `[${meta.join(' · ')}]\n\n` + contentText;
    }

    return { id, role, timestampText, topPx, contentHtml, contentText };
  }

  // ── Incremental capture ───────────────────────────────────────────────

  let capturedMessages = {}; // id → message object (in-memory mirror)
  let pendingSave = false;

  function flushSave() {
    if (pendingSave) return;
    pendingSave = true;
    setTimeout(async () => {
      await saveMessages(capturedMessages);
      pendingSave = false;
      updateButtonLabel();
    }, 400);
  }

  function scanVisibleMessages() {
    const els = document.querySelectorAll('[data-message-id]');
    let newCount = 0;
    els.forEach(el => {
      const msg = parseMessageElement(el);
      if (!msg) return;
      if (!capturedMessages[msg.id]) {
        capturedMessages[msg.id] = msg;
        newCount++;
      } else {
        // Update topPx in case the virtual list recalculated positions
        capturedMessages[msg.id].topPx = msg.topPx;
      }
    });
    if (newCount > 0) flushSave();
    return newCount;
  }

  // ── MutationObserver — watch for new messages entering the DOM ─────────

  let observer = null;

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => {
      scanVisibleMessages();
    });
    const target = document.body;
    observer.observe(target, { childList: true, subtree: true });
  }

  // ── Auto-scroll to capture full history ──────────────────────────────

  let isAutoScrolling = false;

  async function autoScrollAndCapture() {
    if (isAutoScrolling) return;
    isAutoScrolling = true;

    const btn = document.getElementById(BUTTON_ID);
    if (btn) { btn.textContent = '⏳ Capturing…'; btn.disabled = true; }

    // Find the scrollable chat container
    const scrollEl = findScrollContainer();
    if (!scrollEl) {
      showToast('Could not find scroll container.', 'error');
      isAutoScrolling = false;
      restoreButton();
      return;
    }

    // Scroll to the very top, batch by batch, until no new messages appear
    let lastCount = 0;
    let stableRounds = 0;

    while (stableRounds < 3) {
      scrollEl.scrollTop = 0;
      await sleep(600); // wait for virtual list to render new batch
      scanVisibleMessages();
      const currentCount = Object.keys(capturedMessages).length;
      if (currentCount === lastCount) {
        stableRounds++;
      } else {
        stableRounds = 0;
        lastCount = currentCount;
      }
    }

    // Scroll back to bottom so the user's context is preserved
    scrollEl.scrollTop = scrollEl.scrollHeight;

    isAutoScrolling = false;
    restoreButton();
    showToast(`✅ Captured ${Object.keys(capturedMessages).length} messages!`);
  }

  function findScrollContainer() {
    // Try known patterns first
    const candidates = [
      document.querySelector('[class*="overflow-y-auto"]'),
      document.querySelector('[class*="overflow-y-scroll"]'),
      document.querySelector('main'),
    ];
    for (const el of candidates) {
      if (el && el.scrollHeight > el.clientHeight) return el;
    }
    // Fallback: find the deepest element with vertical scroll
    let deepest = null;
    document.querySelectorAll('*').forEach(el => {
      if (el.scrollHeight > el.clientHeight + 50) {
        if (!deepest || el.contains(deepest)) deepest = el;
      }
    });
    return deepest;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Markdown conversion ───────────────────────────────────────────────

  function htmlToMarkdown(html) {
    // Lightweight conversion without external deps
    const div = document.createElement('div');
    div.innerHTML = html;

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE) return '';

      const tag = node.tagName.toLowerCase();
      const children = Array.from(node.childNodes).map(walk).join('');

      switch (tag) {
        case 'p': return children + '\n\n';
        case 'br': return '\n';
        case 'strong': case 'b': return `**${children}**`;
        case 'em': case 'i': return `*${children}*`;
        case 'code': return node.closest('pre') ? children : `\`${children}\``;
        case 'pre': {
          const codeEl = node.querySelector('code');
          const lang = (codeEl?.className || '').match(/language-(\w+)/)?.[1] || '';
          const code = codeEl ? codeEl.textContent : node.textContent;
          return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
        }
        case 'h1': return `# ${children}\n\n`;
        case 'h2': return `## ${children}\n\n`;
        case 'h3': return `### ${children}\n\n`;
        case 'h4': return `#### ${children}\n\n`;
        case 'ul': return children + '\n';
        case 'ol': {
          let i = 0;
          return Array.from(node.childNodes).map(child => {
            if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'LI') {
              i++;
              return `${i}. ${walk(child)}\n`;
            }
            return walk(child);
          }).join('') + '\n';
        }
        case 'li': return `- ${children}`;
        case 'a': return `[${children}](${node.href || '#'})`;
        case 'hr': return '---\n\n';
        case 'blockquote': return `> ${children.replace(/\n/g, '\n> ')}\n\n`;
        default: return children;
      }
    }

    return walk(div).replace(/\n{3,}/g, '\n\n').trim();
  }

  // ── Export functions ──────────────────────────────────────────────────

  function getSortedMessages() {
    return Object.values(capturedMessages).sort((a, b) => a.topPx - b.topPx);
  }

  function exportMarkdown() {
    const msgs = getSortedMessages();
    const lines = [
      `# Lovable Chat Export`,
      `> URL: ${location.href}`,
      `> Exported: ${new Date().toLocaleString()}`,
      `> Messages: ${msgs.length}`,
      '',
      '---',
      '',
    ];

    msgs.forEach(msg => {
      const role = msg.role === 'user' ? '👤 You' : '🤖 Lovable';
      lines.push(`## ${role} — ${msg.timestampText}`);
      lines.push('');
      if (msg.contentHtml) {
        lines.push(htmlToMarkdown(msg.contentHtml));
      } else {
        lines.push(msg.contentText);
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    });

    return lines.join('\n');
  }

  function exportHTML() {
    const msgs = getSortedMessages();
    const msgHtml = msgs.map(msg => {
      const role = msg.role === 'user' ? 'user' : 'ai';
      const roleLabel = msg.role === 'user' ? '👤 You' : '🤖 Lovable';
      return `
      <article class="message ${role}">
        <header>
          <span class="role">${roleLabel}</span>
          <span class="ts">${msg.timestampText}</span>
        </header>
        <div class="body">${msg.contentHtml || escapeHtml(msg.contentText)}</div>
      </article>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lovable Chat Export — ${new Date().toLocaleDateString()}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem 1rem; background: #0f1117; color: #e2e8f0; line-height: 1.6; }
    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: .25rem; }
    .meta { color: #94a3b8; font-size: .875rem; margin-bottom: 2rem; }
    .message { margin-bottom: 1.5rem; border-radius: 12px; overflow: hidden; border: 1px solid #1e293b; }
    .message header { display: flex; gap: .75rem; align-items: center; padding: .6rem 1rem; background: #1e293b; font-size: .8rem; }
    .role { font-weight: 600; }
    .ts { color: #64748b; margin-left: auto; }
    .message.user header { background: #1a2744; }
    .message.user .role { color: #60a5fa; }
    .message.ai header { background: #1a2730; }
    .message.ai .role { color: #34d399; }
    .body { padding: 1rem; font-size: .95rem; }
    .body p:first-child { margin-top: 0; }
    .body p:last-child { margin-bottom: 0; }
    code { background: #1e293b; padding: .15em .4em; border-radius: 4px; font-size: .85em; }
    pre { background: #1e293b; padding: 1rem; border-radius: 8px; overflow: auto; }
    pre code { background: none; padding: 0; }
  </style>
</head>
<body>
  <h1>💬 Lovable Chat Export</h1>
  <p class="meta">
    <strong>URL:</strong> ${escapeHtml(location.href)}<br>
    <strong>Exported:</strong> ${new Date().toLocaleString()}<br>
    <strong>Messages:</strong> ${msgs.length}
  </p>
  ${msgHtml}
</body>
</html>`;
  }

  function exportJSON() {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      url: location.href,
      messageCount: Object.keys(capturedMessages).length,
      messages: getSortedMessages(),
    }, null, 2);
  }

  function escapeHtml(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  function slugDate() {
    return new Date().toISOString().slice(0,10);
  }

  // ── Popup menu ────────────────────────────────────────────────────────

  let menuEl = null;

  function toggleMenu(anchorEl) {
    if (menuEl) { menuEl.remove(); menuEl = null; return; }

    const count = Object.keys(capturedMessages).length;
    const rect = anchorEl.getBoundingClientRect();

    menuEl = document.createElement('div');
    menuEl.id = 'lce-menu';

    Object.assign(menuEl.style, {
      position: 'fixed',
      top: `${rect.bottom + 6}px`,
      left: `${rect.left}px`,
      zIndex: '999999',
      background: 'hsl(220 20% 14%)',
      border: '1px solid hsl(220 20% 22%)',
      borderRadius: '10px',
      padding: '6px',
      minWidth: '200px',
      boxShadow: '0 8px 30px rgba(0,0,0,.5)',
      fontFamily: 'inherit',
      fontSize: '13px',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '6px 10px 8px',
      color: 'hsl(220 10% 55%)',
      fontSize: '11px',
      fontWeight: '600',
      letterSpacing: '.05em',
      textTransform: 'uppercase',
      borderBottom: '1px solid hsl(220 20% 20%)',
      marginBottom: '4px',
    });
    header.textContent = `${count} messages captured`;
    menuEl.appendChild(header);

    const actions = [
      {
        label: '📜 Capture full history',
        sub: 'Auto-scroll to top',
        action: () => { closeMenu(); autoScrollAndCapture(); }
      },
      { separator: true },
      {
        label: '⬇️ Export as Markdown',
        sub: '.md — for Obsidian / Notion',
        action: () => { closeMenu(); downloadBlob(exportMarkdown(), `lovable-chat-${slugDate()}.md`, 'text/markdown'); }
      },
      {
        label: '⬇️ Export as HTML',
        sub: '.html — readable offline',
        action: () => { closeMenu(); downloadBlob(exportHTML(), `lovable-chat-${slugDate()}.html`, 'text/html'); }
      },
      {
        label: '⬇️ Export as JSON',
        sub: '.json — raw data',
        action: () => { closeMenu(); downloadBlob(exportJSON(), `lovable-chat-${slugDate()}.json`, 'application/json'); }
      },
    ];

    actions.forEach(item => {
      if (item.separator) {
        const sep = document.createElement('div');
        Object.assign(sep.style, {
          height: '1px',
          background: 'hsl(220 20% 20%)',
          margin: '4px 0',
        });
        menuEl.appendChild(sep);
        return;
      }

      const row = document.createElement('button');
      row.type = 'button';
      Object.assign(row.style, {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        width: '100%',
        padding: '7px 10px',
        border: 'none',
        background: 'transparent',
        color: 'hsl(220 15% 85%)',
        borderRadius: '6px',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background .12s',
        gap: '1px',
      });

      const labelEl = document.createElement('span');
      labelEl.textContent = item.label;
      Object.assign(labelEl.style, { fontWeight: '500', fontSize: '13px' });

      const subEl = document.createElement('span');
      subEl.textContent = item.sub;
      Object.assign(subEl.style, { fontSize: '11px', color: 'hsl(220 10% 50%)' });

      row.appendChild(labelEl);
      row.appendChild(subEl);

      row.addEventListener('mouseenter', () => { row.style.background = 'hsl(220 20% 20%)'; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
      row.addEventListener('click', item.action);

      menuEl.appendChild(row);
    });

    document.body.appendChild(menuEl);

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', handleOutsideClick, { once: true });
    }, 0);
  }

  function handleOutsideClick(e) {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
  }

  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
    document.removeEventListener('click', handleOutsideClick);
  }

  // ── Toast ─────────────────────────────────────────────────────────────

  function showToast(message, type = 'info') {
    const existing = document.getElementById('lce-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'lce-toast';
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      padding: '10px 18px',
      borderRadius: '8px',
      backgroundColor: type === 'error' ? 'hsl(0 33% 20%)' : 'hsl(217 33% 22%)',
      color: type === 'error' ? 'hsl(0 91% 71%)' : 'hsl(140 60% 65%)',
      fontSize: '13px',
      fontFamily: 'inherit',
      zIndex: '999999',
      boxShadow: '0 4px 12px rgba(0,0,0,.4)',
      transition: 'opacity .3s',
      opacity: '0',
    });
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // ── Button ────────────────────────────────────────────────────────────

  function updateButtonLabel() {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    const count = Object.keys(capturedMessages).length;
    btn.textContent = count > 0 ? `Export (${count})` : 'Export';
    btn.disabled = false;
  }

  function restoreButton() {
    updateButtonLabel();
  }

  function createExportButton() {
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.textContent = 'Export';
    btn.title = 'Export chat history';

    Object.assign(btn.style, {
      position: 'relative',
      isolation: 'isolate',
      boxSizing: 'border-box',
      display: 'inline-flex',
      height: '28px',
      alignItems: 'center',
      justifyContent: 'center',
      whiteSpace: 'nowrap',
      borderRadius: '6px',
      border: '0.5px solid transparent',
      backgroundColor: 'hsl(217 75% 49%)',
      padding: '4px 12px',
      fontSize: '12px',
      fontWeight: '500',
      fontFamily: 'inherit',
      color: 'hsl(208 100% 97%)',
      cursor: 'pointer',
      transition: 'all .15s cubic-bezier(0.4,0,0.2,1)',
      letterSpacing: '.01em',
      lineHeight: '1',
      outline: 'none',
      flexShrink: '0',
    });

    btn.addEventListener('mouseenter', () => { if (!btn.disabled) btn.style.filter = 'brightness(1.15)'; });
    btn.addEventListener('mouseleave', () => { btn.style.filter = 'none'; });
    btn.addEventListener('mousedown', () => { if (!btn.disabled) btn.style.filter = 'brightness(0.85)'; });
    btn.addEventListener('mouseup', () => { btn.style.filter = 'brightness(1.15)'; });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu(btn);
    });

    return btn;
  }

  // ── Inject button (same placement logic as Lovable Quick Transfer) ────

  function findNavContainer() {
    const mainMenu = document.querySelector('#main-menu');
    if (mainMenu?.parentElement) return mainMenu.parentElement;
    return document.querySelector('nav div.flex.shrink-0.items-center.gap-2');
  }

  function injectButton() {
    if (document.getElementById(BUTTON_ID)) return;
    if (!isOnChatPage()) return;

    const container = findNavContainer();
    if (!container) return;

    const btn = createExportButton();
    const iconsGroup = container.querySelector('.flex.flex-row-reverse');
    if (iconsGroup) {
      iconsGroup.insertBefore(btn, iconsGroup.firstChild);
    } else {
      container.appendChild(btn);
    }

    console.log('[Lovable Exporter] Button injected ✓');
  }

  // ── Init ──────────────────────────────────────────────────────────────

  async function initialize() {
    // Reload any previously captured messages for this thread
    capturedMessages = await loadMessages();

    // Start capturing what's visible
    scanVisibleMessages();
    startObserver();

    // Inject the button
    injectButton();
    updateButtonLabel();
  }

  // SPA-aware lifecycle
  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(async () => {
        const existing = document.getElementById(BUTTON_ID);
        if (existing) existing.remove();
        closeMenu();
        if (isOnChatPage()) {
          capturedMessages = await loadMessages();
          scanVisibleMessages();
          injectButton();
          updateButtonLabel();
        }
      }, 500);
    }
  });
  urlObserver.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('popstate', async () => {
    setTimeout(async () => {
      const existing = document.getElementById(BUTTON_ID);
      if (existing) existing.remove();
      closeMenu();
      if (isOnChatPage()) {
        capturedMessages = await loadMessages();
        scanVisibleMessages();
        injectButton();
        updateButtonLabel();
      }
    }, 500);
  });

  // Kick off
  if (document.readyState === 'complete') {
    setTimeout(initialize, 800);
  } else {
    window.addEventListener('load', () => setTimeout(initialize, 800));
  }

  // Retry a few times in case nav isn't ready
  let retries = 0;
  const retryInterval = setInterval(() => {
    if (document.getElementById(BUTTON_ID) || retries > 10) {
      clearInterval(retryInterval);
      return;
    }
    retries++;
    injectButton();
  }, 1000);

  // ── Message listener (from popup) ────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg.action) {
      case 'autoScroll':
        autoScrollAndCapture();
        break;
      case 'exportMD':
        downloadBlob(exportMarkdown(), `lovable-chat-${slugDate()}.md`, 'text/markdown');
        break;
      case 'exportHTML':
        downloadBlob(exportHTML(), `lovable-chat-${slugDate()}.html`, 'text/html');
        break;
      case 'exportJSON':
        downloadBlob(exportJSON(), `lovable-chat-${slugDate()}.json`, 'application/json');
        break;
      case 'clearMessages':
        capturedMessages = {};
        updateButtonLabel();
        showToast('Captured messages cleared.');
        break;
    }
  });

})();
