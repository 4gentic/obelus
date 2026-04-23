import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyMatch, fuzzyScore } from "../fuzzy";

describe("fuzzyScore", () => {
  it("empty needle scores 0", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  it("full subsequence returns a positive score", () => {
    const s = fuzzyScore("abc", "aXbXc");
    expect(s).not.toBeNull();
    expect(s).toBeGreaterThan(0);
  });

  it("missing character returns null", () => {
    expect(fuzzyScore("abc", "ab")).toBeNull();
  });

  it("adjacent matches score higher than scattered ones", () => {
    const close = fuzzyScore("abc", "abcxyz");
    const far = fuzzyScore("abc", "a1b2c3");
    expect(close).not.toBeNull();
    expect(far).not.toBeNull();
    if (close !== null && far !== null) {
      expect(close).toBeGreaterThan(far);
    }
  });

  it("word-start matches beat mid-word matches", () => {
    const start = fuzzyScore("p", "paper");
    const mid = fuzzyScore("p", "xxxp");
    expect(start).not.toBeNull();
    expect(mid).not.toBeNull();
    if (start !== null && mid !== null) {
      expect(start).toBeGreaterThan(mid);
    }
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("ABC", "abc")).not.toBeNull();
    expect(fuzzyScore("abc", "ABC")).not.toBeNull();
  });
});

describe("fuzzyFilter", () => {
  const items = ["paper one", "paper two", "notes", "refs.bib"];

  it("empty query returns all items in original order", () => {
    const hits = fuzzyFilter(items, "", (s) => s);
    expect(hits.map((h) => h.item)).toEqual(items);
  });

  it("ranks exact-ish matches above scattered", () => {
    const hits = fuzzyFilter(items, "paper", (s) => s);
    expect(hits[0]?.item).toMatch(/paper/);
    expect(hits.some((h) => h.item === "notes")).toBe(false);
  });

  it("drops items that do not contain the subsequence", () => {
    const hits = fuzzyFilter(items, "zzz", (s) => s);
    expect(hits).toEqual([]);
  });
});

describe("fuzzyMatch", () => {
  it("empty needle returns score 0 and no indices", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, indices: [] });
  });

  it("returns the haystack index of each matched char", () => {
    const m = fuzzyMatch("abc", "aXbXc");
    expect(m).not.toBeNull();
    expect(m?.indices).toEqual([0, 2, 4]);
  });

  it("returns null when a character is missing", () => {
    expect(fuzzyMatch("abc", "ab")).toBeNull();
  });

  it("matches the score produced by fuzzyScore", () => {
    const q = "pap";
    const h = "paper.md";
    expect(fuzzyMatch(q, h)?.score).toBe(fuzzyScore(q, h));
  });

  it("is case-insensitive", () => {
    const m = fuzzyMatch("ABC", "aXbXc");
    expect(m).not.toBeNull();
    expect(m?.indices).toEqual([0, 2, 4]);
  });
});
