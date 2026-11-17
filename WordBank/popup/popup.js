(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const el = {
    add: $("btn-add"),
    openTab: $("btn-open-tab"),
    excel: $("btn-excel"),
    pdf: $("btn-pdf"),
    clear: $("btn-clear"),
    search: $("search"),
    list: $("word-list"),
    empty: $("empty"),
    detail: $("detail"),
    status: $("status"),
    filterAll: $("filter-all"),
    filterEn: $("filter-en"),
    filterJa: $("filter-ja"),
  };

  let words = [];
  let filter = "all";
  let query = "";
  let selectedId = "";
  let settings = { displayLang: "zh", glossMode: "zh_only" };

  function t(key) {
    return chrome.i18n.getMessage(key) || key;
  }

  function applyI18n() {
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      const text = t(node.getAttribute("data-i18n"));
      if (text) node.textContent = text;
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
      const text = t(node.getAttribute("data-i18n-placeholder"));
      if (text) node.setAttribute("placeholder", text);
    });
  }

  function setStatus(msg, isError) {
    if (!msg) {
      el.status.hidden = true;
      el.status.textContent = "";
      return;
    }
    el.status.hidden = false;
    el.status.textContent = msg;
    el.status.classList.toggle("error", !!isError);
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function filteredWords() {
    const q = query.trim().toLowerCase();
    return words.filter((w) => {
      if (filter !== "all" && w.language !== filter) return false;
      if (!q) return true;
      const blob = [
        w.term,
        w.lemma,
        w.phonetic,
        ...(w.glossesZh || []),
        ...(w.glossesEn || []),
        ...(w.glossesJa || []),
        ...(w.glosses || []),
        ...(w.pos || []),
      ]
        .join("\n")
        .toLowerCase();
      return blob.includes(q);
    });
  }

  function formatForms(forms) {
    if (!forms || typeof forms !== "object") return "";
    return Object.entries(forms)
      .map(
        ([k, v]) =>
          `<div class="form-row"><span class="k">${escapeHtml(
            k
          )}</span><span class="v">${escapeHtml(String(v))}</span></div>`
      )
      .join("");
  }

  function glossBlock(title, items) {
    if (!items || !items.length) return "";
    return `<div class="block"><h3>${escapeHtml(title)}</h3><ul>${items
      .map((g) => `<li>${escapeHtml(g)}</li>`)
      .join("")}</ul></div>`;
  }

  function connectionBlock(w) {
    const lines = GrammarFormat.connectionLines(w.connection, "zh");
    if (!lines.length) return "";
    return `<div class="block block-conn"><h3>${t(
      "labelConnection"
    )}</h3><ul class="conn-list">${lines
      .map((c) => `<li><span class="conn-pill">${escapeHtml(c)}</span></li>`)
      .join("")}</ul></div>`;
  }

  function examplesBlock(w) {
    const inner = GrammarFormat.examplesHtml(w, escapeHtml);
    if (!inner) return "";
    return `<div class="block block-ex"><h3>${t(
      "labelExamples"
    )}</h3><ul class="ex-list">${inner}</ul></div>`;
  }

  function tipsBlock(w) {
    const lines = GrammarFormat.tipLines(w, "zh");
    if (!lines.length) return "";
    return `<div class="block block-tips"><h3>${t(
      "labelTips"
    )}</h3><ul>${lines
      .map((g) => `<li>${escapeHtml(g)}</li>`)
      .join("")}</ul></div>`;
  }

  function glossTitle(key) {
    if (key === "zh") return t("labelGlossZh");
    if (key === "en") return t("labelGlossEn");
    return t("labelGlossJa");
  }

  function cardMarkdown(w) {
    const lines = [];
    const pos = WordDisplay.formatPosList(w.pos, "zh");
    const sections = WordDisplay.visibleGlossSections(w);
    lines.push(`# ${w.lemma || w.term}`);
    if (w.phonetic) lines.push(`> ${w.phonetic}`);
    if (w.jlpt) lines.push(`- JLPT: ${String(w.jlpt).toUpperCase()}`);
    if (pos.length) lines.push(`- ${t("labelPos")}: ${pos.join(", ")}`);
    sections.forEach((sec) => {
      lines.push("", `## ${t("labelGlossZh")}`);
      sec.items.forEach((g) => lines.push(`- ${g}`));
    });
    const conn = GrammarFormat.connectionLines(w.connection, "zh");
    if (conn.length) {
      lines.push("", `## ${t("labelConnection")}`);
      conn.forEach((c) => lines.push(`- ${c}`));
    }
    const ex = GrammarFormat.exampleItems(w);
    if (ex.length) {
      lines.push("", `## ${t("labelExamples")}`);
      ex.forEach((e) => lines.push(`- ${e.ja}`));
    }
    const tips = GrammarFormat.tipLines(w, "zh");
    if (tips.length) {
      lines.push("", `## ${t("labelTips")}`);
      tips.forEach((c) => lines.push(`- ${c}`));
    }
    if (
      !(w.isGrammar || w.kind === "grammar") &&
      w.forms &&
      Object.keys(w.forms).length
    ) {
      lines.push("", `## ${t("labelForms")}`);
      Object.entries(w.forms).forEach(([k, v]) =>
        lines.push(`- ${k}: ${v}`)
      );
    }
    return lines.join("\n");
  }

  function renderDetail(w) {
    if (!w) {
      el.detail.innerHTML = `<p class="detail-placeholder">${t("hintPick")}</p>`;
      return;
    }

    const formsHtml = formatForms(w.forms);
    const pos = WordDisplay.formatPosList(w.pos, "zh");
    const sections = WordDisplay.visibleGlossSections(w);
    const glossHtml = sections
      .map((sec) => glossBlock(t("labelGlossZh"), sec.items))
      .join("");
    const isGrammar = !!(w.isGrammar || w.kind === "grammar");
    const level = w.jlpt ? String(w.jlpt).toUpperCase() : "";

    el.detail.innerHTML = `
      <div class="detail-title-row">
        <span class="lang-tag">${escapeHtml(
          isGrammar ? "文法" : (w.language || "").toUpperCase()
        )}</span>
        ${
          level
            ? `<span class="level-tag">${escapeHtml(level)}</span>`
            : ""
        }
        <h2 class="detail-title">${escapeHtml(w.lemma || w.term || "")}</h2>
      </div>
      ${
        w.phonetic
          ? `<p class="phonetic">${escapeHtml(w.phonetic)}</p>`
          : ""
      }
      <div class="detail-actions">
        <button type="button" class="btn" id="btn-copy-card">${t(
          "btnCopyCard"
        )}</button>
        <button type="button" class="btn" id="btn-refresh">${t(
          "btnRefresh"
        )}</button>
        <button type="button" class="btn danger" id="btn-delete">${t(
          "btnDelete"
        )}</button>
      </div>
      ${
        pos.length
          ? `<div class="block"><h3>${t("labelPos")}</h3><p>${escapeHtml(
              pos.join(" · ")
            )}</p></div>`
          : ""
      }
      ${glossHtml}
      ${connectionBlock(w)}
      ${examplesBlock(w)}
      ${tipsBlock(w)}
      ${
        !isGrammar && formsHtml
          ? `<div class="block"><h3>${t(
              "labelForms"
            )}</h3><div class="forms">${formsHtml}</div></div>`
          : ""
      }
    `;

    $("btn-copy-card")?.addEventListener("click", async () => {
      await navigator.clipboard.writeText(cardMarkdown(w));
      setStatus(t("statusCopied"));
    });
    $("btn-refresh")?.addEventListener("click", async () => {
      const res = await chrome.runtime.sendMessage({
        type: "REFRESH_WORD",
        id: w.id,
      });
      if (!res?.ok) {
        setStatus(t("statusFailed"), true);
        return;
      }
      selectedId = res.word.id;
      await reload();
      setStatus(t("statusRefreshed"));
    });
    $("btn-delete")?.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "DELETE_WORD", id: w.id });
      selectedId = "";
      await reload();
      setStatus(t("statusDeleted"));
    });
  }

  function renderList() {
    const items = filteredWords();
    el.list.innerHTML = "";
    el.empty.hidden = items.length > 0;

    if (!items.some((w) => w.id === selectedId)) {
      selectedId = items[0] ? items[0].id : "";
    }

    items.forEach((w) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "word-item" + (w.id === selectedId ? " active" : "");
      const isGrammar = !!(w.isGrammar || w.kind === "grammar");
      const level = w.jlpt ? String(w.jlpt).toUpperCase() : "";
      btn.innerHTML = `
        <span class="lang-tag">${escapeHtml(
          isGrammar ? "文法" : (w.language || "").toUpperCase()
        )}</span>
        <span class="body">
          <div class="term">${escapeHtml(w.lemma || w.term || "")}${
            level
              ? ` <span class="level-tag">${escapeHtml(level)}</span>`
              : ""
          }</div>
          <div class="meta">${escapeHtml(
            w.parsing ? t("statusParsing") : WordDisplay.previewGloss(w)
          )}</div>
        </span>
      `;
      btn.addEventListener("click", () => {
        selectedId = w.id;
        renderList();
        renderDetail(w);
      });
      el.list.appendChild(btn);
    });

    renderDetail(items.find((w) => w.id === selectedId) || null);
  }

  async function reload() {
    const res = await chrome.runtime.sendMessage({ type: "LIST_WORDS" });
    words = res?.words || [];
    renderList();
  }

  function setFilter(next) {
    filter = next;
    [el.filterAll, el.filterEn, el.filterJa].forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.filter === filter);
    });
    renderList();
  }

  el.add.addEventListener("click", async () => {
    el.add.disabled = true;
    setStatus("");
    try {
      const res = await chrome.runtime.sendMessage({ type: "ADD_SELECTION" });
      if (!res?.ok) {
        const map = {
          no_selection: "statusNoSelection",
          restricted: "statusRestricted",
        };
        setStatus(t(map[res?.error] || "statusFailed"), true);
        return;
      }
      selectedId = res.word.id;
      await reload();
      setStatus(t("statusAdded"));
      // Refresh again after background enrich finishes
      setTimeout(() => reload(), 2800);
      setTimeout(() => reload(), 6000);
    } catch {
      setStatus(t("statusFailed"), true);
    } finally {
      el.add.disabled = false;
    }
  });

  el.openTab.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({
      type: "OPEN_VIEWER",
      words: filteredWords(),
      selectedId,
      title: "WordBank",
    });
  });

  el.excel.addEventListener("click", async () => {
    try {
      const res = await chrome.runtime.sendMessage({
        type: "EXPORT_DOWNLOAD",
        format: "xlsx",
        words: filteredWords(),
      });
      if (res?.ok) setStatus(t("statusExportedExcel"));
      else
        setStatus(
          (res?.error ? String(res.error) : "") || t("statusFailed"),
          true
        );
    } catch (err) {
      setStatus(String(err && err.message ? err.message : err) || t("statusFailed"), true);
    }
  });

  el.pdf.addEventListener("click", async () => {
    try {
      const res = await chrome.runtime.sendMessage({
        type: "EXPORT_DOWNLOAD",
        format: "pdf",
        words: filteredWords(),
      });
      if (res?.ok) setStatus(t("statusExportedPdf"));
      else
        setStatus(
          (res?.error ? String(res.error) : "") || t("statusFailed"),
          true
        );
    } catch (err) {
      setStatus(String(err && err.message ? err.message : err) || t("statusFailed"), true);
    }
  });

  el.clear.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "CLEAR_WORDS" });
    selectedId = "";
    await reload();
    setStatus(t("statusCleared"));
  });

  el.search.addEventListener("input", () => {
    query = el.search.value || "";
    renderList();
  });
  el.filterAll.addEventListener("click", () => setFilter("all"));
  el.filterEn.addEventListener("click", () => setFilter("en"));
  el.filterJa.addEventListener("click", () => setFilter("ja"));

  applyI18n();
  WordDisplay.loadSettings().then((s) => {
    settings = s;
    reload();
  });
})();
