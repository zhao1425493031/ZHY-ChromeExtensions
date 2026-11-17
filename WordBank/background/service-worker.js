/* global importScripts */

importScripts(
  "/lib/detect.js",
  "/lib/conjugate-ja.js",
  "/lib/grammar-ja.js",
  "/lib/grammar-format.js",
  "/lib/translate.js",
  "/lib/enrich-en.js",
  "/lib/enrich-ja.js",
  "/lib/export.js",
  "/lib/display.js"
);

const WORDS_KEY = "words";
const WORDS_MAX = 500;
const MENU_ADD = "wb-add-selection";

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

async function getSelectionFromTab(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      let text = "";
      const ae = document.activeElement;
      if (
        ae &&
        (ae.tagName === "TEXTAREA" ||
          (ae.tagName === "INPUT" &&
            /^(text|search|email|url|tel)$/i.test(ae.type || "text"))) &&
        typeof ae.selectionStart === "number" &&
        ae.selectionStart !== ae.selectionEnd
      ) {
        text = String(ae.value || "")
          .slice(ae.selectionStart, ae.selectionEnd)
          .trim();
      }
      if (
        !text &&
        ae &&
        ae.isContentEditable &&
        window.getSelection
      ) {
        text = String(window.getSelection().toString() || "").trim();
      }
      const sel = window.getSelection();
      if (!text && sel) text = String(sel.toString() || "").trim();

      let context = "";
      if (sel && sel.rangeCount && text) {
        try {
          const node = sel.getRangeAt(0).startContainer;
          const block =
            (node.nodeType === Node.ELEMENT_NODE
              ? node
              : node.parentElement) || document.body;
          const host =
            block.closest("p,li,td,th,h1,h2,h3,h4,blockquote,div") || block;
          context = String(host.innerText || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 240);
        } catch {
          context = "";
        }
      }
      return {
        text,
        context,
        url: location.href,
        title: document.title || "",
      };
    },
  });
  return result || { text: "", context: "", url: "", title: "" };
}

/** Page toast — works even when site hijacks right-click */
async function showToast(tabId, message, kind) {
  if (!tabId || !message) return;
  const tone = kind === "error" ? "error" : kind === "ok" ? "ok" : "info";
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (msg, tone) => {
        const ID = "__wordbank_toast_host__";
        let host = document.getElementById(ID);
        if (!host) {
          host = document.createElement("div");
          host.id = ID;
          host.style.cssText =
            "all:initial;position:fixed;z-index:2147483647;left:0;right:0;top:16px;display:flex;justify-content:center;pointer-events:none;";
          document.documentElement.appendChild(host);
        }
        const el = document.createElement("div");
        const bg =
          tone === "error"
            ? "#b91c1c"
            : tone === "ok"
              ? "#047857"
              : "#4338ca";
        el.style.cssText = [
          "pointer-events:none",
          "max-width:min(92vw,420px)",
          "margin:0 12px",
          "padding:10px 14px",
          "border-radius:10px",
          "background:" + bg,
          "color:#fff",
          "font:600 13px/1.4 Segoe UI,PingFang SC,Microsoft YaHei,sans-serif",
          "box-shadow:0 8px 24px rgba(0,0,0,.22)",
          "opacity:0",
          "transform:translateY(-6px)",
          "transition:opacity .18s ease,transform .18s ease",
          "white-space:pre-wrap",
          "word-break:break-word",
        ].join(";");
        el.textContent = msg;
        host.appendChild(el);
        requestAnimationFrame(() => {
          el.style.opacity = "1";
          el.style.transform = "translateY(0)";
        });
        setTimeout(() => {
          el.style.opacity = "0";
          el.style.transform = "translateY(-6px)";
          setTimeout(() => el.remove(), 220);
        }, tone === "error" ? 3200 : 2200);
      },
      args: [String(message), tone],
    });
  } catch {
    // restricted pages / no scripting
  }
}

function flashBadge(tabId, text) {
  if (!tabId) return;
  try {
    chrome.action.setBadgeText({ tabId, text: text || "+" });
    chrome.action.setBadgeBackgroundColor({
      tabId,
      color: text === "!" ? "#b91c1c" : "#047857",
    });
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId, text: "" });
    }, 1600);
  } catch {
    // ignore
  }
}

function msg(key, fallback) {
  return chrome.i18n.getMessage(key) || fallback || key;
}

async function enrichTerm(term, languageHint) {
  const normalized = WordDetect.normalizeTerm(term);
  let language = languageHint || WordDetect.detectLanguage(normalized);
  if (language === "unknown") language = "en";

  let enriched;
  if (language === "ja") {
    enriched = await EnrichJa.enrichJapanese(normalized);
  } else {
    enriched = await EnrichEn.enrichEnglish(normalized);
    language = "en";
  }
  return { ...enriched, language, term: normalized };
}

async function loadWords() {
  const data = await chrome.storage.local.get({ [WORDS_KEY]: [] });
  return Array.isArray(data[WORDS_KEY]) ? data[WORDS_KEY] : [];
}

async function saveWords(words) {
  await chrome.storage.local.set({ [WORDS_KEY]: words.slice(0, WORDS_MAX) });
}

async function upsertWord(entry) {
  const words = await loadWords();
  const key = `${entry.language}::${(entry.lemma || entry.term || "").toLowerCase()}`;
  const next = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...entry,
  };
  const filtered = words.filter((w) => {
    const k = `${w.language}::${(w.lemma || w.term || "").toLowerCase()}`;
    return k !== key;
  });
  filtered.unshift(next);
  await saveWords(filtered);
  return next;
}

async function patchWordById(id, patch) {
  const words = await loadWords();
  const idx = words.findIndex((w) => w.id === id);
  if (idx < 0) return null;
  const updated = {
    ...words[idx],
    ...patch,
    id: words[idx].id,
    createdAt: words[idx].createdAt,
    updatedAt: Date.now(),
  };
  const next = words.slice();
  next[idx] = updated;
  // keep newest first if lemma changed identity — move to front
  next.splice(idx, 1);
  next.unshift(updated);
  await saveWords(next);
  return updated;
}

function stubEntry(term, languageHint, meta) {
  const normalized = WordDetect.normalizeTerm(term);
  let language = languageHint || WordDetect.detectLanguage(normalized);
  if (language === "unknown") language = "en";
  return {
    language,
    kind: "word",
    term: normalized,
    lemma: normalized,
    phonetic: "",
    pos: [],
    glosses: [],
    glossesZh: [],
    glossesEn: [],
    glossesJa: [],
    forms: {},
    connection: [],
    tips: [],
    parsing: true,
    context: meta.context || "",
    sourceUrl: meta.sourceUrl || "",
    sourceTitle: meta.sourceTitle || "",
  };
}

/**
 * Fast path: save stub immediately → toast → enrich in background.
 */
async function addSelectionFromTab(tab, languageHint, opts) {
  const notify = !(opts && opts.silentToast);
  if (!tab?.id || isRestrictedUrl(tab.url)) {
    if (notify) {
      await showToast(
        tab?.id,
        msg("statusRestricted", "此页面无法划词"),
        "error"
      );
      flashBadge(tab?.id, "!");
    }
    return { ok: false, error: "restricted" };
  }

  let text = (opts && opts.text) || "";
  let context = (opts && opts.context) || "";
  let sourceUrl = (opts && opts.sourceUrl) || tab.url || "";
  let sourceTitle = (opts && opts.sourceTitle) || tab.title || "";

  if (!text) {
    try {
      const sel = await getSelectionFromTab(tab.id);
      text = sel.text || "";
      context = context || sel.context || "";
      sourceUrl = sel.url || sourceUrl;
      sourceTitle = sel.title || sourceTitle;
    } catch {
      // scripting blocked
    }
  }

  if (!text) {
    if (notify) {
      await showToast(
        tab.id,
        msg("statusNoSelection", "请先划选词语"),
        "error"
      );
      flashBadge(tab.id, "!");
    }
    return { ok: false, error: "no_selection" };
  }

  const stub = stubEntry(text, languageHint, {
    context,
    sourceUrl,
    sourceTitle,
  });
  const saved = await upsertWord(stub);
  flashBadge(tab.id, "+");
  if (notify) {
    await showToast(
      tab.id,
      msg("toastAdded", "已加入") + `「${saved.lemma || saved.term}」` +
        msg("toastParsing", "，正在解析…"),
      "info"
    );
  }

  // Background enrich — do not block the caller for long
  (async () => {
    try {
      const enriched = await enrichTerm(saved.term, languageHint || saved.language);
      await patchWordById(saved.id, {
        ...enriched,
        parsing: false,
        context: saved.context,
        sourceUrl: saved.sourceUrl,
        sourceTitle: saved.sourceTitle,
        note: saved.note || "",
      });
      if (notify) {
        await showToast(
          tab.id,
          msg("toastParsed", "解析完成") +
            `「${enriched.lemma || enriched.term || saved.term}」`,
          "ok"
        );
      }
      flashBadge(tab.id, "✓");
    } catch (err) {
      await patchWordById(saved.id, { parsing: false, parseError: true });
      if (notify) {
        await showToast(
          tab.id,
          msg("toastParseFailed", "已加入，但解析失败，可在词库里点重新解析"),
          "error"
        );
      }
      flashBadge(tab.id, "!");
      console.error(err);
    }
  })();

  return { ok: true, word: saved, pending: true };
}

function ensureContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ADD,
      title: chrome.i18n.getMessage("ctxAdd") || "Add to WordBank",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: MENU_ADD + "-en",
      parentId: MENU_ADD,
      title: chrome.i18n.getMessage("ctxAddEn") || "As English",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: MENU_ADD + "-ja",
      parentId: MENU_ADD,
      title: chrome.i18n.getMessage("ctxAddJa") || "As Japanese",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: MENU_ADD + "-auto",
      parentId: MENU_ADD,
      title: chrome.i18n.getMessage("ctxAddAuto") || "Auto detect",
      contexts: ["selection"],
    });
  });
}

chrome.runtime.onInstalled.addListener(ensureContextMenus);
chrome.runtime.onStartup.addListener(ensureContextMenus);
ensureContextMenus();

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  let hint = "";
  if (info.menuItemId === MENU_ADD + "-en") hint = "en";
  else if (info.menuItemId === MENU_ADD + "-ja") hint = "ja";
  else if (
    info.menuItemId === MENU_ADD ||
    info.menuItemId === MENU_ADD + "-auto"
  ) {
    hint = "";
  } else return;

  try {
    await addSelectionFromTab(tab, hint || undefined, {
      text: info.selectionText ? String(info.selectionText).trim() : "",
    });
  } catch (err) {
    console.error(err);
    await showToast(
      tab.id,
      msg("statusFailed", "处理失败，请重试"),
      "error"
    );
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "add-selection") return;
  try {
    const tab = await getActiveTab();
    if (!tab) {
      return;
    }
    await addSelectionFromTab(tab);
  } catch (err) {
    console.error(err);
    try {
      const tab = await getActiveTab();
      if (tab?.id) {
        await showToast(
          tab.id,
          msg("statusFailed", "处理失败，请重试"),
          "error"
        );
      }
    } catch {
      // ignore
    }
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "ADD_SELECTION") {
    (async () => {
      try {
        const tab = await getActiveTab();
        const result = await addSelectionFromTab(tab, msg.language);
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

  if (msg.type === "ADD_TERM") {
    (async () => {
      try {
        const enriched = await enrichTerm(msg.term, msg.language);
        const saved = await upsertWord({
          ...enriched,
          context: msg.context || "",
          sourceUrl: msg.sourceUrl || "",
          sourceTitle: msg.sourceTitle || "",
          note: msg.note || "",
        });
        sendResponse({ ok: true, word: saved });
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

  if (msg.type === "LIST_WORDS") {
    (async () => {
      const words = await loadWords();
      sendResponse({ ok: true, words });
    })();
    return true;
  }

  if (msg.type === "DELETE_WORD") {
    (async () => {
      const words = await loadWords();
      await saveWords(words.filter((w) => w.id !== msg.id));
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === "CLEAR_WORDS") {
    (async () => {
      await saveWords([]);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === "REFRESH_WORD") {
    (async () => {
      try {
        const words = await loadWords();
        const current = words.find((w) => w.id === msg.id);
        if (!current) {
          sendResponse({ ok: false, error: "missing" });
          return;
        }
        const enriched = await enrichTerm(
          current.term || current.lemma,
          current.language
        );
        const updated = {
          ...current,
          ...enriched,
          id: current.id,
          createdAt: current.createdAt,
          updatedAt: Date.now(),
          context: current.context,
          sourceUrl: current.sourceUrl,
          sourceTitle: current.sourceTitle,
          note: current.note || "",
        };
        await saveWords(
          words.map((w) => (w.id === updated.id ? updated : w))
        );
        sendResponse({ ok: true, word: updated });
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

  if (msg.type === "OPEN_VIEWER") {
    (async () => {
      try {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const key = `viewer:${id}`;
        const words = Array.isArray(msg.words)
          ? msg.words
          : await loadWords();
        await chrome.storage.session.set({
          [key]: {
            words,
            selectedId: msg.selectedId || "",
            title: msg.title || "WordBank",
          },
        });
        const url = chrome.runtime.getURL(
          `viewer/viewer.html?id=${encodeURIComponent(id)}`
        );
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

  if (msg.type === "EXPORT_DOWNLOAD") {
    (async () => {
      try {
        const words = Array.isArray(msg.words)
          ? msg.words
          : await loadWords();
        const settings = await WordDisplay.loadSettings();
        const format = msg.format || "csv";
        let content = "";
        let filename = "wordbank-export.csv";
        let mime = "text/csv;charset=utf-8";

        if (format === "xls") {
          content = WordExport.toExcelXml(words, settings.displayLang);
          filename = "wordbank-export.xls";
          mime = "application/vnd.ms-excel;charset=utf-8";
        } else if (format === "pdf") {
          content = WordExport.toA4Html(words, "WordBank", settings);
          filename = "wordbank-a4.html";
          mime = "text/html;charset=utf-8";
        } else {
          content = WordExport.toCsv(words, settings.displayLang);
          filename = "wordbank-export.csv";
          mime = "text/csv;charset=utf-8";
        }

        const blobUrl =
          "data:" +
          mime +
          "," +
          encodeURIComponent(content);

        if (format === "pdf") {
          // Open A4 print page in a tab (Save as PDF from print dialog)
          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const key = `print:${id}`;
          await chrome.storage.session.set({ [key]: { html: content } });
          await chrome.tabs.create({
            url: chrome.runtime.getURL(
              `viewer/print.html?id=${encodeURIComponent(id)}`
            ),
          });
          sendResponse({ ok: true, mode: "print-tab" });
          return;
        }

        await chrome.downloads.download({
          url: blobUrl,
          filename,
          saveAs: true,
        });
        sendResponse({ ok: true });
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
