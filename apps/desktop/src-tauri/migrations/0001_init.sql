CREATE TABLE IF NOT EXISTS desks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  last_opened_at TEXT,
  created_at TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('writer', 'reviewer')),
  root TEXT NOT NULL UNIQUE,
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  last_opened_at TEXT,
  last_opened_file_rel_path TEXT,
  desk_id TEXT REFERENCES desks(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS projects_desk_idx ON projects(desk_id);

CREATE TABLE IF NOT EXISTS papers (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  entrypoint_rel_path TEXT,
  pdf_rel_path TEXT,
  pdf_sha256 TEXT,
  page_count INTEGER,
  rubric_body TEXT,
  rubric_source TEXT,
  rubric_label TEXT,
  rubric_updated_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS papers_project_idx ON papers(project_id);

CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  pdf_sha256 TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS revisions_paper_idx ON revisions(paper_id);

CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  quote TEXT NOT NULL,
  context_before TEXT NOT NULL DEFAULT '',
  context_after TEXT NOT NULL DEFAULT '',
  anchor_kind TEXT NOT NULL CHECK (anchor_kind IN ('pdf', 'source', 'html')),
  anchor_json TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  thread_json TEXT NOT NULL DEFAULT '[]',
  group_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS annotations_revision_idx ON annotations(revision_id);

CREATE TABLE IF NOT EXISTS review_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  bundle_id TEXT NOT NULL,
  claude_version TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  applied_at TEXT
);

CREATE INDEX IF NOT EXISTS review_sessions_project_idx ON review_sessions(project_id);

CREATE TABLE IF NOT EXISTS diff_hunks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
  annotation_id TEXT,
  file TEXT NOT NULL,
  category TEXT,
  patch TEXT NOT NULL,
  modified_patch_text TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'accepted', 'rejected', 'modified')) DEFAULT 'pending',
  ambiguous INTEGER NOT NULL DEFAULT 0,
  note_text TEXT NOT NULL DEFAULT '',
  ordinal INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS diff_hunks_session_idx ON diff_hunks(session_id);
CREATE INDEX IF NOT EXISTS diff_hunks_session_ordinal_idx ON diff_hunks(session_id, ordinal);

CREATE TABLE IF NOT EXISTS ask_threads (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  paper_id TEXT REFERENCES papers(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ask_threads_project_paper_idx
  ON ask_threads(project_id, IFNULL(paper_id, ''));

CREATE TABLE IF NOT EXISTS ask_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES ask_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cancelled INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ask_messages_thread_idx
  ON ask_messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS writeups (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  body_md TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, paper_id)
);

CREATE INDEX IF NOT EXISTS writeups_project_idx ON writeups(project_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
