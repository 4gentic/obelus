import { describe, expect, it } from "vitest";
import { type HtmlMapRow, mapHtmlAnnotations } from "../html";

const PAPER_ID = "11111111-1111-4111-8111-111111111111";
const createdAt = "2026-04-19T12:00:00.000Z";

function pdfRow(id: string): HtmlMapRow {
  return {
    id,
    category: "unclear",
    quote: "q",
    contextBefore: "",
    contextAfter: "",
    anchor: {
      kind: "pdf",
      page: 1,
      bbox: [0, 0, 0, 0],
      textItemRange: { start: [0, 0], end: [0, 0] },
    },
    note: "",
    thread: [],
    createdAt,
  };
}

function sourceRow(id: string, file: string): HtmlMapRow {
  return {
    id,
    category: "unclear",
    quote: "q",
    contextBefore: "",
    contextAfter: "",
    anchor: { kind: "source", file, lineStart: 1, colStart: 0, lineEnd: 1, colEnd: 5 },
    note: "",
    thread: [],
    createdAt,
  };
}

function htmlRow(id: string, file: string, withHint: boolean): HtmlMapRow {
  return {
    id,
    category: "unclear",
    quote: "q",
    contextBefore: "",
    contextAfter: "",
    anchor: {
      kind: "html",
      file,
      xpath: "./article[1]/p[2]",
      charOffsetStart: 0,
      charOffsetEnd: 5,
      ...(withHint
        ? {
            sourceHint: {
              kind: "source",
              file: "sample.md",
              lineStart: 15,
              colStart: 0,
              lineEnd: 15,
              colEnd: 5,
            },
          }
        : {}),
    },
    note: "",
    thread: [],
    createdAt,
  };
}

describe("mapHtmlAnnotations", () => {
  it("drops PDF anchors and reports their ids", () => {
    const rows = [pdfRow("a"), sourceRow("b", "sample.md")];
    const result = mapHtmlAnnotations(rows, PAPER_ID);
    expect(result.droppedForPdfAnchor).toEqual(["a"]);
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0]?.id).toBe("b");
  });

  it("passes source anchors through and tracks firstSourceFile", () => {
    const rows = [sourceRow("a", "sample.md"), sourceRow("b", "other.md")];
    const result = mapHtmlAnnotations(rows, PAPER_ID);
    expect(result.firstSourceFile).toBe("sample.md");
    expect(result.seenKinds).toEqual(new Set(["source"]));
    expect(result.annotations[0]?.anchor.kind).toBe("source");
  });

  it("preserves sourceHint on html anchors when present", () => {
    const rows = [htmlRow("a", "sample.html", true)];
    const result = mapHtmlAnnotations(rows, PAPER_ID);
    const anchor = result.annotations[0]?.anchor;
    expect(anchor?.kind).toBe("html");
    if (anchor?.kind !== "html") throw new Error("expected html anchor");
    expect(anchor.sourceHint).toBeDefined();
    expect(anchor.sourceHint?.file).toBe("sample.md");
  });

  it("omits sourceHint when absent", () => {
    const rows = [htmlRow("a", "sample.html", false)];
    const result = mapHtmlAnnotations(rows, PAPER_ID);
    const anchor = result.annotations[0]?.anchor;
    if (anchor?.kind !== "html") throw new Error("expected html anchor");
    expect(anchor.sourceHint).toBeUndefined();
  });

  it("reports both kinds in seenKinds when rows mix source and html", () => {
    const rows = [sourceRow("a", "x.md"), htmlRow("b", "x.html", false)];
    const result = mapHtmlAnnotations(rows, PAPER_ID);
    expect(result.seenKinds).toEqual(new Set(["source", "html"]));
    expect(result.annotations).toHaveLength(2);
  });

  it("propagates groupId when present", () => {
    const rows = [{ ...sourceRow("a", "x.md"), groupId: "g1" }];
    const result = mapHtmlAnnotations(rows, PAPER_ID);
    expect(result.annotations[0]?.groupId).toBe("g1");
  });

  it("maps html-element rows through unchanged", () => {
    const row: HtmlMapRow = {
      id: "img-1",
      category: "unclear",
      quote: "diagram of pier",
      contextBefore: "",
      contextAfter: "",
      anchor: {
        kind: "html-element",
        file: "diagram.html",
        xpath: "./figure[1]/img[1]",
      },
      note: "",
      thread: [],
      createdAt,
    };
    const result = mapHtmlAnnotations([row], PAPER_ID);
    expect(result.seenKinds).toEqual(new Set(["html-element"]));
    const anchor = result.annotations[0]?.anchor;
    expect(anchor).toEqual({
      kind: "html-element",
      file: "diagram.html",
      xpath: "./figure[1]/img[1]",
    });
  });

  it("preserves sourceHint on html-element rows", () => {
    const row: HtmlMapRow = {
      id: "img-2",
      category: "unclear",
      quote: "alt text",
      contextBefore: "",
      contextAfter: "",
      anchor: {
        kind: "html-element",
        file: "rendered.html",
        xpath: "./p[3]/img[1]",
        sourceHint: {
          kind: "source",
          file: "paper.md",
          lineStart: 22,
          colStart: 0,
          lineEnd: 22,
          colEnd: 0,
        },
      },
      note: "",
      thread: [],
      createdAt,
    };
    const result = mapHtmlAnnotations([row], PAPER_ID);
    const anchor = result.annotations[0]?.anchor;
    if (anchor?.kind !== "html-element") throw new Error("expected html-element anchor");
    expect(anchor.sourceHint?.lineStart).toBe(22);
  });
});
