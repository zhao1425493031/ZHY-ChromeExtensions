/**
 * Excel (.xlsx) and A4 print/PDF helpers for WordBank.
 * XLSX: Office Open XML, font Meiryo UI 10pt.
 */
(function (root) {
  "use strict";

  const FONT_NAME = "Meiryo UI";
  const FONT_SIZE = 10;

  function csvEscape(value) {
    const s = String(value ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function joinLines(arr) {
    return (arr || []).filter(Boolean).join("\n");
  }

  function formsText(forms) {
    if (!forms || typeof forms !== "object") return "";
    return Object.entries(forms)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
  }

  function wordType(w) {
    if (w.isGrammar || w.kind === "grammar") return "文法";
    return (w.language || "").toUpperCase() || "";
  }

  function connectionText(w) {
    if (root.GrammarFormat && root.GrammarFormat.connectionLines) {
      return joinLines(root.GrammarFormat.connectionLines(w.connection, "zh"));
    }
    return joinLines(w.connection);
  }

  function tipsText(w) {
    if (root.GrammarFormat && root.GrammarFormat.tipLines) {
      return joinLines(root.GrammarFormat.tipLines(w, "zh"));
    }
    return joinLines(w.tipsZh || w.tips);
  }

  function examplesText(w) {
    const list =
      root.GrammarFormat && root.GrammarFormat.exampleItems
        ? root.GrammarFormat.exampleItems(w)
        : [];
    if (!list.length) return "";
    return list
      .map((ex, i) => {
        const n = i + 1;
        const zh = ex.zh ? `\n   ${ex.zh}` : "";
        return `${n}. ${ex.ja || ""}${zh}`;
      })
      .join("\n");
  }

  function wordsToRows(words, displayLang) {
    const lang = displayLang || "zh";
    return (words || []).map((w) => {
      const posList =
        root.WordDisplay && root.WordDisplay.formatPosList
          ? root.WordDisplay.formatPosList(w.pos, lang)
          : w.pos || [];
      return {
        type: wordType(w),
        lemma: w.lemma || w.term || "",
        term: w.term || "",
        phonetic: w.phonetic || "",
        jlpt: w.jlpt ? String(w.jlpt).toUpperCase() : "",
        pos: posList.join(" · "),
        gloss_zh: joinLines(w.glossesZh || w.glosses),
        connection: connectionText(w),
        examples: examplesText(w),
        tips: tipsText(w),
        forms: formsText(w.forms),
      };
    });
  }

  function toCsv(words, displayLang) {
    const headers = [
      "type",
      "lemma",
      "phonetic",
      "jlpt",
      "pos",
      "gloss_zh",
      "connection",
      "examples",
      "tips",
      "forms",
    ];
    const rows = wordsToRows(words, displayLang);
    const lines = [headers.join(",")];
    rows.forEach((row) => {
      lines.push(headers.map((h) => csvEscape(row[h])).join(","));
    });
    return "\uFEFF" + lines.join("\r\n");
  }

  function xmlEscape(s) {
    // Excel is happiest with ASCII + numeric char refs (openpyxl style)
    let out = "";
    const str = String(s ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code === 0x26) out += "&amp;";
      else if (code === 0x3c) out += "&lt;";
      else if (code === 0x3e) out += "&gt;";
      else if (code === 0x22) out += "&quot;";
      else if (code === 0x0a) out += "&#10;";
      else if (code < 0x20) continue;
      else if (code < 0x7f) out += str.charAt(i);
      else out += "&#" + code + ";";
    }
    return out;
  }

  // --- minimal ZIP (store) + CRC32 for XLSX ---

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function strToUtf8(str) {
    return new TextEncoder().encode(String(str));
  }

  function u16(n) {
    const b = new Uint8Array(2);
    b[0] = n & 0xff;
    b[1] = (n >>> 8) & 0xff;
    return b;
  }

  function u32(n) {
    const b = new Uint8Array(4);
    b[0] = n & 0xff;
    b[1] = (n >>> 8) & 0xff;
    b[2] = (n >>> 16) & 0xff;
    b[3] = (n >>> 24) & 0xff;
    return b;
  }

  function concatBytes(parts) {
    let len = 0;
    parts.forEach((p) => (len += p.length));
    const out = new Uint8Array(len);
    let off = 0;
    parts.forEach((p) => {
      out.set(p, off);
      off += p.length;
    });
    return out;
  }

  /** Build ZIP with STORE method (Excel accepts). */
  function zipStore(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;

    files.forEach((f) => {
      const name = strToUtf8(f.name);
      const data = f.data instanceof Uint8Array ? f.data : strToUtf8(f.data);
      const crc = crc32(data);
      // flags=0 — Excel (esp. JP Windows) can reject ZIP UTF-8 bit 11
      const local = concatBytes([
        u32(0x04034b50),
        u16(20),
        u16(0),
        u16(0), // store
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        name,
        data,
      ]);
      const central = concatBytes([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]);
      locals.push(local);
      centrals.push(central);
      offset += local.length;
    });

    const centralDir = concatBytes(centrals);
    const end = concatBytes([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(files.length),
      u16(files.length),
      u32(centralDir.length),
      u32(offset),
      u16(0),
    ]);
    return concatBytes([...locals, centralDir, end]);
  }

  function colLetter(n) {
    // 1-based → A, B, … AA
    let s = "";
    let x = n;
    while (x > 0) {
      const m = (x - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      x = Math.floor((x - 1) / 26);
    }
    return s;
  }

  function sheetCell(r, c, text, styleId) {
    const ref = colLetter(c) + String(r);
    const t = String(text ?? "");
    if (!t) {
      return `<c r="${ref}" s="${styleId}" t="inlineStr"/>`;
    }
    return `<c r="${ref}" s="${styleId}" t="inlineStr"><is><t>${xmlEscape(
      t
    )}</t></is></c>`;
  }

  function buildStylesXml() {
    // Excel requires: Normal style (xfId), cellStyles, fonts/fills/borders baselines
    // cellXfs: 0=Normal, 1=header, 2=body
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="0"/>
  <fonts count="3">
    <font>
      <sz val="${FONT_SIZE}"/>
      <color theme="1"/>
      <name val="${FONT_NAME}"/>
      <family val="2"/>
      <charset val="128"/>
    </font>
    <font>
      <name val="${FONT_NAME}"/>
      <b val="1"/>
      <sz val="${FONT_SIZE}"/>
    </font>
    <font>
      <name val="${FONT_NAME}"/>
      <sz val="${FONT_SIZE}"/>
    </font>
  </fonts>
  <fills count="3">
    <fill><patternFill/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill>
      <patternFill patternType="solid">
        <fgColor rgb="FFE8EEF7"/>
      </patternFill>
    </fill>
  </fills>
  <borders count="2">
    <border>
      <left/><right/><top/><bottom/><diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FFCBD5E1"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="thin"><color rgb="FFCBD5E1"/></top>
      <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="left" vertical="top" wrapText="1"/>
    </xf>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
  }

  function buildSheetXml(headers, matrix) {
    const cols = headers.length;
    const rows = matrix.length + 1;
    // widths in Excel character units
    const widths = [8, 14, 14, 8, 14, 28, 28, 36, 28, 18];
    let colsXml = "<cols>";
    for (let i = 0; i < cols; i++) {
      const w = widths[i] || 16;
      colsXml += `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`;
    }
    colsXml += "</cols>";

    let sheetData = "<sheetData>\n";
    // header style=1, body style=2
    sheetData += `<row r="1" ht="22" customHeight="1">\n`;
    headers.forEach((h, i) => {
      sheetData += sheetCell(1, i + 1, h, 1) + "\n";
    });
    sheetData += "</row>\n";

    matrix.forEach((row, ri) => {
      const r = ri + 2;
      let maxLines = 1;
      row.forEach((cell) => {
        const n = String(cell ?? "").split(/\n/).length;
        if (n > maxLines) maxLines = n;
      });
      const ht = Math.min(120, Math.max(18, maxLines * 14));
      sheetData += `<row r="${r}" ht="${ht}" customHeight="1">\n`;
      row.forEach((cell, ci) => {
        sheetData += sheetCell(r, ci + 1, cell, 2) + "\n";
      });
      sheetData += "</row>\n";
    });
    sheetData += "</sheetData>";

    const last = colLetter(cols) + String(Math.max(rows, 1));
    // Element order matches Excel/openpyxl: dimension → sheetViews → sheetFormatPr → cols → sheetData
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><outlinePr summaryBelow="1" summaryRight="1"/><pageSetUpPr/></sheetPr>
  <dimension ref="A1:${last}"/>
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft" activeCell="A1" sqref="A1"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr baseColWidth="8" defaultRowHeight="18"/>
  ${colsXml}
  ${sheetData}
  <autoFilter ref="A1:${last}"/>
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
  }

  function isoNow() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  /**
   * @param {any[]} words
   * @param {string} [displayLang]
   * @param {{ themeXml?: string }} [opts]
   * @returns {Uint8Array} .xlsx bytes
   */
  function toXlsxBytes(words, displayLang, opts) {
    const headers = [
      "类型",
      "词条",
      "读音",
      "JLPT",
      "词性",
      "释义",
      "语法接续",
      "例句",
      "用法提示",
      "变形",
    ];
    const keys = [
      "type",
      "lemma",
      "phonetic",
      "jlpt",
      "pos",
      "gloss_zh",
      "connection",
      "examples",
      "tips",
      "forms",
    ];
    const rows = wordsToRows(words, displayLang || "zh");
    const matrix = rows.map((row) => keys.map((k) => row[k] || ""));
    const themeXml =
      (opts && opts.themeXml) ||
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F497D"/></a:dk2>
      <a:lt2><a:srgbClr val="EEECE1"/></a:lt2>
      <a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
      <a:accent2><a:srgbClr val="C0504D"/></a:accent2>
      <a:accent3><a:srgbClr val="9BBB59"/></a:accent3>
      <a:accent4><a:srgbClr val="8064A2"/></a:accent4>
      <a:accent5><a:srgbClr val="4BACC6"/></a:accent5>
      <a:accent6><a:srgbClr val="F79646"/></a:accent6>
      <a:hlink><a:srgbClr val="0000FF"/></a:hlink>
      <a:folHlink><a:srgbClr val="800080"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="Cambria"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;

    const now = isoNow();
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

    // Match Excel/openpyxl workbook shape — JP Excel rejects several common variants
    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <workbookPr/>
  <bookViews>
    <workbookView visibility="visible" minimized="0" showHorizontalScroll="1" showVerticalScroll="1" showSheetTabs="1" tabRatio="600" firstSheet="0" activeTab="0" autoFilterDateGrouping="1"/>
  </bookViews>
  <sheets>
    <sheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" name="WordBank" sheetId="1" state="visible" r:id="rId1"/>
  </sheets>
  <calcPr calcId="124519" fullCalcOnLoad="1"/>
</workbook>`;

    const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`;

    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:dcmitype="http://purl.org/dc/dcmitype/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>WordBank</dc:creator>
  <cp:lastModifiedBy>WordBank</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;

    const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>WordBank</Application>
  <AppVersion>0.3</AppVersion>
</Properties>`;

    const sheet = buildSheetXml(headers, matrix);
    const styles = buildStylesXml();

    return zipStore([
      { name: "[Content_Types].xml", data: contentTypes },
      { name: "_rels/.rels", data: rels },
      { name: "docProps/core.xml", data: core },
      { name: "docProps/app.xml", data: app },
      { name: "xl/workbook.xml", data: workbook },
      { name: "xl/_rels/workbook.xml.rels", data: workbookRels },
      { name: "xl/styles.xml", data: styles },
      { name: "xl/theme/theme1.xml", data: themeXml },
      { name: "xl/worksheets/sheet1.xml", data: sheet },
    ]);
  }

  /** @deprecated alias — returns base64 data URL friendly string no longer used */
  function toExcelXml(words, displayLang) {
    // keep for callers; prefer toXlsxBytes
    return toXlsxBytes(words, displayLang);
  }

  function bytesToBase64(bytes) {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(
        null,
        bytes.subarray(i, Math.min(i + chunk, bytes.length))
      );
    }
    return btoa(bin);
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
        : [{ key: "zh", items: w.glossesZh || [] }];
    const glossHtml = sections
      .map((sec) => block("释义", sec.items))
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
            const zh = e.zh
              ? `<br/><span style="color:#666">${escapeHtml(e.zh)}</span>`
              : "";
            return `<li>${escapeHtml(e.ja)}${zh}</li>`;
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
    font: 10pt/1.45 "Meiryo UI", "Yu Gothic UI", "Microsoft YaHei", sans-serif;
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
  .card h2 { margin: 0; font-size: 14pt; font-weight: 400; }
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
  .block p, .block ul { margin: 0; padding-left: 1.1em; font-size: 10pt; }
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

  root.WordExport = {
    toCsv,
    toExcelXml,
    toXlsxBytes,
    bytesToBase64,
    toA4Html,
    wordsToRows,
    cardHtml,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
