-- Two changes shipped as one unit:
--
-- 1. `papers.removed_at` — soft-remove flag for the "Reviewing" sidebar.
--    Removing a paper from the list now means hiding it (set removed_at);
--    the row, its revisions, paper_edits chain and review history stay
--    intact so a future time-travel-across-drafts feature can still walk
--    them. The hard-delete path (`papers.remove`) remains for a future
--    Trash view and for `forgetProject`'s cascade.
--
-- 2. `paper_edits.parent_edit_id` cascades on parent delete.
--    Original schema declared it as `ON DELETE RESTRICT`. SQLite checks
--    RESTRICT immediately when the parent row is deleted (not at
--    end-of-statement), so a cascade-delete from `papers` that fans out
--    to multiple `paper_edits` rows linked by parent_edit_id fails with
--    SQLITE_CONSTRAINT_FOREIGNKEY (1811) — the parent edit can't be
--    removed while a child edit still references it, even though the
--    child is being deleted in the same statement. Cascade is the right
--    semantic when the entire chain is being removed: if the paper is
--    gone (hard delete from a future Trash view), its edit history goes
--    with it.
--
-- The two are bundled because the second's table-rebuild needs FKs off,
-- and the first is a trivial column add — no point in two migrations.
--
-- Cannot ALTER an FK in place. Recreate paper_edits (rename → create new
-- → copy → drop old) following the 0002 pattern. Disable FK enforcement
-- for the swap so the rename doesn't trip cross-table references;
-- re-enable + verify after.

ALTER TABLE papers ADD COLUMN removed_at TEXT;

CREATE INDEX papers_removed_at_idx ON papers(removed_at);

PRAGMA foreign_keys = OFF;

CREATE TABLE paper_edits_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  parent_edit_id TEXT REFERENCES paper_edits(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('baseline', 'ai', 'manual')),
  session_id TEXT REFERENCES review_sessions(id) ON DELETE SET NULL,
  manifest_sha256 TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  note_md TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ('live', 'tombstoned')) DEFAULT 'live',
  created_at TEXT NOT NULL
);

INSERT INTO paper_edits_new
  (id, project_id, paper_id, parent_edit_id, ordinal, kind, session_id,
   manifest_sha256, summary, note_md, state, created_at)
SELECT
  id, project_id, paper_id, parent_edit_id, ordinal, kind, session_id,
  manifest_sha256, summary, note_md, state, created_at
FROM paper_edits;

DROP TABLE paper_edits;

ALTER TABLE paper_edits_new RENAME TO paper_edits;

CREATE UNIQUE INDEX paper_edits_paper_ordinal_idx ON paper_edits(paper_id, ordinal);
CREATE INDEX paper_edits_parent_idx ON paper_edits(parent_edit_id);
CREATE INDEX paper_edits_paper_state_idx ON paper_edits(paper_id, state, created_at);
CREATE INDEX paper_edits_session_idx ON paper_edits(session_id);

PRAGMA foreign_keys = ON;
