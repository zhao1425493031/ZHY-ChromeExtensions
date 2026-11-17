/**
 * Japanese enrichment:
 * 1) OpenJLPT grammar dictionary (remote, cached)
 * 2) else Jisho + conjugator
 * If Jisho reading/lemma matches a grammar point, prefer grammar.
 */
(function (root) {
  "use strict";

  async function tryGrammar(term) {
    if (!root.JaGrammar || !term) return null;
    const g = await root.JaGrammar.lookup(term);
    if (!g) return null;
    const entry = root.JaGrammar.toEntry(g, term);
    if (root.WordTranslate && root.WordTranslate.fillTrilingualGlosses) {
      return root.WordTranslate.fillTrilingualGlosses(entry);
    }
    return entry;
  }

  async function enrichJapanese(term) {
    const q = String(term || "").trim();
    if (!q) throw new Error("empty");

    // Direct grammar hit (e.g. あげく)
    const direct = await tryGrammar(q);
    if (direct) return direct;

    const url =
      "https://jisho.org/api/v1/search/words?keyword=" +
      encodeURIComponent(q);
    const res = await fetch(url);
    if (!res.ok) {
      return await fallback(q, "jisho request failed");
    }
    const data = await res.json();
    const list = data && data.data;
    if (!Array.isArray(list) || !list.length) {
      return await fallback(q, "no jisho result");
    }

    const hit = pickBest(list, q);
    const jp = (hit.japanese && hit.japanese[0]) || {};
    const lemma = jp.word || jp.reading || q;
    const reading = jp.reading || "";

    // 挙句 → reading あげく → grammar
    for (const cand of unique([reading, lemma, q])) {
      const gHit = await tryGrammar(cand);
      if (gHit) {
        gHit.term = q;
        return gHit;
      }
    }

    const pos = [];
    const glosses = [];
    const connection = [];

    (hit.senses || []).slice(0, 5).forEach((sense) => {
      (sense.parts_of_speech || []).forEach((p) => pos.push(p));
      (sense.english_definitions || []).forEach((g) => glosses.push(g));
    });

    const isVerbLike = pos.some((p) => /verb/i.test(p));
    const isAdjLike = pos.some((p) => /adjective/i.test(p));
    let forms = {};
    if (isVerbLike || isAdjLike) {
      const conj = root.JaConjugate
        ? root.JaConjugate.conjugateJa(lemma, pos)
        : null;
      forms = conj && conj.forms ? conj.forms : {};
      (conj && conj.connection ? conj.connection : []).forEach((c) =>
        connection.push(c)
      );
    }

    const jlpt = (hit.jlpt || []).join(", ");
    if (jlpt) connection.unshift("JLPT: " + jlpt);

    const base = {
      language: "ja",
      kind: "word",
      term: q,
      lemma,
      phonetic: reading,
      pos: unique(pos).slice(0, 8),
      glosses: unique(glosses).slice(0, 8),
      glossesEn: unique(glosses).slice(0, 8),
      forms,
      connection: unique(connection).slice(0, 10),
      tips: [],
      isCommon: !!(hit.is_common),
      jlpt,
      isGrammar: false,
    };
    if (root.WordTranslate && root.WordTranslate.fillTrilingualGlosses) {
      return root.WordTranslate.fillTrilingualGlosses(base);
    }
    return base;
  }

  function pickBest(list, q) {
    const exact = list.find((item) =>
      (item.japanese || []).some(
        (j) => j.word === q || j.reading === q
      )
    );
    return exact || list[0];
  }

  async function fallback(q, note) {
    const g = await tryGrammar(q);
    if (g) return g;
    const conj = root.JaConjugate
      ? root.JaConjugate.conjugateJa(q, [])
      : null;
    const base = {
      language: "ja",
      kind: "word",
      term: q,
      lemma: (conj && conj.dictionary) || q,
      phonetic: "",
      pos: [],
      glosses: [],
      glossesEn: [],
      forms: (conj && conj.forms) || {},
      connection: (conj && conj.connection) || [],
      tips: [],
      rawNote: note,
      isGrammar: false,
    };
    if (root.WordTranslate && root.WordTranslate.fillTrilingualGlosses) {
      return root.WordTranslate.fillTrilingualGlosses(base);
    }
    return base;
  }

  function unique(arr) {
    return [...new Set((arr || []).filter(Boolean))];
  }

  root.EnrichJa = { enrichJapanese };
})(typeof globalThis !== "undefined" ? globalThis : self);
