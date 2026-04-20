import type { ProjectKind } from "@obelus/repo";
import type { ClaudeStatus } from "../../ipc/commands";

export type WizardFolio = 1 | 2 | 3 | "done";

export interface PickedProject {
  kind: ProjectKind;
  root: string;
  label: string;
}

export interface WizardState {
  folio: WizardFolio;
  claude: ClaudeStatus | "checking";
  desk: string | undefined;
  project: PickedProject | undefined;
}

export type WizardAction =
  | { type: "DETECT_START" }
  | { type: "DETECT_RESULT"; claude: ClaudeStatus }
  | { type: "SET_DESK"; desk: string }
  | { type: "PICK_FOLDER"; root: string; label: string }
  | { type: "PICK_FILE"; root: string; label: string }
  | { type: "PICK_STACK"; root: string; label: string }
  | { type: "ADVANCE" }
  | { type: "BACK" }
  | { type: "FINISH" };

export function makeInitialWizardState(startAt: WizardFolio = 1): WizardState {
  return { folio: startAt, claude: "checking", desk: undefined, project: undefined };
}

export const initialWizardState: WizardState = makeInitialWizardState();

function next(folio: WizardFolio): WizardFolio {
  if (folio === 1) return 2;
  if (folio === 2) return 3;
  if (folio === 3) return "done";
  return "done";
}

function prev(folio: WizardFolio): WizardFolio {
  if (folio === 2) return 1;
  if (folio === 3) return 2;
  return folio;
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "DETECT_START":
      return { ...state, claude: "checking" };
    case "DETECT_RESULT":
      return { ...state, claude: action.claude };
    case "SET_DESK":
      return { ...state, desk: action.desk };
    case "PICK_FOLDER":
      return {
        ...state,
        project: { kind: "folder", root: action.root, label: action.label },
      };
    case "PICK_FILE":
      return {
        ...state,
        project: { kind: "single-pdf", root: action.root, label: action.label },
      };
    case "PICK_STACK":
      return {
        ...state,
        project: { kind: "stack-pdf", root: action.root, label: action.label },
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
