import { describe, expect, it } from "vitest";
import { initialWizardState, makeInitialWizardState, wizardReducer } from "../state";

describe("wizardReducer", () => {
  it("starts at folio 1 with desk and project unset", () => {
    expect(initialWizardState.folio).toBe(1);
    expect(initialWizardState.desk).toBeUndefined();
    expect(initialWizardState.project).toBeUndefined();
  });

  it("ADVANCE walks 1 → 2 → 3 → 4 → done and stops there", () => {
    let s = initialWizardState;
    s = wizardReducer(s, { type: "ADVANCE" });
    expect(s.folio).toBe(2);
    s = wizardReducer(s, { type: "ADVANCE" });
    expect(s.folio).toBe(3);
    s = wizardReducer(s, { type: "ADVANCE" });
    expect(s.folio).toBe(4);
    s = wizardReducer(s, { type: "ADVANCE" });
    expect(s.folio).toBe("done");
    s = wizardReducer(s, { type: "ADVANCE" });
    expect(s.folio).toBe("done");
  });

  it("BACK walks 4 → 3 → 2 → 1, stays at 1", () => {
    let s: typeof initialWizardState = { ...initialWizardState, folio: 4 };
    s = wizardReducer(s, { type: "BACK" });
    expect(s.folio).toBe(3);
    s = wizardReducer(s, { type: "BACK" });
    expect(s.folio).toBe(2);
    s = wizardReducer(s, { type: "BACK" });
    expect(s.folio).toBe(1);
    s = wizardReducer(s, { type: "BACK" });
    expect(s.folio).toBe(1);
  });

  it("SET_DESK stores desk, leaves folio untouched", () => {
    const s = wizardReducer(initialWizardState, {
      type: "SET_DESK",
      desk: "Eastern light",
    });
    expect(s.desk).toBe("Eastern light");
    expect(s.folio).toBe(1);
  });

  it("PICK_FOLDER records kind=writer and label", () => {
    const s = wizardReducer(initialWizardState, {
      type: "PICK_FOLDER",
      root: "/tmp/work",
      label: "work",
    });
    expect(s.project).toEqual({ kind: "writer", root: "/tmp/work", label: "work" });
  });

  it("PICK_FILE records kind=reviewer with the picked file's relative path", () => {
    const s = wizardReducer(initialWizardState, {
      type: "PICK_FILE",
      root: "/tmp",
      label: "a",
      relPath: "a.md",
    });
    expect(s.project).toEqual({
      kind: "reviewer",
      root: "/tmp",
      label: "a",
      relPath: "a.md",
    });
  });

  it("FINISH jumps to done regardless of current folio", () => {
    const s = wizardReducer({ ...initialWizardState, folio: 2 }, { type: "FINISH" });
    expect(s.folio).toBe("done");
  });

  it("add-mode starts at folio 4 with no desk name set", () => {
    const s = makeInitialWizardState(4);
    expect(s.folio).toBe(4);
    expect(s.desk).toBeUndefined();
  });
});
