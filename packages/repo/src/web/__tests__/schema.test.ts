import { beforeEach, describe, expect, it } from "vitest";
import { annotations, papers, revisions, settings } from "../repositories";
import { type AnnotationRow, ObelusDb, setDbForTests } from "../schema";

const hasIdb = typeof indexedDB !== "undefined";

describe.skipIf(!hasIdb)("schema round-trip", () => {
  let db: ObelusDb;

  beforeEach(async () => {
    db = new ObelusDb(`obelus-test-${Math.random().toString(36).slice(2)}`);
    setDbForTests(db);
    await db.open();
  });

  it("persists paper + revision + annotations", async () => {
    const pdfSha = "a".repeat(64);
    const paper = {
      id: crypto.randomUUID(),
      title: "On Citations",
      createdAt: new Date().toISOString(),
      pdfSha256: pdfSha,
    };
    await db.papers.add(paper);
    const revision = {
      id: crypto.randomUUID(),
      paperId: paper.id,
      revisionNumber: 1,
      pdfSha256: pdfSha,
      createdAt: paper.createdAt,
    };
    await db.revisions.add(revision);
    const ann: AnnotationRow = {
      id: crypto.randomUUID(),
      revisionId: revision.id,
      category: "unclear",
      quote: "foo",
      contextBefore: "a",
      contextAfter: "b",
      page: 1,
      bbox: [0, 0, 1, 1],
      textItemRange: { start: [0, 0], end: [0, 3] },
      note: "why?",
      thread: [],
      createdAt: paper.createdAt,
    };
    await annotations.bulkPut(revision.id, [ann]);

    const gotPapers = await papers.list();
    expect(gotPapers).toHaveLength(1);
    expect(gotPapers[0]?.title).toBe("On Citations");

    const gotRevisions = await revisions.listForPaper(paper.id);
    expect(gotRevisions).toHaveLength(1);

    const gotAnns = await annotations.listForRevision(revision.id);
    expect(gotAnns).toHaveLength(1);
    expect(gotAnns[0]?.quote).toBe("foo");
  });

  it("reads and writes settings", async () => {
    await settings.set("flag", true);
    const got = await settings.get<boolean>("flag");
    expect(got).toBe(true);
  });
});
