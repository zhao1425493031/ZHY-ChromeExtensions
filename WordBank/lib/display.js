/**
 * Display language helpers: POS localization + gloss visibility.
 */
(function (root) {
  "use strict";

  const DEFAULTS = {
    // Product rule: card UI is Chinese-only (gloss / tips / labels)
    glossMode: "zh_only",
    displayLang: "zh",
  };

  function uiDisplayLang() {
    return "zh";
  }

  // Common Free Dictionary / Jisho POS tags → zh / ja
  const POS_MAP = {
    文法: { zh: "文法", ja: "文法", en: "grammar" },
    表現: { zh: "表达", ja: "表現", en: "expression" },
    noun: { zh: "名词", ja: "名詞", en: "noun" },
    "proper noun": { zh: "专有名词", ja: "固有名詞", en: "proper noun" },
    pronoun: { zh: "代词", ja: "代名詞", en: "pronoun" },
    verb: { zh: "动词", ja: "動詞", en: "verb" },
    "transitive verb": { zh: "他动词", ja: "他動詞", en: "transitive verb" },
    "intransitive verb": { zh: "自动词", ja: "自動詞", en: "intransitive verb" },
    "suru verb": { zh: "サ变动词", ja: "サ変動詞", en: "suru verb" },
    "suru verb - included": { zh: "サ变动词", ja: "サ変動詞", en: "suru verb" },
    "ichidan verb": { zh: "一段动词", ja: "一段動詞", en: "ichidan verb" },
    "godan verb": { zh: "五段动词", ja: "五段動詞", en: "godan verb" },
    "kuru verb - special class": { zh: "カ变动词", ja: "カ変動詞", en: "kuru verb" },
    "irregular verb": { zh: "不规则动词", ja: "不規則動詞", en: "irregular verb" },
    auxiliary: { zh: "助动词", ja: "助動詞", en: "auxiliary" },
    "auxiliary verb": { zh: "助动词", ja: "助動詞", en: "auxiliary verb" },
    adjective: { zh: "形容词", ja: "形容詞", en: "adjective" },
    "i-adjective": { zh: "い形容词", ja: "い形容詞", en: "i-adjective" },
    "na-adjective": { zh: "な形容词", ja: "な形容詞", en: "na-adjective" },
    "adjectival noun": { zh: "形容动词", ja: "形容動詞", en: "adjectival noun" },
    adverb: { zh: "副词", ja: "副詞", en: "adverb" },
    "adverb taking the 'to' particle": {
      zh: "と副词",
      ja: "と副詞",
      en: "adverb (to)",
    },
    conjunction: { zh: "连词", ja: "接続詞", en: "conjunction" },
    interjection: { zh: "感叹词", ja: "感動詞", en: "interjection" },
    particle: { zh: "助词", ja: "助詞", en: "particle" },
    prefix: { zh: "前缀", ja: "接頭辞", en: "prefix" },
    suffix: { zh: "后缀", ja: "接尾辞", en: "suffix" },
    counter: { zh: "量词", ja: "助数詞", en: "counter" },
    expression: { zh: "表达 / 惯用", ja: "表現", en: "expression" },
    numeric: { zh: "数词", ja: "数詞", en: "numeric" },
    "prenominal noun": { zh: "连体词性名词", ja: "連体詞的名詞", en: "prenominal noun" },
    "no-adjective": { zh: "の形容词", ja: "の形容詞", en: "no-adjective" },
    "pre-noun adjectival": { zh: "连体词", ja: "連体詞", en: "pre-noun adjectival" },
    determiner: { zh: "限定词", ja: "限定詞", en: "determiner" },
    preposition: { zh: "介词", ja: "前置詞", en: "preposition" },
    article: { zh: "冠词", ja: "冠詞", en: "article" },
    "exclamation": { zh: "感叹", ja: "感嘆", en: "exclamation" },
  };

  function normalizePosKey(raw) {
    return String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function localizePosTag(raw, displayLang) {
    const rawStr = String(raw || "").trim();
    // Keep JLPT labels as-is (shown next to 文法)
    const jlpt = rawStr.match(/^JLPT\s*(N[1-5])$/i);
    if (jlpt) return "JLPT " + jlpt[1].toUpperCase();
    const key = normalizePosKey(raw);
    const hit = POS_MAP[key] || POS_MAP[rawStr];
    if (hit) {
      if (displayLang === "ja") return hit.ja;
      if (displayLang === "en") return hit.en;
      return hit.zh;
    }

    // fuzzy contains
    for (const [k, v] of Object.entries(POS_MAP)) {
      if (key.includes(k) || k.includes(key)) {
        if (displayLang === "ja") return v.ja;
        if (displayLang === "en") return v.en;
        return v.zh;
      }
    }

    // godan / ichidan patterns from Jisho long labels
    if (/godan/i.test(raw)) {
      return displayLang === "ja" ? "五段動詞" : displayLang === "en" ? raw : "五段动词";
    }
    if (/ichidan/i.test(raw)) {
      return displayLang === "ja" ? "一段動詞" : displayLang === "en" ? raw : "一段动词";
    }
    if (/suru/i.test(raw)) {
      return displayLang === "ja" ? "サ変動詞" : displayLang === "en" ? raw : "サ变动词";
    }

    return String(raw || "");
  }

  function formatPosList(posList, displayLang) {
    return (posList || [])
      .map((p) => localizePosTag(p, displayLang || "zh"))
      .filter(Boolean);
  }

  /** UI always Chinese gloss only (no EN/JA meaning blocks). */
  function visibleGlossSections(word) {
    const zh = word.glossesZh || word.glosses || [];
    if (zh.length) return [{ key: "zh", items: zh }];
    // last resort so card is not empty
    const en = word.glossesEn || [];
    if (en.length) return [{ key: "zh", items: en }];
    return [];
  }

  function previewGloss(word) {
    const sections = visibleGlossSections(word);
    if (sections[0] && sections[0].items[0]) return sections[0].items[0];
    return word.phonetic || "";
  }

  async function loadSettings() {
    await chrome.storage.sync.set({
      glossMode: "zh_only",
      displayLang: "zh",
      cardViewMigrated: true,
      cardZhOnly: true,
    });
    return { displayLang: "zh", glossMode: "zh_only" };
  }

  async function saveSettings() {
    return loadSettings();
  }

  root.WordDisplay = {
    DEFAULTS,
    uiDisplayLang,
    localizePosTag,
    formatPosList,
    visibleGlossSections,
    previewGloss,
    loadSettings,
    saveSettings,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
