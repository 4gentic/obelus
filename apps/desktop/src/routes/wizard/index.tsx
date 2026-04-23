import { useEffect, useMemo, useReducer, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { readClaudeStatus } from "../../boot/detect";
import { getRepository } from "../../lib/repo";
import { getAppState, setAppState } from "../../store/app-state";
import FolioDesk from "./folio-desk";
import FolioEngines from "./folio-engines";
import FolioMachinist from "./folio-machinist";
import FolioProject from "./folio-project";
import FolioRenderHint from "./folio-render-hint";
import { makeInitialWizardState, wizardReducer } from "./state";
import "./wizard.css";

import type { JSX } from "react";
export default function Wizard(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const addMode = searchParams.get("add") === "1";
  const initial = useMemo(() => makeInitialWizardState(addMode ? 4 : 1), [addMode]);
  const [state, dispatch] = useReducer(wizardReducer, initial);
  const loaded = useRef(false);

  // Restore prior folio, start claude detection.
  // In add-mode we skip straight to folio 3 and don't re-run detect —
  // the user already passed the one-time gates on their first visit.
  useEffect(() => {
    if (addMode) {
      loaded.current = true;
      return;
    }
    let cancelled = false;
    void (async () => {
      const saved = await getAppState("wizard");
      if (!cancelled && saved && saved.folio !== "done") {
        // Resume at the saved folio by replaying ADVANCE until we reach it.
        const steps = typeof saved.folio === "number" ? saved.folio - 1 : 0;
        for (let i = 0; i < steps; i++) dispatch({ type: "ADVANCE" });
      }
      loaded.current = true;
      const status = await readClaudeStatus();
      if (!cancelled) dispatch({ type: "DETECT_RESULT", claude: status });
    })();
    return () => {
      cancelled = true;
    };
  }, [addMode]);

  // Persist folio on each transition. In add-mode we leave the saved
  // "done" checkpoint intact so re-entry doesn't resume mid-add.
  useEffect(() => {
    if (!loaded.current) return;
    if (addMode) return;
    if (state.folio === "done") return;
    void setAppState("wizard", { folio: state.folio, seenOnce: true });
  }, [state.folio, addMode]);

  // On finish: on first run, create the user's first desk from state.desk (or
  // a sensible default) and bind the project to it; in add-mode, bind the
  // project to the current desk read from app-state. If the user re-ran the
  // wizard after a plain "Reset wizard" and picked the same folder, the root
  // is already registered — reuse that row instead of tripping the UNIQUE
  // constraint.
  useEffect(() => {
    if (state.folio !== "done") return;
    if (!state.project) return;
    const picked = state.project;
    const wizardDeskName = state.desk;
    void (async () => {
      const repo = await getRepository();
      const existing = (await repo.projects.list()).find((p) => p.root === picked.root);
      if (existing) {
        await repo.projects.touchLastOpened(existing.id);
      } else {
        // `currentDeskId` lives in app-state.json and can drift out of sync with
        // the SQLite desks table (partial wipe, manual DB edit, migration reset).
        // Verify the row still exists before reusing the id; otherwise the next
        // INSERT into projects trips the desk_id FK.
        let deskId = await getAppState("currentDeskId");
        if (deskId && !(await repo.desks.get(deskId))) {
          deskId = undefined;
        }
        if (!deskId) {
          const name = (wizardDeskName ?? "").trim() || "Desk";
          const existingDesks = await repo.desks.list();
          const desk = existingDesks[0] ?? (await repo.desks.create({ name }));
          deskId = desk.id;
          await setAppState("currentDeskId", deskId);
        }
        await repo.projects.create({
          label: picked.label,
          kind: picked.kind,
          root: picked.root,
          deskId,
        });
      }
      await setAppState("wizard", { folio: "done", seenOnce: true });
      navigate("/home", { replace: true });
    })();
  }, [state.folio, state.project, state.desk, navigate]);

  return (
    <section className="wizard" aria-live="polite">
      <div className="wizard__book">
        {state.folio === 1 ? (
          <FolioMachinist
            claude={state.claude}
            onRecheck={async () => {
              dispatch({ type: "DETECT_START" });
              const next = await readClaudeStatus(true);
              dispatch({ type: "DETECT_RESULT", claude: next });
            }}
            onAdvance={() => dispatch({ type: "ADVANCE" })}
          />
        ) : null}
        {state.folio === 2 ? (
          <FolioEngines
            onAdvance={() => dispatch({ type: "ADVANCE" })}
            onBack={() => dispatch({ type: "BACK" })}
          />
        ) : null}
        {state.folio === 3 ? (
          <FolioDesk
            desk={state.desk ?? ""}
            onChange={(desk) => dispatch({ type: "SET_DESK", desk })}
            onAdvance={() => dispatch({ type: "ADVANCE" })}
            onBack={() => dispatch({ type: "BACK" })}
          />
        ) : null}
        {state.folio === 4 ? (
          state.project && state.project.kind === "writer" ? (
            <FolioRenderHint
              label={state.project.label}
              firstProject={!addMode}
              onFinish={() => dispatch({ type: "FINISH" })}
            />
          ) : (
            <FolioProject
              firstProject={!addMode}
              onPickFolder={(root, label) => {
                dispatch({ type: "PICK_FOLDER", root, label });
              }}
              onPickFile={(root, label) => {
                dispatch({ type: "PICK_FILE", root, label });
                dispatch({ type: "FINISH" });
              }}
              onBack={
                addMode
                  ? () => navigate("/home", { replace: true })
                  : () => dispatch({ type: "BACK" })
              }
            />
          )
        ) : null}
      </div>
    </section>
  );
}
