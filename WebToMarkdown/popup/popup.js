(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const el = {
    convert: $("btn-convert"),
    previewBtn: $("btn-preview"),
    copy: $("btn-copy"),
    download: $("btn-download"),
    selection: $("opt-selection"),
    meta: $("opt-meta"),
    yaml: $("opt-yaml"),
    images: $("opt-images"),
    preview: $("preview"),
    status: $("status"),
    historyList: $("history-list"),
    historyEmpty: $("history-empty"),
    clearHistory: $("btn-clear-history"),
  };

  let lastTitle = "page";
  let lastUrl = "";

  function t(key, substitutions) {
    const msg = chrome.i18n.getMessage(key, substitutions);
    return msg || key;
  }

  function applyI18n() {
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      const key = node.getAttribute("data-i18n");
      const text = t(key);
      if (text) node.textContent = text;
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
      const key = node.getAttribute("data-i18n-placeholder");
      const text = t(key);
      if (text) node.setAttribute("placeholder", text);
    });
  }

  function setStatus(message, isError) {
    if (!message) {
      el.status.hidden = true;
      el.status.textContent = "";
      return;
    }
    el.status.hidden = false;
    el.status.textContent = message;
    el.status.classList.toggle("error", !!isError);
  }

  function setMarkdown(text, title, url) {
    el.preview.value = text || "";
    lastTitle = title || "page";
    lastUrl = url || "";
    const has = !!(text && text.trim());
    el.copy.disabled = !has;
    el.download.disabled = !has;
    el.previewBtn.disabled = !has;
  }

  function readOptionsFromUi() {
    return {
      selectionOnly: el.selection.checked,
      includeMeta: el.meta.checked || el.yaml.checked,
      yamlFrontMatter: el.yaml.checked,
      keepImages: el.images.checked,
    };
  }

  async function persistOptions() {
    await chrome.storage.sync.set({
      selectionOnly: el.selection.checked,
      includeMeta: el.meta.checked,
      yamlFrontMatter: el.yaml.checked,
      keepImages: el.images.checked,
    });
  }

  async function loadOptions() {
    const data = await chrome.storage.sync.get({
      selectionOnly: false,
      includeMeta: true,
      keepImages: true,
      yamlFrontMatter: false,
    });
    el.selection.checked = !!data.selectionOnly;
    el.meta.checked = !!data.includeMeta;
    el.yaml.checked = !!data.yamlFrontMatter;
    el.images.checked = !!data.keepImages;
  }

  function errorMessage(code) {
    switch (code) {
      case "no_tab":
        return t("statusNoTab");
      case "restricted":
        return t("statusRestricted");
      case "empty":
        return t("statusEmpty");
      case "no_selection":
        return t("statusNoSelection");
      default:
        return t("statusEmpty");
    }
  }

  function formatTime(ts) {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return "";
    }
  }

  async function openPreviewTab(markdown, title, url) {
    const text = (markdown || "").trim();
    if (!text) return;
    await chrome.runtime.sendMessage({
      type: "OPEN_VIEWER",
      markdown: text,
      title: title || lastTitle || "page",
      url: url || lastUrl || "",
    });
  }

  async function refreshHistory() {
    const response = await chrome.runtime.sendMessage({ type: "GET_HISTORY" });
    const items = response?.history || [];
    el.historyList.innerHTML = "";
    el.historyEmpty.hidden = items.length > 0;

    items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "hist-card";
      card.title = item.url || "";

      const meta = document.createElement("div");
      meta.className = "meta";
      const title = document.createElement("div");
      title.className = "title";
      title.textContent = item.title || "page";
      const note = document.createElement("div");
      note.className = "note";
      const modeLabel =
        item.mode === "selection" ? t("modeSelection") : t("modeArticle");
      note.textContent = `${modeLabel} · ${formatTime(item.createdAt)}`;
      meta.append(title, note);

      const actions = document.createElement("div");
      actions.className = "hist-actions";

      const btnDelete = document.createElement("button");
      btnDelete.type = "button";
      btnDelete.className = "btn danger";
      btnDelete.textContent = t("btnDelete");
      btnDelete.addEventListener("click", async (e) => {
        e.stopPropagation();
        await chrome.runtime.sendMessage({
          type: "DELETE_HISTORY_ITEM",
          id: item.id,
        });
        await refreshHistory();
        setStatus(t("statusItemDeleted"));
      });

      const btnLoad = document.createElement("button");
      btnLoad.type = "button";
      btnLoad.className = "btn";
      btnLoad.textContent = t("btnLoad");
      btnLoad.addEventListener("click", (e) => {
        e.stopPropagation();
        setMarkdown(item.markdown, item.title, item.url);
        setStatus(t("statusLoaded"));
      });

      const btnCopy = document.createElement("button");
      btnCopy.type = "button";
      btnCopy.className = "btn";
      btnCopy.textContent = t("btnCopy");
      btnCopy.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(item.markdown || "");
          setStatus(t("statusCopied"));
        } catch {
          setMarkdown(item.markdown, item.title, item.url);
          await copyMarkdown();
        }
      });

      actions.append(btnDelete, btnLoad, btnCopy);
      card.append(meta, actions);
      card.addEventListener("click", () => {
        setMarkdown(item.markdown, item.title, item.url);
        setStatus(t("statusLoaded"));
      });
      el.historyList.appendChild(card);
    });
  }

  async function convert() {
    el.convert.disabled = true;
    setStatus("");
    try {
      await persistOptions();
      const response = await chrome.runtime.sendMessage({
        type: "CONVERT_ACTIVE_TAB",
        options: readOptionsFromUi(),
      });
      if (!response?.ok) {
        setMarkdown("");
        setStatus(errorMessage(response?.error), true);
        return;
      }
      setMarkdown(response.markdown, response.title, response.url);
      setStatus(t("statusOk", [String(response.markdown.length)]));
      await refreshHistory();
    } catch (err) {
      setMarkdown("");
      setStatus(errorMessage("failed"), true);
      console.error(err);
    } finally {
      el.convert.disabled = false;
    }
  }

  async function copyMarkdown() {
    const text = el.preview.value;
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus(t("statusCopied"));
    } catch {
      el.preview.focus();
      el.preview.select();
      document.execCommand("copy");
      setStatus(t("statusCopied"));
    }
  }

  function safeFilename(title) {
    const base = (title || "page")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    return (base || "page") + ".md";
  }

  async function downloadMarkdown() {
    const text = el.preview.value;
    if (!text.trim()) return;
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      await chrome.downloads.download({
        url,
        filename: safeFilename(lastTitle),
        saveAs: true,
      });
      setStatus(t("statusDownloaded"));
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }

  async function clearHistory() {
    await chrome.runtime.sendMessage({ type: "CLEAR_HISTORY" });
    await refreshHistory();
    setStatus(t("statusHistoryCleared"));
  }

  el.convert.addEventListener("click", convert);
  el.previewBtn.addEventListener("click", () =>
    openPreviewTab(el.preview.value, lastTitle, lastUrl)
  );
  el.copy.addEventListener("click", copyMarkdown);
  el.download.addEventListener("click", downloadMarkdown);
  el.clearHistory.addEventListener("click", clearHistory);
  el.preview.addEventListener("input", () => {
    const has = !!el.preview.value.trim();
    el.copy.disabled = !has;
    el.download.disabled = !has;
    el.previewBtn.disabled = !has;
  });
  [el.selection, el.meta, el.yaml, el.images].forEach((input) => {
    input.addEventListener("change", persistOptions);
  });

  applyI18n();
  Promise.all([loadOptions(), refreshHistory()]).then(() => convert());
})();
