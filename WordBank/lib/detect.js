/**
 * Lightweight language guess for a short selection.
 * Returns 'ja' | 'en' | 'unknown'
 */
(function (root) {
  "use strict";

  function detectLanguage(text) {
    const s = String(text || "").trim();
    if (!s) return "unknown";

    const jaChars = (
      s.match(/[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9d]/g) || []
    ).length;
    const latinChars = (s.match(/[A-Za-z]/g) || []).length;
    const total = Math.max(s.replace(/\s/g, "").length, 1);

    if (jaChars / total >= 0.25 || jaChars >= 1 && jaChars >= latinChars) {
      return "ja";
    }
    if (latinChars / total >= 0.4) return "en";
    if (jaChars > 0) return "ja";
    if (latinChars > 0) return "en";
    return "unknown";
  }

  function normalizeTerm(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }

  root.WordDetect = { detectLanguage, normalizeTerm };
})(typeof globalThis !== "undefined" ? globalThis : self);
