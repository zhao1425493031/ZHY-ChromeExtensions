/**
 * English enrichment via Free Dictionary API.
 */
(function (root) {
  "use strict";

  async function enrichEnglish(term) {
    const q = String(term || "").trim();
    if (!q) throw new Error("empty");

    const url =
      "https://api.dictionaryapi.dev/api/v2/entries/en/" +
      encodeURIComponent(q.toLowerCase());
    const res = await fetch(url);
    if (!res.ok) {
      const failed = {
        language: "en",
        term: q,
        lemma: q,
        phonetic: "",
        pos: [],
        glosses: [],
        glossesEn: [],
        forms: guessEnForms(q),
        connection: guessEnConnection(q, []),
        rawNote: "dictionary lookup failed",
      };
      if (root.WordTranslate && root.WordTranslate.fillTrilingualGlosses) {
        return root.WordTranslate.fillTrilingualGlosses(failed);
      }
      return failed;
    }

    const data = await res.json();
    const entry = Array.isArray(data) ? data[0] : null;
    if (!entry) {
      const empty = {
        language: "en",
        term: q,
        lemma: q,
        phonetic: "",
        pos: [],
        glosses: [],
        glossesEn: [],
        forms: {},
        connection: [],
      };
      if (root.WordTranslate && root.WordTranslate.fillTrilingualGlosses) {
        return root.WordTranslate.fillTrilingualGlosses(empty);
      }
      return empty;
    }

    const phonetic =
      entry.phonetic ||
      (entry.phonetics || []).map((p) => p.text).find(Boolean) ||
      "";

    const pos = [];
    const glosses = [];
    const connection = [];

    (entry.meanings || []).forEach((m) => {
      if (m.partOfSpeech) pos.push(m.partOfSpeech);
      (m.definitions || []).slice(0, 4).forEach((d) => {
        if (d.definition) glosses.push(d.definition);
        if (d.example) connection.push("e.g. " + d.example);
      });
      (m.synonyms || []).slice(0, 5).forEach((s) => {
        connection.push("syn: " + s);
      });
    });

    const forms = guessEnForms(q, pos);
    const moreConn = guessEnConnection(q, pos);
    moreConn.forEach((c) => {
      if (!connection.includes(c)) connection.push(c);
    });

    const base = {
      language: "en",
      term: q,
      lemma: entry.word || q,
      phonetic: phonetic,
      pos: unique(pos),
      glosses: unique(glosses).slice(0, 6),
      glossesEn: unique(glosses).slice(0, 6),
      forms,
      connection: unique(connection).slice(0, 8),
      audio:
        (entry.phonetics || []).map((p) => p.audio).find((a) => a) || "",
    };
    if (root.WordTranslate && root.WordTranslate.fillTrilingualGlosses) {
      return root.WordTranslate.fillTrilingualGlosses(base);
    }
    return base;
  }

  function unique(arr) {
    return [...new Set((arr || []).filter(Boolean))];
  }

  function guessEnForms(word, posList) {
    const w = String(word || "").toLowerCase();
    const pos = (posList || []).join(" ");
    const forms = { base: w };

    if (/verb/i.test(pos) || looksLikeVerb(w)) {
      forms.present3 = regularPresent3(w);
      forms.past = regularPast(w);
      forms.ing = regularIng(w);
      forms.pp = forms.past;
    }
    if (/noun/i.test(pos)) {
      forms.plural = regularPlural(w);
    }
    if (/adj|adverb/i.test(pos)) {
      forms.comparative = w.endsWith("e") ? w + "r" : w + "er";
      forms.superlative = w.endsWith("e") ? w + "st" : w + "est";
    }
    return forms;
  }

  function guessEnConnection(word, posList) {
    const pos = (posList || []).join(" ");
    const out = [];
    if (/verb/i.test(pos)) {
      out.push("V + to-inf / V-ing (depends on verb)");
      out.push("can / will / should + base form");
    }
    if (/noun/i.test(pos)) {
      out.push("a/an/the + N");
      out.push("adj + N / N + of + N");
    }
    if (/adj/i.test(pos)) {
      out.push("be / feel / look + adj");
      out.push("adv + adj");
    }
    if (/adverb/i.test(pos)) {
      out.push("verb + adv / adv + adj");
    }
    return out;
  }

  function looksLikeVerb(w) {
    return /e?d$|ing$|ize$|ise$|ate$|ify$/.test(w);
  }

  function regularPresent3(w) {
    if (/(s|x|z|ch|sh)$/.test(w)) return w + "es";
    if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + "ies";
    return w + "s";
  }

  function regularPast(w) {
    if (w.endsWith("e")) return w + "d";
    if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + "ied";
    if (/^[a-z]+[aeiou][bcdfghjklmnpqrstvz]$/.test(w) && w.length <= 5) {
      return w + w.slice(-1) + "ed";
    }
    return w + "ed";
  }

  function regularIng(w) {
    if (w.endsWith("ie")) return w.slice(0, -2) + "ying";
    if (w.endsWith("e") && !w.endsWith("ee")) return w.slice(0, -1) + "ing";
    if (/^[a-z]+[aeiou][bcdfghjklmnpqrstvz]$/.test(w) && w.length <= 5) {
      return w + w.slice(-1) + "ing";
    }
    return w + "ing";
  }

  function regularPlural(w) {
    if (/(s|x|z|ch|sh)$/.test(w)) return w + "es";
    if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + "ies";
    return w + "s";
  }

  root.EnrichEn = { enrichEnglish };
})(typeof globalThis !== "undefined" ? globalThis : self);
