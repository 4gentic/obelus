CREATE TABLE IF NOT EXISTS paper_edits (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_edit_id TEXT REFERENCES paper_edits(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('baseline', 'ai', 'manual')),
  session_id TEXT REFERENCES review_sessions(id) ON DELETE SET NULL,
  manifest_sha256 TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  note_md TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ('live', 'tombstoned')) DEFAULT 'live',
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS paper_edits_project_ordinal_idx
  ON paper_edits(project_id, ordinal);
CREATE INDEX IF NOT EXISTS paper_edits_parent_idx
  ON paper_edits(parent_edit_id);
CREATE INDEX IF NOT EXISTS paper_edits_project_state_idx
  ON paper_edits(project_id, state, created_at);
CREATE INDEX IF NOT EXISTS paper_edits_session_idx
  ON paper_edits(session_id);
