import type { ProjectKind } from "@obelus/repo";

export type WizardFolio = 1 | 2 | 3 | 4 | "done";

export interface PickedProject {
  kind: ProjectKind;
  root: string;
  label: string;
  relPath?: string;
}

export interface WizardState {
  folio: WizardFolio;
  desk: string | undefined;
  project: PickedProject | undefined;
}

export type WizardAction =
  | { type: "SET_DESK"; desk: string }
  | { type: "PICK_FOLDER"; root: string; label: string }
  | { type: "PICK_FILE"; root: string; label: string; relPath: string }
  | { type: "ADVANCE" }
  | { type: "BACK" }
  | { type: "FINISH" };

export function makeInitialWizardState(startAt: WizardFolio = 1): WizardState {
  return { folio: startAt, desk: undefined, project: undefined };
}

export const initialWizardState: WizardState = makeInitialWizardState();

function next(folio: WizardFolio): WizardFolio {
  if (folio === 1) return 2;
  if (folio === 2) return 3;
  if (folio === 3) return 4;
  if (folio === 4) return "done";
  return "done";
}

function prev(folio: WizardFolio): WizardFolio {
  if (folio === 2) return 1;
  if (folio === 3) return 2;
  if (folio === 4) return 3;
  return folio;
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SET_DESK":
      return { ...state, desk: action.desk };
    case "PICK_FOLDER":
      return {
        ...state,
        project: { kind: "writer", root: action.root, label: action.label },
      };
    case "PICK_FILE":
      return {
        ...state,
        project: {
          kind: "reviewer",
          root: action.root,
          label: action.label,
          relPath: action.relPath,
        },
      };
    case "ADVANCE":
      return { ...state, folio: next(state.folio) };
    case "BACK":
      return { ...state, folio: prev(state.folio) };
    case "FINISH":
      return { ...state, folio: "done" };
    default:
      return state;
  }
}
