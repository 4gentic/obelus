import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES, descriptionFor } from "../index.js";

describe("DEFAULT_CATEGORIES", () => {
  it("carries a non-empty description for every category", () => {
    for (const c of DEFAULT_CATEGORIES) {
      expect(c.description, `category ${c.id} is missing a description`).toBeTruthy();
      expect(c.description.length).toBeGreaterThan(8);
    }
  });

  it("exposes the eight expected slugs in picker order", () => {
    expect(DEFAULT_CATEGORIES.map((c) => c.id)).toEqual([
      "remove",
      "elaborate",
      "rephrase",
      "improve",
      "wrong",
      "weak-argument",
      "praise",
      "note",
    ]);
  });
});

describe("descriptionFor", () => {
  it("returns the description for a known slug", () => {
    expect(descriptionFor("improve")).toMatch(/forward-looking/i);
  });

  it("returns undefined for an unknown slug", () => {
    expect(descriptionFor("nitpick")).toBeUndefined();
  });
});
