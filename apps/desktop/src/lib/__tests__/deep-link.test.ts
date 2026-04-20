import { describe, expect, it } from "vitest";
import { parseDeepLink } from "../deep-link";

describe("parseDeepLink", () => {
  it("parses obelus://open?path=/abs/project", () => {
    const got = parseDeepLink("obelus://open?path=/Users/me/paper");
    expect(got).toEqual({ kind: "open", path: "/Users/me/paper" });
  });

  it("decodes percent-encoded paths", () => {
    const got = parseDeepLink("obelus://open?path=%2Fhome%2Fme%2Fmy%20paper");
    expect(got).toEqual({ kind: "open", path: "/home/me/my paper" });
  });

  it("returns null for non-obelus schemes", () => {
    expect(parseDeepLink("http://example.com")).toBeNull();
    expect(parseDeepLink("file:///x")).toBeNull();
  });

  it("returns invalid when the action is unknown", () => {
    const got = parseDeepLink("obelus://frobnicate?x=1");
    expect(got).toEqual({ kind: "invalid", reason: "unsupported action: frobnicate" });
  });

  it("returns invalid when path is missing", () => {
    const got = parseDeepLink("obelus://open");
    expect(got).toEqual({ kind: "invalid", reason: "missing path" });
  });

  it("returns null for malformed URLs", () => {
    expect(parseDeepLink("not a url")).toBeNull();
  });
});
