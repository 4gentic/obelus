import { describe, expect, it } from "vitest";
import { normalizeForSearch, normalizeQuery } from "../search-normalize";

// Inputs are built from explicit code points (only ASCII hex appears in this
// file) so the invisible / typographic characters under test are unambiguous —
// a stray precomposed-vs-decomposed glyph would silently invert an assertion.
const FI = String.fromCodePoint(0xfb01); // "ﬁ" ligature, one code point
const LDQUO = String.fromCodePoint(0x201c);
const RDQUO = String.fromCodePoint(0x201d);
const EM_DASH = String.fromCodePoint(0x2014);
const EN_DASH = String.fromCodePoint(0x2013);
const SOFT_HYPHEN = String.fromCodePoint(0x00ad);
const ZWSP = String.fromCodePoint(0x200b);
const ZWNJ = String.fromCodePoint(0x200c);
const NBSP = String.fromCodePoint(0x00a0);
const THIN_SPACE = String.fromCodePoint(0x2009);
const ACUTE = String.fromCodePoint(0x0301); // combining acute accent
const E_ACUTE = String.fromCodePoint(0x00e9); // precomposed "é"
const MATH_A = String.fromCodePoint(0x1d400); // mathematical bold capital A
const MATH_B = String.fromCodePoint(0x1d401);

// Project a normalized hit back onto the original string the way the find
// providers do: `[h, h+L)` in normalized space -> `[map[h], map[h+L])` in
// original space. Returns the original substring a highlight would cover.
function findFirst(input: string, query: string): string | null {
  const { text, map } = normalizeForSearch(input);
  const needle = normalizeQuery(query);
  const h = text.indexOf(needle);
  if (h < 0) return null;
  const o0 = map[h] ?? 0;
  const o1 = map[h + needle.length] ?? input.length;
  return input.slice(o0, o1);
}

describe("normalizeForSearch", () => {
  it("is identity on plain ASCII", () => {
    const { text, map } = normalizeForSearch("hello world");
    expect(text).toBe("hello world");
    expect([...map]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("expands the fi ligature and maps both halves to its source index", () => {
    const { text, map } = normalizeForSearch(`de${FI}nition`);
    expect(text).toBe("definition");
    expect([...map]).toEqual([0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("folds smart quotes and dashes to ASCII", () => {
    expect(normalizeForSearch(`${LDQUO}quote${RDQUO}`).text).toBe('"quote"');
    expect(normalizeForSearch(`a${EM_DASH}b`).text).toBe("a-b");
    expect(normalizeForSearch(`1${EN_DASH}5`).text).toBe("1-5");
  });

  it("collapses whitespace runs to one space mapped to the run start", () => {
    const { text, map } = normalizeForSearch("a   b");
    expect(text).toBe("a b");
    expect([...map]).toEqual([0, 1, 4, 5]);
  });

  it("drops soft hyphens and zero-width characters", () => {
    expect(normalizeForSearch(`ab${SOFT_HYPHEN}cd`).text).toBe("abcd");
    expect(normalizeForSearch(`a${ZWSP}b${ZWNJ}c`).text).toBe("abc");
  });

  it("normalizes non-breaking and thin spaces to a plain space", () => {
    expect(normalizeForSearch(`a${NBSP}b`).text).toBe("a b");
    expect(normalizeForSearch(`a${THIN_SPACE}b`).text).toBe("a b");
  });

  it("composes a decomposed diacritic into one mapped unit", () => {
    const { text, map } = normalizeForSearch(`e${ACUTE}`);
    expect(text).toBe(E_ACUTE);
    expect([...map]).toEqual([0, 2]);
  });

  it("folds mathematical bold letters (astral) to ASCII", () => {
    const { text, map } = normalizeForSearch(`${MATH_A}${MATH_B}`);
    expect(text).toBe("AB");
    expect([...map]).toEqual([0, 2, 4]);
  });

  it("keeps the map length at text.length + 1 with a final sentinel", () => {
    const inputs = ["", "abc", `de${FI}nition`, "a   b", `cafe${ACUTE}`, `ab${SOFT_HYPHEN}cd`];
    for (const input of inputs) {
      const { text, map } = normalizeForSearch(input);
      expect(map.length).toBe(text.length + 1);
      expect(map[text.length]).toBe(input.length);
    }
  });
});

describe("normalizeForSearch — projection back to original characters", () => {
  it("recovers the ligature span for an ASCII query", () => {
    expect(findFirst(`de${FI}nition`, "definition")).toBe(`de${FI}nition`);
    expect(findFirst(`de${FI}nition`, "fi")).toBe(FI);
  });

  it("recovers a dash/quote span when the query is ASCII", () => {
    expect(findFirst(`pages 1${EM_DASH}5 here`, "1-5")).toBe(`1${EM_DASH}5`);
    expect(findFirst(`say ${LDQUO}hi${RDQUO} now`, '"hi"')).toBe(`${LDQUO}hi${RDQUO}`);
  });

  it("recovers a whitespace-collapsed span", () => {
    expect(findFirst("a   b", "a b")).toBe("a   b");
  });

  it("matches a precomposed query against a decomposed source", () => {
    expect(findFirst(`cafe${ACUTE}`, `caf${E_ACUTE}`)).toBe(`cafe${ACUTE}`);
  });

  it("does not strip diacritics (composition only, not accent folding)", () => {
    expect(findFirst(`caf${E_ACUTE}`, "cafe")).toBeNull();
  });
});

describe("normalizeQuery", () => {
  it("applies the same transforms as the haystack", () => {
    expect(normalizeQuery(`de${FI}nition`)).toBe("definition");
    expect(normalizeQuery(`${LDQUO}x${RDQUO}`)).toBe('"x"');
    expect(normalizeQuery("a   b")).toBe("a b");
  });
});
