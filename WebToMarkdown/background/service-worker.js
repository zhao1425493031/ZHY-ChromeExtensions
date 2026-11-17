const HISTORY_KEY = "history";
const HISTORY_MAX = 30;
const MENU_SELECTION = "w2m-selection-copy";
const MENU_PAGE = "w2m-page-copy";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isRestrictedUrl(url) {
  if (!url) return true;
  return (
    /^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(url) ||
    /chrome\.google\.com\/webstore/i.test(url)
  );
}

async function loadOptions() {
  return chrome.storage.sync.get({
    selectionOnly: false,
    includeMeta: true,
    keepImages: true,
    yamlFrontMatter: false,
  });
}

async function pushHistory(entry) {
  if (!entry?.markdown?.trim()) return;
  const data = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
  const prev = Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: entry.title || "page",
    url: entry.url || "",
    markdown: entry.markdown,
    mode: entry.mode || "article",
    createdAt: Date.now(),
  };
  const next = [
    item,
    ...prev.filter((h) => h && h.markdown !== item.markdown),
  ].slice(0, HISTORY_MAX);
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
}

/**
 * Inject libs + convert in the page (has DOMParser).
 */
async function convertTab(tabId, options) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["lib/html2md.js", "lib/extract.js"],
  });

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (opts) => {
      const extracted = extractPageContent({
        selectionOnly: !!opts.selectionOnly,
      });
      if (extracted.selectionEmpty) {
        return { ok: false, error: "no_selection" };
      }
      const body = WebToMd.htmlToMarkdown(extracted.html || "", {
        keepImages: opts.keepImages !== false,
        baseUrl: extracted.url,
      });
      const markdown = WebToMd.buildDocument(body, {
        includeMeta: !!opts.includeMeta,
        yamlFrontMatter: !!opts.yamlFrontMatter,
        title: extracted.title,
        url: extracted.url,
        date: new Date().toISOString(),
      });
      if (!String(markdown || "").trim()) {
        return { ok: false, error: "empty" };
      }
      return {
        ok: true,
        markdown,
        title: extracted.title,
        url: extracted.url,
        mode: extracted.mode,
      };
    },
    args: [options],
  });

  return result || { ok: false, error: "failed" };
}

async function copyTextInTab(tabId, text) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: async (value) => {
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.style.cssText = "position:fixed;left:-9999px;top:0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
    },
    args: [text],
  });
}

async function flashOk(tabId) {
  chrome.action.setBadgeText({ tabId, text: "OK" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#0f766e" });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: "" });
  }, 1500);
}

async function convertCopyAndRemember(tab, overrides) {
  const stored = await loadOptions();
  const options = { ...stored, ...(overrides || {}) };
  const result = await convertTab(tab.id, options);
  if (!result?.ok || !result.markdown) return result;
  await copyTextInTab(tab.id, result.markdown);
  await pushHistory(result);
  await flashOk(tab.id);
  return result;
}

function ensureContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_SELECTION,
      title: chrome.i18n.getMessage("ctxSelection") || "Copy selection as Markdown",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: MENU_PAGE,
      title: chrome.i18n.getMessage("ctxPage") || "Copy page as Markdown",
      contexts: ["page"],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  ensureContextMenus();
});

ensureContextMenus();

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || isRestrictedUrl(tab.url)) return;
  try {
    if (info.menuItemId === MENU_SELECTION) {
      await convertCopyAndRemember(tab, { selectionOnly: true });
    } else if (info.menuItemId === MENU_PAGE) {
      await convertCopyAndRemember(tab, { selectionOnly: false });
    }
  } catch {
    // ignore restricted / permission errors
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "CONVERT_ACTIVE_TAB") {
    (async () => {
      try {
        const tab = await getActiveTab();
        if (!tab?.id) {
          sendResponse({ ok: false, error: "no_tab" });
          return;
        }
        if (isRestrictedUrl(tab.url)) {
          sendResponse({ ok: false, error: "restricted" });
          return;
        }
        const stored = await loadOptions();
        const options = { ...stored, ...(msg.options || {}) };
        const result = await convertTab(tab.id, options);
        if (result?.ok) await pushHistory(result);
        sendResponse(result);
      } catch (err) {
        sendResponse({
          ok: false,
          error: "failed",
          detail: String(err && err.message ? err.message : err),
        });
      }
    })();
    return true;
  }

  if (msg.type === "GET_HISTORY") {
    (async () => {
      const data = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
      sendResponse({
        ok: true,
        history: Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [],
      });
    })();
    return true;
  }

  if (msg.type === "CLEAR_HISTORY") {
    (async () => {
      await chrome.storage.local.set({ [HISTORY_KEY]: [] });
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === "DELETE_HISTORY_ITEM") {
    (async () => {
      const id = msg.id;
      const data = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
      const prev = Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
      await chrome.storage.local.set({
        [HISTORY_KEY]: prev.filter((h) => h && h.id !== id),
      });
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === "SAVE_HISTORY") {
    (async () => {
      await pushHistory(msg.entry || {});
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === "OPEN_VIEWER") {
    (async () => {
      try {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const key = `viewer:${id}`;
        await chrome.storage.session.set({
          [key]: {
            title: msg.title || "page",
            url: msg.url || "",
            markdown: msg.markdown || "",
          },
        });
        const url = chrome.runtime.getURL(`viewer/viewer.html?id=${encodeURIComponent(id)}`);
        await chrome.tabs.create({ url });
        sendResponse({ ok: true, id });
      } catch (err) {
        sendResponse({
          ok: false,
          error: String(err && err.message ? err.message : err),
        });
      }
    })();
    return true;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "copy-markdown") return;
  try {
    const tab = await getActiveTab();
    if (!tab?.id || isRestrictedUrl(tab.url)) return;
    await convertCopyAndRemember(tab, { selectionOnly: false });
  } catch {
    // ignore
  }
});
