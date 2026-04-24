import { describe, expect, it } from "vitest";
import {
  clampPaneWidth,
  MIN_CENTER_WIDTH,
  MIN_MARGIN_WIDTH,
  MIN_REVIEW_WIDTH,
} from "../layout-store";

describe("clampPaneWidth", () => {
  const wideBody = { bodyWidth: 1600, filesWidth: 220 };

  it("honours the margin minimum", () => {
    const result = clampPaneWidth({
      side: "margin",
      desired: 50,
      otherWidth: 340,
      ...wideBody,
    });
    expect(result).toBe(MIN_MARGIN_WIDTH);
  });

  it("honours the review minimum", () => {
    const result = clampPaneWidth({
      side: "review",
      desired: 100,
      otherWidth: 220,
      ...wideBody,
    });
    expect(result).toBe(MIN_REVIEW_WIDTH);
  });

  it("pins at the center-minimum ceiling when the user drags outward", () => {
    // Available room for margin = 1600 - 220(files) - 400(center-min) - 340(review) = 640.
    const result = clampPaneWidth({
      side: "margin",
      desired: 5000,
      otherWidth: 340,
      ...wideBody,
    });
    expect(result).toBe(1600 - 220 - MIN_CENTER_WIDTH - 340);
  });

  it("passes a valid in-range value through unchanged", () => {
    const result = clampPaneWidth({
      side: "review",
      desired: 420,
      otherWidth: 220,
      ...wideBody,
    });
    expect(result).toBe(420);
  });

  it("collapses to the minimum on a degenerate viewport", () => {
    // filesWidth + centerMin + marginMin + reviewMin = 220 + 400 + 180 + 320 = 1120.
    // Body at 900 can't satisfy both minimums, so review pins to its floor.
    const result = clampPaneWidth({
      side: "review",
      desired: 500,
      bodyWidth: 900,
      filesWidth: 220,
      otherWidth: 180,
    });
    expect(result).toBe(MIN_REVIEW_WIDTH);
  });

  it("skips files width in reviewer mode", () => {
    // No files column: full body available. max = 1200 - 0 - 400 - 180 = 620.
    const result = clampPaneWidth({
      side: "review",
      desired: 900,
      bodyWidth: 1200,
      filesWidth: 0,
      otherWidth: 180,
    });
    expect(result).toBe(1200 - MIN_CENTER_WIDTH - 180);
  });
});
