import { describe, expect, it } from "vitest";
import {
  clampPaneWidth,
  MIN_CENTER_WIDTH,
  MIN_FILES_WIDTH,
  MIN_MARGIN_WIDTH,
  MIN_REVIEW_WIDTH,
} from "../layout-store";

describe("clampPaneWidth", () => {
  const wideBody = { bodyWidth: 1600 };

  it("honours the margin minimum", () => {
    const result = clampPaneWidth({
      side: "margin",
      desired: 50,
      otherFixedWidth: 220 + 340,
      ...wideBody,
    });
    expect(result).toBe(MIN_MARGIN_WIDTH);
  });

  it("honours the review minimum", () => {
    const result = clampPaneWidth({
      side: "review",
      desired: 100,
      otherFixedWidth: 220 + 220,
      ...wideBody,
    });
    expect(result).toBe(MIN_REVIEW_WIDTH);
  });

  it("honours the files minimum", () => {
    const result = clampPaneWidth({
      side: "files",
      desired: 50,
      otherFixedWidth: 220 + 340,
      ...wideBody,
    });
    expect(result).toBe(MIN_FILES_WIDTH);
  });

  it("pins at the center-minimum ceiling when the user drags outward", () => {
    // max for margin = 1600 - 400(center-min) - (220+340) = 640.
    const result = clampPaneWidth({
      side: "margin",
      desired: 5000,
      otherFixedWidth: 220 + 340,
      ...wideBody,
    });
    expect(result).toBe(1600 - MIN_CENTER_WIDTH - (220 + 340));
  });

  it("pins files at the center-minimum ceiling when dragged outward", () => {
    // max for files = 1600 - 400 - (220+340) = 640.
    const result = clampPaneWidth({
      side: "files",
      desired: 5000,
      otherFixedWidth: 220 + 340,
      ...wideBody,
    });
    expect(result).toBe(1600 - MIN_CENTER_WIDTH - (220 + 340));
  });

  it("passes a valid in-range value through unchanged", () => {
    const result = clampPaneWidth({
      side: "review",
      desired: 420,
      otherFixedWidth: 220 + 220,
      ...wideBody,
    });
    expect(result).toBe(420);
  });

  it("collapses to the minimum on a degenerate viewport", () => {
    // files + center + margin + review mins = 180 + 400 + 180 + 320 = 1080.
    // Body at 900 can't satisfy both remaining minimums, so review pins to its floor.
    const result = clampPaneWidth({
      side: "review",
      desired: 500,
      bodyWidth: 900,
      otherFixedWidth: 220 + 180,
    });
    expect(result).toBe(MIN_REVIEW_WIDTH);
  });

  it("skips files width in reviewer mode", () => {
    // No files column: full body available. max = 1200 - 400 - 180 = 620.
    const result = clampPaneWidth({
      side: "review",
      desired: 900,
      bodyWidth: 1200,
      otherFixedWidth: 180,
    });
    expect(result).toBe(1200 - MIN_CENTER_WIDTH - 180);
  });
});
