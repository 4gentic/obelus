-- Holistic diff generation: a single hunk may now satisfy several user marks
-- (when the planner merges overlapping marks into one coherent edit), and an
-- empty patch must declare its reason so the diff-review UI can render the
-- right margin-mark status badge instead of a generic "skipped" placeholder.
--
-- Storage shape change (cannot drop columns in place inside a sqlx migration
-- transaction — see 0001_init.sql header — so we recreate the table):
--   - rename `annotation_id TEXT` → `annotation_ids_json TEXT NOT NULL DEFAULT '[]'`
--     (JSON array of strings; backfill wraps the existing scalar id when present).
--   - add `empty_reason TEXT` with a CHECK guarding the four legal values.
--
-- Pre-release reset is acceptable per CLAUDE.md, so any pending hunks that
-- predate this migration migrate as singleton arrays. New plans the plugin
-- writes after this migration land natively in the new shape.

CREATE TABLE diff_hunks_new (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
  annotation_ids_json TEXT NOT NULL DEFAULT '[]',
  file TEXT NOT NULL,
  category TEXT,
  patch TEXT NOT NULL,
  modified_patch_text TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'accepted', 'rejected', 'modified')) DEFAULT 'pending',
  ambiguous INTEGER NOT NULL DEFAULT 0,
  empty_reason TEXT
    CHECK (empty_reason IS NULL
           OR empty_reason IN ('praise', 'ambiguous', 'structural-note', 'no-edit-requested')),
  note_text TEXT NOT NULL DEFAULT '',
  ordinal INTEGER NOT NULL DEFAULT 0,
  apply_failure_json TEXT
);

INSERT INTO diff_hunks_new
  (id, session_id, annotation_ids_json, file, category, patch,
   modified_patch_text, state, ambiguous, empty_reason, note_text, ordinal,
   apply_failure_json)
SELECT
  id,
  session_id,
  CASE
    WHEN annotation_id IS NULL THEN '[]'
    ELSE JSON_ARRAY(annotation_id)
  END,
  file,
  category,
  patch,
  modified_patch_text,
  state,
  ambiguous,
  -- Backfill empty_reason for legacy rows so the new schema's invariants hold.
  -- Legacy rows had no reason field; we infer the most accurate label so the
  -- UI doesn't have to special-case nulls. Ambiguous rows get the explicit
  -- 'ambiguous' label; remaining empty patches get 'no-edit-requested' as the
  -- safest fallback (it renders neutrally in the gutter).
  CASE
    WHEN patch = '' AND ambiguous = 1 THEN 'ambiguous'
    WHEN patch = '' THEN 'no-edit-requested'
    ELSE NULL
  END,
  note_text,
  ordinal,
  apply_failure_json
FROM diff_hunks;

DROP TABLE diff_hunks;

ALTER TABLE diff_hunks_new RENAME TO diff_hunks;

CREATE INDEX diff_hunks_session_idx ON diff_hunks(session_id);
CREATE INDEX diff_hunks_session_ordinal_idx ON diff_hunks(session_id, ordinal);
