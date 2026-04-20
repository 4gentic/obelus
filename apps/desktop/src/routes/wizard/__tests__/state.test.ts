import { describe, expect, it } from "vitest";
import type { ClaudeStatus } from "../../../ipc/commands";
import { initialWizardState, makeInitialWizardState, wizardReducer } from "../state";

const okClaude: ClaudeStatus = {
  path: "/usr/local/bin/claude",
  version: "1.2.3",
  status: "found",
  floor: "1.0.0",
  ceilExclusive: "2.0.0",
};

describe("wizardReducer", () => {
  it("starts at folio 1 with claude=checking", () => {
    expect(initialWizardState.folio).toBe(1);
    expect(initialWizardState.claude).toBe("checking");
    expect(initialWizardState.desk).toBeUndefined();
    expect(initialWizardState.project).toBeUndefined();
  });

  it("DETECT_RESULT replaces the claude sentinel", () => {
    const next = wizardReducer(initialWizardState, {
      type: "DETECT_RESULT",
      claude: okClaude,
    });
    expect(next.claude).toEqual(okClaude);
    expect(next.folio).toBe(1);
  });

  it("ADVANCE walks 1 → 2 → 3 → done and stops there", () => {
    let s = initialWizardState;
    s = wizardReducer(s, { type: "ADVANCE" });
    expect(s.folio).toBe(2);
    s = wizardReducer(s, { type: "ADVANCE" });
    expect(s.folio).toBe(3);
    s = wizardReducer(s, { type: "ADVANCE" });
    expect(s.folio).toBe("done");
    s = wizardReducer(s, { type: "ADVANCE" });
    expect(s.folio).toBe("done");
  });

  it("BACK from 3 goes to 2, from 2 to 1, stays at 1", () => {
    let s: typeof initialWizardState = { ...initialWizardState, folio: 3 };
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

  it("PICK_FOLDER records kind=folder and label", () => {
    const s = wizardReducer(initialWizardState, {
      type: "PICK_FOLDER",
      root: "/tmp/work",
      label: "work",
    });
    expect(s.project).toEqual({ kind: "folder", root: "/tmp/work", label: "work" });
  });

  it("PICK_FILE records kind=single-pdf", () => {
    const s = wizardReducer(initialWizardState, {
      type: "PICK_FILE",
      root: "/tmp/a.pdf",
      label: "a",
    });
    expect(s.project).toEqual({
      kind: "single-pdf",
      root: "/tmp/a.pdf",
      label: "a",
    });
  });

  it("FINISH jumps to done regardless of current folio", () => {
    const s = wizardReducer({ ...initialWizardState, folio: 2 }, { type: "FINISH" });
    expect(s.folio).toBe("done");
  });

  it("add-mode starts at folio 3 with no desk name set", () => {
    const s = makeInitialWizardState(3);
    expect(s.folio).toBe(3);
    expect(s.desk).toBeUndefined();
  });
});
