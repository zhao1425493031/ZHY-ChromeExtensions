/**
 * Lightweight HTML → Markdown. Runs in extension pages (popup / SW via importScripts).
 * Options: { keepImages?: boolean }
 */
(function (root) {
  "use strict";

  const BLOCK_SKIP = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "SVG",
    "IFRAME",
    "OBJECT",
    "EMBED",
    "BUTTON",
    "INPUT",
    "SELECT",
    "TEXTAREA",
    "FORM",
    "NAV",
    "FOOTER",
    "HEADER",
    "ASIDE",
  ]);

  function decodeEntities(text) {
    return String(text)
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
        String.fromCharCode(parseInt(h, 16))
      );
  }

  function escapeMdInline(text) {
    return String(text).replace(/([\\`*_[\]#])/g, "\\$1");
  }

  function collapseWs(text) {
    return String(text).replace(/[ \t\f\v]+/g, " ");
  }

  function trimBlankLines(md) {
    return md
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function absUrl(href, base) {
    if (!href) return "";
    try {
      return new URL(href, base || undefined).href;
    } catch {
      return href;
    }
  }

  function cellText(node, opts) {
    return collapseWs(inlineChildren(node, opts)).trim();
  }

  function inlineChildren(node, opts) {
    let out = "";
    for (const child of node.childNodes) {
      out += walkInline(child, opts);
    }
    return out;
  }

  function walkInline(node, opts) {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeMdInline(collapseWs(decodeEntities(node.nodeValue || "")));
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName;
    if (BLOCK_SKIP.has(tag) || tag === "BR") {
      if (tag === "BR") return "  \n";
      return "";
    }

    if (tag === "A") {
      const text = collapseWs(inlineChildren(node, opts)).trim() || "link";
      const href = absUrl(node.getAttribute("href"), opts.baseUrl);
      if (!href || href.startsWith("javascript:")) return text;
      return `[${text}](${href})`;
    }

    if (tag === "IMG") {
      if (!opts.keepImages) return "";
      const alt = escapeMdInline(node.getAttribute("alt") || "image");
      const src = absUrl(
        node.getAttribute("src") || node.getAttribute("data-src"),
        opts.baseUrl
      );
      if (!src || src.startsWith("data:")) return "";
      return `![${alt}](${src})`;
    }

    if (tag === "CODE" && node.parentElement?.tagName !== "PRE") {
      const code = decodeEntities(node.textContent || "").replace(/`/g, "\\`");
      return "`" + code + "`";
    }

    if (tag === "STRONG" || tag === "B") {
      const t = collapseWs(inlineChildren(node, opts)).trim();
      return t ? `**${t}**` : "";
    }

    if (tag === "EM" || tag === "I") {
      const t = collapseWs(inlineChildren(node, opts)).trim();
      return t ? `*${t}*` : "";
    }

    if (tag === "DEL" || tag === "S" || tag === "STRIKE") {
      const t = collapseWs(inlineChildren(node, opts)).trim();
      return t ? `~~${t}~~` : "";
    }

    return inlineChildren(node, opts);
  }

  function listItems(node, ordered, opts, depth) {
    const items = [...node.children].filter((c) => c.tagName === "LI");
    const lines = [];
    items.forEach((li, i) => {
      const prefix = ordered ? `${i + 1}. ` : "- ";
      const indent = "  ".repeat(depth);
      let body = "";
      let nested = "";
      for (const child of li.childNodes) {
        if (
          child.nodeType === Node.ELEMENT_NODE &&
          (child.tagName === "UL" || child.tagName === "OL")
        ) {
          nested +=
            "\n" +
            listItems(child, child.tagName === "OL", opts, depth + 1);
        } else if (
          child.nodeType === Node.ELEMENT_NODE &&
          (child.tagName === "P" || child.tagName === "DIV")
        ) {
          body += collapseWs(inlineChildren(child, opts)).trim() + " ";
        } else {
          body += walkInline(child, opts);
        }
      }
      body = collapseWs(body).trim();
      lines.push(`${indent}${prefix}${body}${nested}`);
    });
    return lines.join("\n");
  }

  function tableToMd(table, opts) {
    const rows = [...table.querySelectorAll("tr")];
    if (!rows.length) return "";
    const matrix = rows.map((tr) =>
      [...tr.children]
        .filter((c) => c.tagName === "TD" || c.tagName === "TH")
        .map((c) => cellText(c, opts).replace(/\|/g, "\\|"))
    );
    const width = Math.max(...matrix.map((r) => r.length), 1);
    const norm = matrix.map((r) => {
      const copy = r.slice();
      while (copy.length < width) copy.push("");
      return copy;
    });
    const head = norm[0];
    const sep = head.map(() => "---");
    const body = norm.slice(1);
    const lines = [
      `| ${head.join(" | ")} |`,
      `| ${sep.join(" | ")} |`,
      ...body.map((r) => `| ${r.join(" | ")} |`),
    ];
    return lines.join("\n");
  }

  function walkBlock(node, opts, out) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = collapseWs(decodeEntities(node.nodeValue || "")).trim();
      if (t) out.push(escapeMdInline(t));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName;
    if (BLOCK_SKIP.has(tag)) return;

    if (/^H[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const text = collapseWs(inlineChildren(node, opts)).trim();
      if (text) out.push(`${"#".repeat(level)} ${text}`);
      return;
    }

    if (tag === "P") {
      const text = collapseWs(inlineChildren(node, opts)).trim();
      if (text) out.push(text);
      return;
    }

    if (tag === "BR") {
      out.push("");
      return;
    }

    if (tag === "HR") {
      out.push("---");
      return;
    }

    if (tag === "BLOCKQUOTE") {
      const inner = [];
      for (const child of node.childNodes) walkBlock(child, opts, inner);
      const quoted = trimBlankLines(inner.join("\n\n"))
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
      if (quoted.trim()) out.push(quoted);
      return;
    }

    if (tag === "PRE") {
      const codeEl = node.querySelector("code");
      const code = decodeEntities(
        (codeEl || node).textContent || ""
      ).replace(/\n$/, "");
      const lang =
        (codeEl &&
          (codeEl.className.match(/language-([\w+-]+)/) || [])[1]) ||
        "";
      out.push("```" + lang + "\n" + code + "\n```");
      return;
    }

    if (tag === "UL" || tag === "OL") {
      out.push(listItems(node, tag === "OL", opts, 0));
      return;
    }

    if (tag === "TABLE") {
      const md = tableToMd(node, opts);
      if (md) out.push(md);
      return;
    }

    if (tag === "IMG") {
      const inline = walkInline(node, opts);
      if (inline) out.push(inline);
      return;
    }

    if (tag === "LI") {
      // orphan li
      const text = collapseWs(inlineChildren(node, opts)).trim();
      if (text) out.push(`- ${text}`);
      return;
    }

    // generic container
    for (const child of node.childNodes) walkBlock(child, opts, out);
  }

  function htmlToMarkdown(html, options) {
    const opts = {
      keepImages: options?.keepImages !== false,
      baseUrl: options?.baseUrl || "",
    };

    const doc = new DOMParser().parseFromString(
      `<div id="__root__">${html || ""}</div>`,
      "text/html"
    );
    const root = doc.getElementById("__root__");
    const out = [];
    for (const child of root.childNodes) walkBlock(child, opts, out);
    return trimBlankLines(out.join("\n\n"));
  }

  function normalizeTitle(s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function firstContentLine(md) {
    return (
      String(md || "")
        .split("\n")
        .find((l) => l.trim()) || ""
    );
  }

  function bodyStartsWithH1(md) {
    return /^#\s+/.test(firstContentLine(md));
  }

  /** Remove leading H1 when it matches document title (avoid double heading). */
  function stripLeadingH1IfMatch(md, title) {
    if (!title) return md || "";
    const lines = String(md || "").split("\n");
    let i = 0;
    while (i < lines.length && !lines[i].trim()) i += 1;
    const m = lines[i] && lines[i].match(/^#\s+(.+)$/);
    if (m && normalizeTitle(m[1]) === normalizeTitle(title)) {
      lines.splice(i, 1);
      while (i < lines.length && !lines[i].trim()) lines.splice(i, 1);
      return lines.join("\n");
    }
    return md || "";
  }

  function yamlScalar(value) {
    const s = String(value ?? "");
    if (s === "") return '""';
    if (/^[\w./:@+-]+$/i.test(s) && !/^(true|false|null|yes|no)$/i.test(s)) {
      return s;
    }
    return JSON.stringify(s);
  }

  /**
   * meta: { includeMeta, yamlFrontMatter, title, url, date }
   * - yamlFrontMatter: YAML block with title/source/date
   * - includeMeta (and not yaml): # title + > Source, skip # title if body already has H1
   */
  function buildDocument(md, meta) {
    const title = meta?.title || "";
    const url = meta?.url || "";
    let body = md || "";

    if (meta?.yamlFrontMatter) {
      body = stripLeadingH1IfMatch(body, title);
      const date = meta.date || new Date().toISOString();
      const lines = ["---"];
      if (title) lines.push(`title: ${yamlScalar(title)}`);
      if (url) lines.push(`source: ${yamlScalar(url)}`);
      lines.push(`date: ${yamlScalar(date)}`);
      lines.push("---", "");
      return trimBlankLines(lines.join("\n") + body);
    }

    if (meta?.includeMeta) {
      body = stripLeadingH1IfMatch(body, title);
      const parts = [];
      // Don't stack another document H1 if body already starts with one
      if (title && !bodyStartsWithH1(body)) parts.push(`# ${title}`);
      if (url) parts.push(`> Source: ${url}`);
      if (parts.length) parts.push("");
      parts.push(body);
      return trimBlankLines(parts.join("\n"));
    }

    return trimBlankLines(body);
  }

  const api = { htmlToMarkdown, buildDocument };
  root.WebToMd = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
