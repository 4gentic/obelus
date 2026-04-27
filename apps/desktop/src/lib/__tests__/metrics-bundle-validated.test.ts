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
