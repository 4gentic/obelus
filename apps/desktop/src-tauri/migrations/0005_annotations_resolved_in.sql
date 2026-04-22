ALTER TABLE annotations
  ADD COLUMN resolved_in_edit_id TEXT REFERENCES paper_edits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS annotations_resolved_in_idx
  ON annotations(resolved_in_edit_id);
