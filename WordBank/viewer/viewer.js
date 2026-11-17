(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const el = {
    title: $("title"),
    count: $("count"),
    search: $("search"),
    list: $("word-list"),
    detail: $("detail"),
    excel: $("btn-excel"),
    pdf: $("btn-pdf"),
  };

  let words = [];
  let selectedId = "";
  let query = "";
  let settings = { displayLang: "zh", glossMode: "zh_only" };

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

  function t(key) {
    return chrome.i18n.getMessage(key) || key;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function filtered() {
    const q = query.trim().toLowerCase();
    return words.filter((w) => {
      if (!q) return true;
      const blob = [
        w.term,
        w.lemma,
        w.phonetic,
        ...(w.glossesZh || []),
        ...(w.glossesEn || []),
        ...(w.glossesJa || []),
        ...(w.glosses || []),
      ]
        .join("\n")
        .toLowerCase();
      return blob.includes(q);
    });
  }

  function glossBlock(title, items) {
    if (!items || !items.length) return "";
    return `<div class="block"><h3>${escapeHtml(title)}</h3><ul>${items
      .map((g) => `<li>${escapeHtml(g)}</li>`)
      .join("")}</ul></div>`;
  }

  function glossTitle(key) {
    if (key === "zh") return t("labelGlossZh");
    if (key === "en") return t("labelGlossEn");
    return t("labelGlossJa");
  }

  function renderDetail(w) {
    if (!w) {
      el.detail.innerHTML = `<p class="placeholder">${t("hintPick")}</p>`;
      return;
    }
    const forms = w.forms
      ? Object.entries(w.forms)
          .map(
            ([k, v]) =>
              `<div class="form-row"><span class="k">${escapeHtml(
                k
              )}</span><span>${escapeHtml(String(v))}</span></div>`
          )
          .join("")
      : "";
    const pos = WordDisplay.formatPosList(w.pos, "zh");
    const sections = WordDisplay.visibleGlossSections(w);
    const glossHtml = sections
      .map((sec) => glossBlock(t("labelGlossZh"), sec.items))
      .join("");
    const isGrammar = !!(w.isGrammar || w.kind === "grammar");
    const level = w.jlpt ? String(w.jlpt).toUpperCase() : "";

    el.detail.innerHTML = `
      <div class="detail-card">
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
          <button type="button" class="btn ghost" id="btn-copy">${t(
            "btnCopyCard"
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
          !isGrammar && forms
            ? `<div class="block"><h3>${t(
                "labelForms"
              )}</h3><div class="forms">${forms}</div></div>`
            : ""
        }
      </div>
    `;

    $("btn-copy")?.addEventListener("click", async () => {
      const conn = GrammarFormat.connectionLines(w.connection, "zh");
      const tips = GrammarFormat.tipLines(w, "zh");
      const ex = GrammarFormat.exampleItems(w);
      const md = [
        `# ${w.lemma || w.term}`,
        w.phonetic ? `> ${w.phonetic}` : "",
        level ? `- JLPT: ${level}` : "",
        pos.length ? `- ${t("labelPos")}: ${pos.join(", ")}` : "",
        ...sections.flatMap((sec) => [
          "",
          `## ${t("labelGlossZh")}`,
          ...sec.items.map((x) => `- ${x}`),
        ]),
        ...(conn.length
          ? ["", `## ${t("labelConnection")}`, ...conn.map((c) => `- ${c}`)]
          : []),
        ...(ex.length
          ? ["", `## ${t("labelExamples")}`, ...ex.map((e) => `- ${e.ja}`)]
          : []),
        ...(tips.length
          ? ["", `## ${t("labelTips")}`, ...tips.map((c) => `- ${c}`)]
          : []),
      ]
        .filter(Boolean)
        .join("\n");
      await navigator.clipboard.writeText(md);
    });
  }

  function renderList() {
    const items = filtered();
    el.list.innerHTML = "";
    if (!items.some((w) => w.id === selectedId)) {
      selectedId = items[0]?.id || "";
    }
    items.forEach((w) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "word-item" + (w.id === selectedId ? " active" : "");
      const preview = WordDisplay.previewGloss(w);
      const isGrammar = !!(w.isGrammar || w.kind === "grammar");
      const level = w.jlpt ? String(w.jlpt).toUpperCase() : "";
      btn.innerHTML = `
        <span class="lang-tag">${escapeHtml(
          isGrammar ? "文法" : (w.language || "").toUpperCase()
        )}</span>
        <span>
          <div class="term">${escapeHtml(w.lemma || w.term || "")}${
            level
              ? ` <span class="level-tag">${escapeHtml(level)}</span>`
              : ""
          }</div>
          <div class="meta">${escapeHtml(preview)}</div>
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

  async function load() {
    settings = await WordDisplay.loadSettings();
    const id = new URLSearchParams(location.search).get("id");
    if (!id) return;
    const key = `viewer:${id}`;
    const data = await chrome.storage.session.get(key);
    const doc = data[key];
    if (!doc) {
      el.detail.innerHTML = `<p class="placeholder">${t("viewerMissing")}</p>`;
      return;
    }
    words = doc.words || [];
    selectedId = doc.selectedId || "";
    el.title.textContent = doc.title || "WordBank";
    document.title = doc.title || "WordBank";
    el.count.textContent = `${words.length} words`;
    el.search.placeholder = t("searchPlaceholder");
    el.excel.textContent = t("btnExportExcel");
    el.pdf.textContent = t("btnExportPdf");
    renderList();
  }

  el.search.addEventListener("input", () => {
    query = el.search.value || "";
    renderList();
  });

  el.excel.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({
      type: "EXPORT_DOWNLOAD",
      format: "xls",
      words: filtered(),
    });
  });

  el.pdf.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({
      type: "EXPORT_DOWNLOAD",
      format: "pdf",
      words: filtered(),
    });
  });

  load();
})();
