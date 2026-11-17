/**
 * Make OpenJLPT / Jisho grammar fields readable in ZH (and JA/EN).
 * Applied at render time so old stored cards also look clear.
 */
(function (root) {
  "use strict";

  const FORM_ZH = [
    [/Verb-ta\b/gi, "動詞た形"],
    [/Verb-masu\b/gi, "動詞ます形"],
    [/Verb-nai\b/gi, "動詞ない形"],
    [/Verb-ba\b/gi, "動詞ば形"],
    [/Verb-te\b/gi, "動詞て形"],
    [/Verb-volitional\b/gi, "動詞意向形"],
    [/Verb-potential\b/gi, "動詞可能形"],
    [/Verb-passive\b/gi, "動詞受身形"],
    [/Verb-causative\b/gi, "動詞使役形"],
    [/Verb\s*\(dictionary form\)/gi, "動詞辞書形"],
    [/Verb-dict\b/gi, "動詞辞書形"],
    [/Verb dictionary form/gi, "動詞辞書形"],
    [/Verb plain form/gi, "動詞普通形"],
    [/Verb\b/gi, "動詞"],
    [/Noun\b/gi, "名詞"],
    [/Na-?adj(?:ective)?s?\b/gi, "な形容詞"],
    [/I-?adj(?:ective)?s?\b/gi, "い形容詞"],
    [/Adjective\b/gi, "形容詞"],
    [/Plain form\b/gi, "普通形"],
    [/Stem\b/gi, "語幹"],
    [/Phrase\b/gi, "文／句"],
  ];

  const FORM_JA = [
    [/Verb-ta\b/gi, "動詞た形"],
    [/Verb-masu\b/gi, "動詞ます形"],
    [/Verb-nai\b/gi, "動詞ない形"],
    [/Verb-ba\b/gi, "動詞ば形"],
    [/Verb-te\b/gi, "動詞て形"],
    [/Verb\s*\(dictionary form\)/gi, "動詞辞書形"],
    [/Verb-dict\b/gi, "動詞辞書形"],
    [/Verb\b/gi, "動詞"],
    [/Noun\b/gi, "名詞"],
    [/Na-?adj(?:ective)?s?\b/gi, "な形容詞"],
    [/I-?adj(?:ective)?s?\b/gi, "い形容詞"],
    [/Plain form\b/gi, "普通形"],
  ];

  const TAG_ZH = {
    result: "结果",
    sequence: "先后",
    condition: "条件",
    reason: "原因",
    purpose: "目的",
    concession: "让步",
    contrast: "对比",
    permission: "许可",
    prohibition: "禁止",
    advice: "劝告",
    desire: "愿望",
    ability: "能力",
    appearance: "样子",
    hearsay: "传闻",
    written: "书面语",
    spoken: "口语",
    formal: "正式",
    informal: "非正式",
  };

  function localizeFormation(text, lang) {
    let s = String(text || "");
    if (!s) return "";
    const table = lang === "en" ? null : lang === "ja" ? FORM_JA : FORM_ZH;
    if (!table) return s;
    table.forEach(([re, rep]) => {
      s = s.replace(re, rep);
    });
    // normalize connectors
    s = s
      .replace(/\s*\+\s*/g, " ＋ ")
      .replace(/\s*\/\s*/g, " ／ ")
      .replace(/\s+/g, " ")
      .trim();
    return s;
  }

  /** Split "A / B" into separate connection lines; drop 例： lines. */
  function connectionLines(connection, lang) {
    const out = [];
    (connection || []).forEach((raw) => {
      const line = String(raw || "").trim();
      if (!line) return;
      if (/^例[:：]/.test(line)) return; // examples belong elsewhere
      line.split(/\s*\/\s*/).forEach((part) => {
        const loc = localizeFormation(part, lang);
        if (loc && !out.includes(loc)) out.push(loc);
      });
    });
    return out;
  }

  function exampleItems(word) {
    if (Array.isArray(word.examples) && word.examples.length) {
      return word.examples
        .map((ex) => {
          if (!ex) return null;
          if (typeof ex === "string") return { ja: ex, en: "", zh: "" };
          return {
            ja: ex.ja || "",
            en: ex.en || "",
            zh: ex.zh || "",
          };
        })
        .filter((ex) => ex && ex.ja);
    }
    // legacy: examples stuffed into connection as 例：…
    const fromConn = [];
    (word.connection || []).forEach((c) => {
      const m = String(c || "").match(/^例[:：]\s*(.+)$/);
      if (m) fromConn.push({ ja: m[1], en: "", zh: "" });
    });
    return fromConn;
  }

  function looksMostlyEnglish(s) {
    const letters = (String(s).match(/[A-Za-z]/g) || []).length;
    return letters >= 12 && letters > String(s).length * 0.45;
  }

  function tipLines(word, lang) {
    const tips = [];
    const wantZh = lang !== "en";
    // Prefer Chinese tips; avoid dumping English notes in ZH UI
    let source = word.tips || [];
    if (wantZh && word.tipsZh && word.tipsZh.length) {
      source = word.tipsZh.concat(
        (word.tips || []).filter((s) =>
          /^(标签|標籤|タグ|tags?)[:：]/i.test(String(s || ""))
        )
      );
    }
    source.forEach((raw) => {
      const s = String(raw || "").trim();
      if (!s) return;
      // drop noisy tag dumps like "标签：result, sequence"
      const tagDump = s.match(/^(标签|標籤|タグ|tags?)[:：]\s*(.+)$/i);
      if (tagDump) {
        const mapped = tagDump[2]
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => TAG_ZH[t.toLowerCase()] || t);
        if (mapped.length) tips.push("用法：" + mapped.join("、"));
        return;
      }
      if (wantZh && looksMostlyEnglish(s)) return;
      tips.push(s);
    });
    return tips;
  }

  function examplesHtml(word, escapeHtml) {
    const list = exampleItems(word);
    if (!list.length) return "";
    // Japanese sentence + Chinese meaning under it
    return list
      .map((ex) => {
        const zhText = ex.zh || "";
        const zh = zhText
          ? `<div class="ex-zh">${escapeHtml(zhText)}</div>`
          : `<div class="ex-zh muted">（中文释义加载中，请点「重新解析」）</div>`;
        return `<li class="ex-item"><div class="ex-ja">${escapeHtml(
          ex.ja
        )}</div>${zh}</li>`;
      })
      .join("");
  }

  root.GrammarFormat = {
    localizeFormation,
    connectionLines,
    exampleItems,
    tipLines,
    examplesHtml,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
