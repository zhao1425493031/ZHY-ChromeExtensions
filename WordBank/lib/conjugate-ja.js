/**
 * Basic Japanese verb / i-adjective conjugations for WordBank cards.
 * Not exhaustive; covers common godan / ichidan / する / 来る / い形容詞.
 */
(function (root) {
  "use strict";

  const GODAN_MAP = {
    う: { a: "わ", i: "い", e: "え", o: "お", te: "って", ta: "った" },
    く: { a: "か", i: "き", e: "け", o: "こ", te: "いて", ta: "いた" },
    ぐ: { a: "が", i: "ぎ", e: "げ", o: "ご", te: "いで", ta: "いだ" },
    す: { a: "さ", i: "し", e: "せ", o: "そ", te: "して", ta: "した" },
    つ: { a: "た", i: "ち", e: "て", o: "と", te: "って", ta: "った" },
    ぬ: { a: "な", i: "に", e: "ね", o: "の", te: "んで", ta: "んだ" },
    ぶ: { a: "ば", i: "び", e: "べ", o: "ぼ", te: "んで", ta: "んだ" },
    む: { a: "ま", i: "み", e: "め", o: "も", te: "んで", ta: "んだ" },
    る: { a: "ら", i: "り", e: "れ", o: "ろ", te: "って", ta: "った" },
  };

  function isIchidan(dict) {
    if (!dict.endsWith("る") || dict.length < 2) return false;
    const before = dict[dict.length - 2];
    // i/e-row kana before る → often ichidan (approx.)
    return "いきぎしじちぢにひびみりえけげせぜてでねへべめれ".includes(
      before
    );
  }

  function conjugateVerb(dictForm, posHints) {
    const dict = String(dictForm || "").trim();
    if (!dict) return null;

    const hints = (posHints || []).join(" ");
    const isSuru =
      dict === "する" ||
      dict.endsWith("する") ||
      /サ変|suru/i.test(hints);
    const isKuru = dict === "来る" || dict === "くる";
    const ichidan =
      isIchidan(dict) || /一段|ichidan|ru.?verb/i.test(hints);

    if (isKuru) {
      return {
        dictionary: "来る",
        forms: {
          ない形: "来ない",
          ます形: "来ます",
          て形: "来て",
          た形: "来た",
          ば形: "来れば",
          意向形: "来よう",
          可能形: "来られる",
        },
        connection: [
          "て形 + ください / みる / しまう",
          "た形 + ことがある / あとで",
          "ない形 + でください",
        ],
      };
    }

    if (isSuru || dict.endsWith("する")) {
      const stem = dict.endsWith("する") ? dict.slice(0, -2) : "";
      const base = stem || "";
      return {
        dictionary: dict,
        forms: {
          ない形: base + "しない",
          ます形: base + "します",
          て形: base + "して",
          た形: base + "した",
          ば形: base + "すれば",
          意向形: base + "しよう",
          可能形: base + "できる",
        },
        connection: [
          "して + ください / みる / おく",
          "した + ことがある / ばかり",
          "しない + でください",
        ],
      };
    }

    if (ichidan && dict.endsWith("る")) {
      const stem = dict.slice(0, -1);
      return {
        dictionary: dict,
        forms: {
          ない形: stem + "ない",
          ます形: stem + "ます",
          て形: stem + "て",
          た形: stem + "た",
          ば形: stem + "れば",
          意向形: stem + "よう",
          可能形: stem + "られる",
        },
        connection: [
          "て形 + ください / みる / しまう / いる",
          "た形 + り…たり / あと",
          "ない形 + で / ければ",
        ],
      };
    }

    const ending = dict.slice(-1);
    const map = GODAN_MAP[ending];
    if (!map || dict.length < 2) return null;
    const stem = dict.slice(0, -1);
    return {
      dictionary: dict,
      forms: {
        ない形: stem + map.a + "ない",
        ます形: stem + map.i + "ます",
        て形: stem + map.te,
        た形: stem + map.ta,
        ば形: stem + map.e + "ば",
        意向形: stem + map.o + "う",
        可能形: stem + map.e + "る",
      },
      connection: [
        "て形 + ください / から / もいい",
        "た形 + ことがある / ほうがいい",
        "ない形 + でください / ければならない",
      ],
    };
  }

  function conjugateIAdj(dictForm) {
    const dict = String(dictForm || "").trim();
    if (!dict.endsWith("い") || dict.length < 2) return null;
    if (dict === "きれい" || dict.endsWith("ない") && dict.length > 2) {
      // many な-adj end with い visually; skip weak cases
    }
    const stem = dict.slice(0, -1);
    return {
      dictionary: dict,
      forms: {
        く形: stem + "く",
        くない: stem + "くない",
        かった: stem + "かった",
        くて: stem + "くて",
        ければ: stem + "ければ",
        そうです: stem + "そうです",
      },
      connection: [
        "くて + 形容词 / 动词",
        "くない + です / んです",
        "かった + です / と思う",
      ],
    };
  }

  function conjugateJa(dictForm, posHints) {
    const pos = (posHints || []).join(" ");
    if (/形容詞|い形容詞|i-adj/i.test(pos) || (/い$/.test(dictForm) && /adj/i.test(pos))) {
      return conjugateIAdj(dictForm) || conjugateVerb(dictForm, posHints);
    }
    if (/動詞|verb/i.test(pos) || /[うくぐすつぬぶむる]$/.test(dictForm)) {
      return conjugateVerb(dictForm, posHints);
    }
    if (/い$/.test(dictForm)) return conjugateIAdj(dictForm);
    return conjugateVerb(dictForm, posHints);
  }

  root.JaConjugate = { conjugateJa, conjugateVerb, conjugateIAdj };
})(typeof globalThis !== "undefined" ? globalThis : self);
