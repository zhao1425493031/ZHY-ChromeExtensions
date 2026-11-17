/**
 * Excel (CSV / SpreadsheetML) and A4 print/PDF helpers for WordBank.
 */
(function (root) {
  "use strict";

  function csvEscape(value) {
    const s = String(value ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function joinGloss(arr) {
    return (arr || []).join(" | ");
  }

  function formsText(forms) {
    if (!forms || typeof forms !== "object") return "";
    return Object.entries(forms)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" / ");
  }

  function wordsToRows(words, displayLang) {
    const lang = displayLang || "zh";
    return (words || []).map((w) => {
      const posList =
        root.WordDisplay && root.WordDisplay.formatPosList
          ? root.WordDisplay.formatPosList(w.pos, lang)
          : w.pos || [];
      return {
        language: w.language || "",
        term: w.term || "",
        lemma: w.lemma || "",
        phonetic: w.phonetic || "",
        pos: posList.join("; "),
        gloss_zh: joinGloss(w.glossesZh || w.glosses),
        gloss_en: joinGloss(w.glossesEn),
        gloss_ja: joinGloss(w.glossesJa),
        jlpt: w.jlpt || "",
        forms: formsText(w.forms),
        connection: (w.connection || []).join(" | "),
        tips: (w.tips || []).join(" | "),
      };
    });
  }

  function toCsv(words, displayLang) {
    const headers = [
      "language",
      "term",
      "lemma",
      "phonetic",
      "jlpt",
      "pos",
      "gloss_zh",
      "gloss_en",
      "gloss_ja",
      "forms",
      "connection",
      "tips",
    ];
    const rows = wordsToRows(words, displayLang);
    const lines = [headers.join(",")];
    rows.forEach((row) => {
      lines.push(headers.map((h) => csvEscape(row[h])).join(","));
    });
    // BOM for Excel UTF-8
    return "\uFEFF" + lines.join("\r\n");
  }

  function xmlEscape(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Excel-friendly SpreadsheetML (.xls) */
  function toExcelXml(words, displayLang) {
    const rows = wordsToRows(words, displayLang);
    const headers = [
      "语言",
      "原文",
      "词典形",
      "发音",
      "JLPT",
      "词性",
      "中文释义",
      "英文释义",
      "日文释义",
      "变形",
      "语法接续",
      "提示",
    ];
    const keys = [
      "language",
      "term",
      "lemma",
      "phonetic",
      "jlpt",
      "pos",
      "gloss_zh",
      "gloss_en",
      "gloss_ja",
      "forms",
      "connection",
      "tips",
    ];

    let table = "<Table>\n<Row>\n";
    headers.forEach((h) => {
      table += `<Cell><Data ss:Type="String">${xmlEscape(h)}</Data></Cell>\n`;
    });
    table += "</Row>\n";
    rows.forEach((row) => {
      table += "<Row>\n";
      keys.forEach((k) => {
        table += `<Cell><Data ss:Type="String">${xmlEscape(
          row[k]
        )}</Data></Cell>\n`;
      });
      table += "</Row>\n";
    });
    table += "</Table>";

    return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
<Worksheet ss:Name="WordBank">
${table}
</Worksheet>
</Workbook>`;
  }

  function cardHtml(w, opts) {
    const displayLang = (opts && opts.displayLang) || "zh";
    const glossMode = "zh_only";
    const block = (title, items) => {
      if (!items || !items.length) return "";
      return `<div class="block"><h3>${title}</h3><ul>${items
        .map((x) => `<li>${escapeHtml(x)}</li>`)
        .join("")}</ul></div>`;
    };
    const forms = w.forms
      ? Object.entries(w.forms)
          .map(
            ([k, v]) =>
              `<div class="form"><span>${escapeHtml(k)}</span><b>${escapeHtml(
                String(v)
              )}</b></div>`
          )
          .join("")
      : "";
    const pos =
      root.WordDisplay && root.WordDisplay.formatPosList
        ? root.WordDisplay.formatPosList(w.pos, displayLang)
        : w.pos || [];
    const sections =
      root.WordDisplay && root.WordDisplay.visibleGlossSections
        ? root.WordDisplay.visibleGlossSections(w, glossMode)
        : [
            { key: "zh", items: w.glossesZh || [] },
            { key: "en", items: w.glossesEn || [] },
            { key: "ja", items: w.glossesJa || [] },
          ];
    const titleMap = { zh: "中文", en: "English", ja: "日本語" };
    const glossHtml = sections
      .map((sec) => block(titleMap[sec.key] || sec.key, sec.items))
      .join("");

    const isGrammar = !!(w.isGrammar || w.kind === "grammar");
    const level = w.jlpt ? String(w.jlpt).toUpperCase() : "";
    return `<article class="card">
      <header>
        <span class="lang">${escapeHtml(
          isGrammar ? "文法" : (w.language || "").toUpperCase()
        )}</span>
        ${
          level
            ? `<span class="level">${escapeHtml(level)}</span>`
            : ""
        }
        <h2>${escapeHtml(w.lemma || w.term || "")}</h2>
        ${
          w.phonetic
            ? `<p class="phonetic">${escapeHtml(w.phonetic)}</p>`
            : ""
        }
      </header>
      ${
        pos.length
          ? `<div class="block"><h3>词性</h3><p>${escapeHtml(
              pos.join(" · ")
            )}</p></div>`
          : ""
      }
      ${glossHtml}
      ${(() => {
        const lines =
          root.GrammarFormat && root.GrammarFormat.connectionLines
            ? root.GrammarFormat.connectionLines(w.connection, displayLang)
            : w.connection || [];
        return block("语法接续", lines);
      })()}
      ${(() => {
        const ex =
          root.GrammarFormat && root.GrammarFormat.exampleItems
            ? root.GrammarFormat.exampleItems(w)
            : [];
        if (!ex.length) return "";
        return `<div class="block"><h3>例句</h3><ul>${ex
          .map((e) => {
            const en = e.en ? `<br/><span style="color:#666">${escapeHtml(e.en)}</span>` : "";
            return `<li>${escapeHtml(e.ja)}${en}</li>`;
          })
          .join("")}</ul></div>`;
      })()}
      ${(() => {
        const tips =
          root.GrammarFormat && root.GrammarFormat.tipLines
            ? root.GrammarFormat.tipLines(w, displayLang)
            : w.tips || [];
        return block("用法提示", tips);
      })()}
      ${
        !isGrammar && forms
          ? `<div class="block"><h3>变形</h3><div class="forms">${forms}</div></div>`
          : ""
      }
    </article>`;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toA4Html(words, title, opts) {
    const cards = (words || []).map((w) => cardHtml(w, opts)).join("\n");
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title || "WordBank")}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: #111;
    font: 11pt/1.45 "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  h1 { font-size: 16pt; margin: 0 0 12pt; }
  .meta { color: #666; font-size: 9pt; margin-bottom: 16pt; }
  .card {
    border: 1px solid #ddd;
    border-radius: 6px;
    padding: 10pt 12pt;
    margin: 0 0 10pt;
    page-break-inside: avoid;
  }
  .card h2 { margin: 0; font-size: 14pt; }
  .lang, .level {
    display: inline-block;
    font-size: 8pt;
    font-weight: 700;
    color: #4338ca;
    background: #eef2ff;
    padding: 1pt 5pt;
    border-radius: 3pt;
    margin-right: 6pt;
    vertical-align: middle;
  }
  .level { color: #c2410c; background: #ffedd5; }
  .phonetic { margin: 4pt 0 0; color: #4338ca; }
  .block { margin-top: 8pt; }
  .block h3 {
    margin: 0 0 3pt;
    font-size: 9pt;
    color: #666;
    letter-spacing: 0.04em;
  }
  .block p, .block ul { margin: 0; padding-left: 1.1em; font-size: 10.5pt; }
  .forms { display: grid; gap: 2pt; }
  .form { display: grid; grid-template-columns: 70pt 1fr; gap: 6pt; font-size: 10pt; }
  .form span { color: #666; }
  .toolbar {
    position: sticky; top: 0; background: #fff; padding: 8pt 0;
    border-bottom: 1px solid #eee; margin-bottom: 12pt;
  }
  .toolbar button {
    border: 0; background: #4338ca; color: #fff;
    border-radius: 6pt; padding: 6pt 12pt; font-weight: 700; cursor: pointer;
  }
  @media print {
    .toolbar { display: none !important; }
    body { font-size: 10.5pt; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button onclick="window.print()">打印 / 另存为 PDF</button>
  </div>
  <h1>${escapeHtml(title || "WordBank")}</h1>
  <p class="meta">A4 · ${new Date().toLocaleString()} · ${(words || []).length} cards</p>
  ${cards}
</body>
</html>`;
  }

  root.WordExport = { toCsv, toExcelXml, toA4Html, wordsToRows, cardHtml };
})(typeof globalThis !== "undefined" ? globalThis : self);
