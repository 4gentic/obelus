import type { EditorView } from "@codemirror/view";

// Exactly one source editor mounts at a time (CenterPane dispatches a single
// SourcePane). We keep a module-level ref so ProjectShell's global Cmd+F
// handler can reach the active view without plumbing state through providers.
let active: EditorView | null = null;

export function setActiveSourceView(view: EditorView | null): void {
  active = view;
}

export function getActiveSourceView(): EditorView | null {
  return active;
}
