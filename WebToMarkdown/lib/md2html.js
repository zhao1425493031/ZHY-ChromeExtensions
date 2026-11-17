/**
 * Lightweight Markdown → safe HTML for popup preview.
 * Supports: headings, paragraphs, lists, links, images, code, blockquote, hr, table, emphasis.
 */
(function (root) {
  "use strict";

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function safeUrl(url) {
    const u = String(url || "").trim();
    if (!u) return "";
    if (/^(https?:|mailto:|\/|#)/i.test(u)) return u;
    return "";
  }

  function inline(md) {
    const slots = [];
    const park = (html) => {
      const token = `\u0000PH${slots.length}\u0000`;
      slots.push(html);
      return token;
    };

    // Protect code / images / links before emphasis, so "_"/ "~" inside URLs
    // are not treated as italic / strike and do not corrupt src/href.
    let s = String(md || "");

    s = s.replace(/`([^`]+)`/g, (_, c) => park(`<code>${escapeHtml(c)}</code>`));

    s = s.replace(
      /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
      (_, alt, url) => {
        const href = safeUrl(url);
        if (!href) return alt || "";
        return park(
          `<img src="${escapeHtml(href)}" alt="${escapeHtml(alt || "")}" loading="lazy" />`
        );
      }
    );

    s = s.replace(
      /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
      (_, text, url) => {
        const href = safeUrl(url);
        if (!href) return text;
        return park(
          `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`
        );
      }
    );

    s = escapeHtml(s);

    // bold / italic / strike on remaining plain text only
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    s = s.replace(/_([^_]+)_/g, "<em>$1</em>");
    s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");

    return s.replace(/\u0000PH(\d+)\u0000/g, (_, n) => slots[Number(n)] || "");
  }

  function isTableSep(line) {
    return /^\s*\|?[\s:|-]+\|[\s:|-]*\|?\s*$/.test(line) && /---/.test(line);
  }

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s.split("|").map((c) => c.trim());
  }

  function markdownToHtml(md) {
    const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let i = 0;
    let para = [];

    function flushPara() {
      if (!para.length) return;
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }

    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) {
        flushPara();
        i += 1;
        continue;
      }

      // fenced code
      const fence = line.match(/^```([\w+-]*)\s*$/);
      if (fence) {
        flushPara();
        const lang = fence[1] || "";
        const buf = [];
        i += 1;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) {
          buf.push(lines[i]);
          i += 1;
        }
        i += 1;
        out.push(
          `<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(
            buf.join("\n")
          )}</code></pre>`
        );
        continue;
      }

      // heading
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        flushPara();
        const level = heading[1].length;
        out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
        i += 1;
        continue;
      }

      // hr
      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
        flushPara();
        out.push("<hr />");
        i += 1;
        continue;
      }

      // blockquote
      if (/^>\s?/.test(line)) {
        flushPara();
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^>\s?/, ""));
          i += 1;
        }
        out.push(`<blockquote>${markdownToHtml(buf.join("\n"))}</blockquote>`);
        continue;
      }

      // table
      if (
        line.includes("|") &&
        i + 1 < lines.length &&
        isTableSep(lines[i + 1])
      ) {
        flushPara();
        const head = splitRow(line);
        i += 2;
        const body = [];
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
          body.push(splitRow(lines[i]));
          i += 1;
        }
        let html = "<table><thead><tr>";
        head.forEach((c) => {
          html += `<th>${inline(c)}</th>`;
        });
        html += "</tr></thead><tbody>";
        body.forEach((row) => {
          html += "<tr>";
          head.forEach((_, idx) => {
            html += `<td>${inline(row[idx] || "")}</td>`;
          });
          html += "</tr>";
        });
        html += "</tbody></table>";
        out.push(html);
        continue;
      }

      // unordered list
      if (/^\s*[-*+]\s+/.test(line)) {
        flushPara();
        out.push("<ul>");
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          out.push(`<li>${inline(lines[i].replace(/^\s*[-*+]\s+/, ""))}</li>`);
          i += 1;
        }
        out.push("</ul>");
        continue;
      }

      // ordered list
      if (/^\s*\d+\.\s+/.test(line)) {
        flushPara();
        out.push("<ol>");
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          out.push(`<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>`);
          i += 1;
        }
        out.push("</ol>");
        continue;
      }

      para.push(line.trim());
      i += 1;
    }

    flushPara();
    return out.join("\n") || `<p class="empty">${escapeHtml("")}</p>`;
  }

  root.MdPreview = { markdownToHtml };
})(typeof globalThis !== "undefined" ? globalThis : self);
