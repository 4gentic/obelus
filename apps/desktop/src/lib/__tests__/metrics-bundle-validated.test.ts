import { describe, expect, it } from "vitest";
import { MetricEvent } from "../metrics";

describe("MetricEvent.bundle-validated", () => {
  const SESSION = "11111111-2222-4333-8444-555555555555";

  it("accepts a passing validation event with errorCount=0 and no errors array", () => {
    const event = {
      event: "bundle-validated" as const,
      at: "2026-04-27T00:00:00.000Z",
      sessionId: SESSION,
      validationMs: 7,
      errorCount: 0,
    };
    expect(MetricEvent.parse(event)).toEqual(event);
  });

  it("accepts a failing validation event with errorCount and errors[]", () => {
    const event = {
      event: "bundle-validated" as const,
      at: "2026-04-27T00:00:00.000Z",
      sessionId: SESSION,
      validationMs: 4,
      errorCount: 2,
      errors: ["bundleVersion is required (at /)", "annotations[0].anchor.kind missing (at /)"],
    };
    expect(MetricEvent.parse(event)).toEqual(event);
  });

  it("rejects negative validationMs", () => {
    const event = {
      event: "bundle-validated" as const,
      at: "2026-04-27T00:00:00.000Z",
      sessionId: SESSION,
      validationMs: -1,
      errorCount: 0,
    };
    expect(MetricEvent.safeParse(event).success).toBe(false);
  });
});

describe("MetricEvent.bundle-stats", () => {
  const SESSION = "11111111-2222-4333-8444-555555555555";

  it("requires model and effort fields (WS3 follow-up)", () => {
    const event = {
      event: "bundle-stats" as const,
      at: "2026-04-27T00:00:00.000Z",
      sessionId: SESSION,
      annotations: 7,
      anchorSource: 7,
      anchorPdf: 0,
      anchorHtml: 0,
      papers: 1,
      files: 12,
      bytes: 4096,
      model: "sonnet",
      effort: "low",
    };
    expect(MetricEvent.parse(event)).toEqual(event);
  });

  it("rejects a bundle-stats event missing model or effort", () => {
    const base = {
      event: "bundle-stats" as const,
      at: "2026-04-27T00:00:00.000Z",
      sessionId: SESSION,
      annotations: 1,
      anchorSource: 1,
      anchorPdf: 0,
      anchorHtml: 0,
      papers: 1,
      files: 1,
      bytes: 100,
    };
    expect(MetricEvent.safeParse({ ...base, effort: "low" }).success).toBe(false);
    expect(MetricEvent.safeParse({ ...base, model: "sonnet" }).success).toBe(false);
  });
});
