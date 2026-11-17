(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const el = {
    title: $("doc-title"),
    source: $("doc-source"),
    md: $("md"),
    html: $("html"),
    sync: $("opt-sync"),
    syncWrap: $("sync-wrap"),
    copy: $("btn-copy"),
    status: $("status"),
    divider: $("divider"),
    workspace: $("workspace"),
    tabMd: $("tab-md"),
    tabPreview: $("tab-preview"),
    tabSplit: $("tab-split"),
  };

  let mode = "split"; // md | preview | split
  let syncingScroll = false;
  let renderTimer = null;

  function t(key) {
    return chrome.i18n.getMessage(key) || key;
  }

  function applyI18n() {
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      const text = t(node.getAttribute("data-i18n"));
      if (text) node.textContent = text;
    });
  }

  function setStatus(msg) {
    if (!msg) {
      el.status.hidden = true;
      el.status.textContent = "";
      return;
    }
    el.status.hidden = false;
    el.status.textContent = msg;
  }

  function renderHtml() {
    el.html.innerHTML = globalThis.MdPreview.markdownToHtml(el.md.value || "");
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderHtml, 80);
  }

  function applyMode(next) {
    mode = next === "md" || next === "preview" || next === "split" ? next : "split";
    document.body.classList.remove("mode-md", "mode-preview", "mode-split");
    document.body.classList.add(`mode-${mode}`);

    el.tabMd.classList.toggle("active", mode === "md");
    el.tabPreview.classList.toggle("active", mode === "preview");
    el.tabSplit.classList.toggle("active", mode === "split");
    el.tabMd.setAttribute("aria-selected", String(mode === "md"));
    el.tabPreview.setAttribute("aria-selected", String(mode === "preview"));
    el.tabSplit.setAttribute("aria-selected", String(mode === "split"));

    el.syncWrap.hidden = mode !== "split";

    if (mode === "md" || mode === "preview") {
      el.workspace.style.gridTemplateColumns = "";
      el.workspace.style.gridTemplateRows = "";
    }

    if (mode !== "md") renderHtml();
    chrome.storage.sync.set({ viewerMode: mode });
  }

  function scrollRatio(node) {
    const max = node.scrollHeight - node.clientHeight;
    if (max <= 0) return 0;
    return node.scrollTop / max;
  }

  function applyScrollRatio(node, ratio) {
    const max = node.scrollHeight - node.clientHeight;
    if (max <= 0) {
      node.scrollTop = 0;
      return;
    }
    node.scrollTop = ratio * max;
  }

  function bindSyncScroll(from, to) {
    from.addEventListener(
      "scroll",
      () => {
        if (mode !== "split" || !el.sync.checked || syncingScroll) return;
        syncingScroll = true;
        applyScrollRatio(to, scrollRatio(from));
        requestAnimationFrame(() => {
          syncingScroll = false;
        });
      },
      { passive: true }
    );
  }

  function setupDivider() {
    let dragging = false;

    const onMove = (ev) => {
      if (!dragging || mode !== "split") return;
      const rect = el.workspace.getBoundingClientRect();
      const vertical = window.matchMedia("(max-width: 800px)").matches;
      if (vertical) {
        const y = ev.clientY - rect.top;
        const ratio = Math.min(0.8, Math.max(0.2, y / rect.height));
        el.workspace.style.gridTemplateColumns = "1fr";
        el.workspace.style.gridTemplateRows = `${ratio}fr 6px ${1 - ratio}fr`;
      } else {
        const x = ev.clientX - rect.left;
        const ratio = Math.min(0.8, Math.max(0.2, x / rect.width));
        el.workspace.style.gridTemplateRows = "";
        el.workspace.style.gridTemplateColumns = `${ratio}fr 6px ${1 - ratio}fr`;
      }
    };

    const stop = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
    };

    el.divider.addEventListener("pointerdown", (ev) => {
      if (mode !== "split") return;
      ev.preventDefault();
      dragging = true;
      document.body.classList.add("resizing");
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop);
    });
  }

  async function loadDoc() {
    const stored = await chrome.storage.sync.get({ viewerMode: "split" });
    const preferred = stored.viewerMode;

    const id = new URLSearchParams(location.search).get("id");
    if (!id) {
      el.md.value = "";
      el.title.textContent = "WebToMarkdown";
      applyMode(preferred);
      return;
    }
    const key = `viewer:${id}`;
    const data = await chrome.storage.session.get(key);
    const doc = data[key];
    if (!doc) {
      el.title.textContent = t("viewerMissing");
      el.md.value = "";
      applyMode(preferred);
      return;
    }
    el.title.textContent = doc.title || "WebToMarkdown";
    document.title = doc.title || "WebToMarkdown";
    el.md.value = doc.markdown || "";
    if (doc.url) {
      el.source.hidden = false;
      el.source.href = doc.url;
      el.source.textContent = doc.url;
    }
    applyMode(preferred);
  }

  el.tabMd.addEventListener("click", () => applyMode("md"));
  el.tabPreview.addEventListener("click", () => applyMode("preview"));
  el.tabSplit.addEventListener("click", () => applyMode("split"));

  el.copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(el.md.value || "");
      setStatus(t("statusCopied"));
    } catch {
      el.md.focus();
      el.md.select();
      document.execCommand("copy");
      setStatus(t("statusCopied"));
    }
  });

  el.md.addEventListener("input", () => {
    if (mode !== "md") scheduleRender();
  });

  bindSyncScroll(el.md, el.html);
  bindSyncScroll(el.html, el.md);
  setupDivider();

  applyI18n();
  loadDoc();
})();
