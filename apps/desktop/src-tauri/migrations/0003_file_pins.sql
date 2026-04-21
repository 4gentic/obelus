CREATE TABLE IF NOT EXISTS file_pins (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rel_path   TEXT NOT NULL,
  pinned_at  TEXT NOT NULL,
  PRIMARY KEY (project_id, rel_path)
);
CREATE INDEX IF NOT EXISTS file_pins_project_idx ON file_pins(project_id, pinned_at DESC);
