# @obelus/repo

**What.** The storage boundary: interfaces for every row type Obelus persists (papers, revisions, annotations, ask threads, diff hunks, review sessions, write-ups, settings) and the two implementations — one over Dexie/OPFS for the web, one over Tauri IPC for the desktop.

**Why.** Two runtimes, one contract. The UI and the review store speak only to `Repository`; the implementation decides whether rows live in IndexedDB or in a SQLite file on disk. Swapping runtimes does not ripple into callers.

**Boundary.** This package defines row types and repository interfaces and provides the web implementation. It does not call pdf.js, does not build bundles, and does not persist bytes outside of OPFS on the web side. `navigator.storage.persist()` is requested on first write.

**Public API.**
- `Repository`, `RepositoryFeature`, `NotSupportedError` — the repository contract and feature-probe primitives.
- Per-aggregate interfaces: `PapersRepo`, `RevisionsRepo`, `AnnotationsRepo`, `AskThreadsRepo`, `DiffHunksRepo`, `ReviewSessionsRepo`, `WriteUpsRepo`, `SettingsRepo`, `ProjectsRepo`.
- Input types: `PaperCreateInput`, `RevisionCreateInput`, `ReviewSessionCreateInput`, `ProjectCreateInput`, `AskMessageAppendInput`.
- Row types: `PaperRow`, `RevisionRow`, `AnnotationRow`, `AskThreadRow`, `AskMessageRow`, `DiffHunkRow`, `ReviewSessionRow`, `ProjectRow`, `WriteUpRow`, `SettingRow`, plus literal enums (`ProjectKind`, `AskMessageRole`, `DiffHunkState`).
