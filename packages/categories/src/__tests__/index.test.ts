import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES, descriptionFor } from "../index.js";

describe("DEFAULT_CATEGORIES", () => {
  it("carries a non-empty description for every category", () => {
    for (const c of DEFAULT_CATEGORIES) {
      expect(c.description, `category ${c.id} is missing a description`).toBeTruthy();
      expect(c.description.length).toBeGreaterThan(8);
    }
  });

  it("exposes the nine expected slugs", () => {
    expect(DEFAULT_CATEGORIES.map((c) => c.id)).toEqual([
      "unclear",
      "wrong",
      "weak-argument",
      "citation-needed",
      "rephrase",
      "praise",
      "enhancement",
      "aside",
      "flag",
    ]);
  });
});

describe("descriptionFor", () => {
  it("returns the description for a known slug", () => {
    expect(descriptionFor("enhancement")).toMatch(/forward-looking/i);
  });

  it("returns undefined for an unknown slug", () => {
    expect(descriptionFor("nitpick")).toBeUndefined();
  });
});
