/**
 * Injected into the page. Re-injection safe.
 * Returns serializable { title, url, html, mode, selectionEmpty }.
 */
globalThis.extractPageContent = function extractPageContent(options) {
  const opts = options || {};
  const selectionOnly = !!opts.selectionOnly;

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 || el.offsetParent !== null;
  }

  function cloneClean(root) {
    const clone = root.cloneNode(true);
    const kill = clone.querySelectorAll(
      "script,style,noscript,svg,iframe,canvas,button,input,select,textarea,form,nav,footer,aside,[role='navigation'],[role='complementary'],.ads,.ad,.advertisement,.sidebar,.comment,.comments,#comments"
    );
    kill.forEach((n) => n.remove());
    return clone;
  }

  function scoreNode(el) {
    if (!el || !isVisible(el)) return 0;
    const text = (el.innerText || "").replace(/\s+/g, " ").trim();
    const len = text.length;
    if (len < 80) return 0;
    const pCount = el.querySelectorAll("p").length;
    const linkText = [...el.querySelectorAll("a")]
      .map((a) => (a.innerText || "").trim())
      .join("").length;
    const linkDensity = len ? linkText / len : 1;
    let score = len * 0.1 + pCount * 40;
    score *= Math.max(0.15, 1 - linkDensity);
    const tag = el.tagName;
    if (tag === "ARTICLE") score *= 1.6;
    if (tag === "MAIN" || el.getAttribute("role") === "main") score *= 1.4;
    if (/content|article|post|entry|markdown-body/i.test(el.className + el.id))
      score *= 1.3;
    if (/nav|footer|sidebar|comment|related|recommend/i.test(el.className + el.id))
      score *= 0.3;
    return score;
  }

  function pickArticleRoot() {
    const candidates = [];
    const article = document.querySelector("article");
    if (article) candidates.push(article);
    const main =
      document.querySelector("main") ||
      document.querySelector("[role='main']");
    if (main) candidates.push(main);

    document
      .querySelectorAll(
        ".markdown-body, .post-content, .article-content, .entry-content, #content, .content"
      )
      .forEach((el) => candidates.push(el));

    document.querySelectorAll("article, main, section, div").forEach((el) => {
      if ((el.innerText || "").length > 200) candidates.push(el);
    });

    let best = null;
    let bestScore = 0;
    const seen = new Set();
    for (const el of candidates) {
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const s = scoreNode(el);
      if (s > bestScore) {
        bestScore = s;
        best = el;
      }
    }
    return best || document.body;
  }

  const title = document.title || "";
  const url = location.href;

  if (selectionOnly) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      return {
        title,
        url,
        html: "",
        mode: "selection",
        selectionEmpty: true,
      };
    }
    const range = sel.getRangeAt(0);
    const container = document.createElement("div");
    container.appendChild(range.cloneContents());
    return {
      title,
      url,
      html: container.innerHTML,
      mode: "selection",
      selectionEmpty: false,
    };
  }

  const root = pickArticleRoot();
  const clean = cloneClean(root);
  return {
    title,
    url,
    html: clean.innerHTML,
    mode: "article",
    selectionEmpty: false,
  };
};
