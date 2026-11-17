/**
 * Light translation helper (MyMemory free endpoint).
 * Used to fill ZH / EN / JA gloss lines after dictionary lookup.
 */
(function (root) {
  "use strict";

  async function translateText(text, sourceLang, targetLang) {
    const q = String(text || "").trim();
    if (!q) return "";
    const url =
      "https://api.mymemory.translated.net/get?q=" +
      encodeURIComponent(q.slice(0, 450)) +
      "&langpair=" +
      encodeURIComponent(sourceLang + "|" + targetLang);
    const res = await fetch(url);
    if (!res.ok) return "";
    const data = await res.json();
    const out = data && data.responseData && data.responseData.translatedText;
    if (!out) return "";
    // MyMemory sometimes echoes "QUERY LENGTH LIMIT EXCEEDED..."
    if (/QUERY LENGTH LIMIT|MYMEMORY WARNING/i.test(out)) return "";
    return String(out).trim();
  }

  async function translateList(items, sourceLang, targetLang, limit) {
    const max = limit == null ? 3 : limit;
    const out = [];
    const seen = new Set();
    for (const item of (items || []).slice(0, max)) {
      try {
        const t = await translateText(item, sourceLang, targetLang);
        if (t && !seen.has(t)) {
          seen.add(t);
          out.push(t);
        }
      } catch {
        // ignore single failures
      }
    }
    return out;
  }

  /**
   * Ensure trilingual gloss bags.
   * - ja term: need ZH + EN (EN usually from dictionary)
   * - en term: need ZH + JA (EN from dictionary)
   */
  async function fillTrilingualGlosses(entry) {
    const base = { ...(entry || {}) };
    const lang = base.language === "ja" ? "ja" : "en";
    const primary = unique(base.glosses || []).slice(0, 4);

    let glossesEn = unique(base.glossesEn || []);
    let glossesZh = unique(base.glossesZh || []);
    let glossesJa = unique(base.glossesJa || []);

    if (lang === "ja") {
      if (!glossesEn.length) glossesEn = primary.slice();
      if (!glossesZh.length && glossesEn.length) {
        glossesZh = await translateList(glossesEn, "en", "zh-CN", 3);
      }
      if (!glossesZh.length && base.lemma) {
        const one = await translateText(base.lemma, "ja", "zh-CN");
        if (one) glossesZh = [one];
      }
      if (!glossesJa.length && base.lemma) {
        glossesJa = [base.phonetic ? `${base.lemma}（${base.phonetic}）` : base.lemma];
      }
    } else {
      if (!glossesEn.length) glossesEn = primary.slice();
      if (!glossesZh.length && glossesEn.length) {
        glossesZh = await translateList(glossesEn, "en", "zh-CN", 3);
      }
      if (!glossesJa.length && glossesEn.length) {
        glossesJa = await translateList(glossesEn, "en", "ja", 3);
      }
      if (!glossesJa.length && base.lemma) {
        const one = await translateText(base.lemma, "en", "ja");
        if (one) glossesJa = [one];
      }
    }

    // list preview prefers Chinese, then English
    const glosses = glossesZh.length
      ? glossesZh
      : glossesEn.length
        ? glossesEn
        : glossesJa;

    // Grammar tips: keep EN, add ZH when missing
    let tips = Array.isArray(base.tips) ? base.tips.slice() : [];
    let tipsZh = Array.isArray(base.tipsZh) ? base.tipsZh.slice() : [];
    const tipsEn = unique(base.tipsEn || tips).filter(
      (s) => !/^(标签|標籤|タグ|tags?)[:：]/i.test(s)
    );
    if (base.isGrammar || base.kind === "grammar") {
      if (!tipsZh.length && tipsEn.length) {
        tipsZh = await translateList(tipsEn.slice(0, 2), "en", "zh-CN", 2);
      }
      if (tipsZh.length) {
        tips = tipsZh.concat(
          (base.tips || []).filter((s) =>
            /^(标签|標籤|タグ|tags?)[:：]/i.test(s)
          )
        );
      }
      // Example sentences: JA + Chinese meaning
      if (Array.isArray(base.examples) && base.examples.length) {
        const nextEx = [];
        for (const ex of base.examples.slice(0, 3)) {
          if (!ex || !ex.ja) continue;
          let zh = String(ex.zh || "").trim();
          if (!zh && ex.en) {
            zh = await translateText(ex.en, "en", "zh-CN");
          }
          if (!zh && ex.ja) {
            zh = await translateText(ex.ja, "ja", "zh-CN");
          }
          nextEx.push({
            ja: ex.ja,
            en: ex.en || "",
            zh: zh || "",
          });
        }
        base.examples = nextEx;
      }
    }

    return {
      ...base,
      glosses,
      glossesZh,
      glossesEn,
      glossesJa,
      tips,
      tipsZh,
      tipsEn,
    };
  }

  function unique(arr) {
    return [...new Set((arr || []).filter(Boolean).map((s) => String(s).trim()))];
  }

  root.WordTranslate = {
    translateText,
    translateList,
    fillTrilingualGlosses,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
