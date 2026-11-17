/**
 * JLPT grammar dictionary via OpenJLPT (remote JSON, cached).
 * Source: https://github.com/evanclan/OpenJLPT (CC BY-SA 4.0)
 */
(function (root) {
  "use strict";

  const LEVELS = ["n5", "n4", "n3", "n2", "n1"];
  const CACHE_KEY = "openjlpt_grammar_v1";
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const CDN_BASE =
    "https://cdn.jsdelivr.net/gh/evanclan/OpenJLPT@main/data/json/grammar/";

  /** @type {Array<Record<string, any>>|null} */
  let memory = null;
  /** @type {Promise<Array<Record<string, any>>>|null} */
  let loading = null;

  function normalize(s) {
    return String(s || "")
      .trim()
      .replace(/\s+/g, "")
      .replace(/[〜～・･]/g, "")
      .replace(/（/g, "(")
      .replace(/）/g, ")")
      .replace(/[。．.]+$/g, "");
  }

  /** Expand pattern / reading into matchable surface forms. */
  function expandForms(pattern, reading) {
    const out = new Set();
    const push = (raw) => {
      const n = normalize(raw);
      if (!n || n.length < 1) return;
      out.add(n);
      // optional paren chunks: 末(に) → 末に / 末
      if (/[()]/.test(n)) {
        out.add(n.replace(/[()]/g, ""));
        out.add(n.replace(/\([^)]*\)/g, ""));
      }
    };

    push(pattern);
    push(reading);
    // drop leading wave dash already handled; also try without trailing に/だ
    [...out].forEach((f) => {
      if (f.endsWith("に") && f.length > 2) out.add(f.slice(0, -1));
      if (f.endsWith("だ") && f.length > 2) out.add(f.slice(0, -1));
    });
    return [...out].filter((f) => f.length >= 2);
  }

  function indexEntry(g) {
    const forms = expandForms(g.pattern, g.reading);
    return { ...g, _forms: forms };
  }

  async function fetchLevel(level) {
    const res = await fetch(CDN_BASE + level + ".json");
    if (!res.ok) throw new Error("grammar fetch " + level + " " + res.status);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  async function loadFromNetwork() {
    const chunks = await Promise.all(LEVELS.map(fetchLevel));
    return chunks.flat().map(indexEntry);
  }

  async function readCache() {
    try {
      if (!chrome?.storage?.local) return null;
      const bag = await chrome.storage.local.get(CACHE_KEY);
      const hit = bag[CACHE_KEY];
      if (!hit || !Array.isArray(hit.items) || !hit.savedAt) return null;
      if (Date.now() - hit.savedAt > CACHE_TTL_MS) return null;
      return hit.items.map(indexEntry);
    } catch {
      return null;
    }
  }

  async function writeCache(items) {
    try {
      if (!chrome?.storage?.local) return;
      // store without _forms to save space; rebuild on load
      const slim = items.map((g) => ({
        id: g.id,
        pattern: g.pattern,
        reading: g.reading,
        romaji: g.romaji,
        level: g.level,
        meaning: g.meaning,
        formation: g.formation,
        examples: (g.examples || []).slice(0, 3),
        tags: g.tags,
        notes: g.notes,
      }));
      await chrome.storage.local.set({
        [CACHE_KEY]: { savedAt: Date.now(), items: slim },
      });
    } catch {
      // ignore quota
    }
  }

  async function ensureLoaded() {
    if (memory) return memory;
    if (loading) return loading;
    loading = (async () => {
      const cached = await readCache();
      if (cached && cached.length) {
        memory = cached;
        return memory;
      }
      const fresh = await loadFromNetwork();
      memory = fresh;
      await writeCache(fresh);
      return memory;
    })().finally(() => {
      loading = null;
    });
    return loading;
  }

  function scoreMatch(query, forms) {
    let best = 0;
    for (const f of forms) {
      if (query === f) return 1000 + f.length;
      if (query.endsWith(f)) best = Math.max(best, 500 + f.length);
      else if (f.endsWith(query) && query.length >= 3)
        best = Math.max(best, 300 + query.length);
      else if (query.includes(f) && f.length >= 3)
        best = Math.max(best, 200 + f.length);
    }
    return best;
  }

  /**
   * @param {string} term
   * @returns {Promise<Record<string, any>|null>}
   */
  async function lookup(term) {
    const q = normalize(term);
    if (!q) return null;
    const all = await ensureLoaded();
    let best = null;
    let bestScore = 0;
    for (const g of all) {
      const sc = scoreMatch(q, g._forms || expandForms(g.pattern, g.reading));
      if (sc > bestScore) {
        bestScore = sc;
        best = g;
      }
    }
    // require a meaningful hit (exact or solid suffix)
    if (bestScore < 300) return null;
    return best;
  }

  function toEntry(grammar, surface) {
    const lemma = String(grammar.pattern || surface || "")
      .replace(/[〜～]/g, "")
      .trim();
    const reading = String(grammar.reading || grammar.romaji || "")
      .replace(/[〜～]/g, "")
      .trim();
    // formation only in connection; examples kept separate
    const connection = grammar.formation
      ? [String(grammar.formation)]
      : [];
    const tips = [];
    if (grammar.notes) tips.push(String(grammar.notes));
    if (grammar.tags && grammar.tags.length) {
      tips.push("标签：" + grammar.tags.join(", "));
    }
    const glossEn = grammar.meaning
      ? String(grammar.meaning)
          .split(/[;；]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    return {
      language: "ja",
      kind: "grammar",
      term: surface,
      lemma,
      phonetic: reading,
      jlpt: grammar.level || "",
      pos: ["文法", grammar.level ? `JLPT ${grammar.level}` : "表現"].filter(
        Boolean
      ),
      glosses: glossEn.slice(),
      glossesZh: [],
      glossesEn: glossEn.slice(),
      glossesJa: [lemma],
      forms: {},
      connection,
      tips,
      tipsEn: tips.slice(),
      examples: (grammar.examples || []).slice(0, 3),
      isGrammar: true,
      source: "OpenJLPT",
      grammarId: grammar.id || "",
    };
  }

  /** Force refresh from CDN (optional). */
  async function reload() {
    memory = null;
    try {
      if (chrome?.storage?.local) await chrome.storage.local.remove(CACHE_KEY);
    } catch {
      // ignore
    }
    return ensureLoaded();
  }

  root.JaGrammar = {
    lookup,
    toEntry,
    ensureLoaded,
    reload,
    source: "OpenJLPT",
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
