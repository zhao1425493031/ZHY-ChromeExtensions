const HISTORY_KEY = "pa_history";
const HISTORY_LIMIT = 20;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(HISTORY_KEY, (data) => {
    if (!Array.isArray(data[HISTORY_KEY])) {
      chrome.storage.local.set({ [HISTORY_KEY]: [] });
    }
  });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-annotate") return;
  const tab = await getActiveTab();
  if (!tab?.id) return;
  if (!isInjectableUrl(tab.url)) return;
  await ensureInjected(tab.id);
  await chrome.tabs.sendMessage(tab.id, { type: "PA_TOGGLE" });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = {
    PA_START_FROM_POPUP: handleStartFromPopup,
    PA_CAPTURE_RAW: () => handleCaptureRaw(sender),
    PA_COMMIT: () => handleCommit(sender, message),
    PA_OPEN_IMAGE: () => handleOpenImage(message.dataUrl),
    PA_GET_HISTORY: handleGetHistory,
    PA_CLEAR_HISTORY: handleClearHistory,
    PA_DELETE_HISTORY: () => handleDeleteHistory(message.id)
  };

  const handler = handlers[message?.type];
  if (!handler) return;

  Promise.resolve()
    .then(handler)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) =>
      sendResponse({ ok: false, error: error?.message || String(error) })
    );

  return true;
});

async function handleStartFromPopup() {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error(i18n("errNoTab"));
  if (!isInjectableUrl(tab.url)) {
    throw new Error(i18n("errBadPage"));
  }
  await ensureInjected(tab.id);
  await chrome.tabs.sendMessage(tab.id, { type: "PA_START" });
  return { tabId: tab.id };
}

async function handleCaptureRaw(sender) {
  const windowId = sender.tab?.windowId;
  if (windowId == null) throw new Error(i18n("errNoTabLocate"));
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: "png"
  });
  return { dataUrl };
}

async function handleOpenImage(dataUrl) {
  if (!dataUrl) throw new Error(i18n("toastCaptureFail"));
  // Prefer opening the just-downloaded / full-resolution capture in a tab.
  await chrome.tabs.create({ url: dataUrl, active: true });
  return {};
}

async function handleCommit(sender, message) {
  const dataUrl = message?.dataUrl;
  if (!dataUrl) throw new Error(i18n("toastCaptureFail"));

  const meta = {
    id: `pa_${Date.now()}`,
    createdAt: Date.now(),
    url: sender.tab?.url || "",
    title: sender.tab?.title || "",
    dataUrl,
    note: String(message?.note || "").slice(0, 2000)
  };

  await pushHistory(meta);

  if (message?.download) {
    const filename = `PageAnnotate_${formatStamp(meta.createdAt)}.png`;
    await chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs: false
    });
  }

  return { id: meta.id, dataUrl };
}

async function handleGetHistory() {
  return { items: await getHistory() };
}

async function handleClearHistory() {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
  return { items: [] };
}

async function handleDeleteHistory(id) {
  const list = await getHistory();
  const next = list.filter((item) => item.id !== id);
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
  return { items: next };
}

async function pushHistory(item) {
  const list = await getHistory();
  const next = [item, ...list].slice(0, HISTORY_LIMIT);
  try {
    await chrome.storage.local.set({ [HISTORY_KEY]: next });
  } catch {
    const slim = next.map((entry, index) =>
      index < 5 ? entry : { ...entry, dataUrl: "" }
    );
    await chrome.storage.local.set({ [HISTORY_KEY]: slim });
  }
}

function getHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get(HISTORY_KEY, (data) => {
      resolve(Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : []);
    });
  });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function isInjectableUrl(url = "") {
  if (!url) return false;
  return /^(https?:|file:)/i.test(url);
}

async function ensureInjected(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(window.__PAGE_ANNOTATE__)
    });
    if (result) return;
  } catch {
    // inject below
  }

  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["content/annotate.css"]
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/annotate.js"]
  });
}

function formatStamp(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function i18n(key) {
  return chrome.i18n.getMessage(key) || key;
}
