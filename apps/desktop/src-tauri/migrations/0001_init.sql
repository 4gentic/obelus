-- Obelus desktop: canonical schema.
--
-- Kept as a single init migration (pre-release). When shape needs to change
-- post-release, add 0002_*.sql etc. — never edit a shipped migration.
--
-- All FKs are declared inline so sqlx's default foreign_keys=ON enforces them.
-- We do not rely on ALTER TABLE RENAME for schema evolution because, inside
-- sqlx's migration transaction, SQLite rewrites FK references in other tables
-- to the transient `_old` name and `PRAGMA legacy_alter_table` is a no-op at
-- transaction scope.

CREATE TABLE desks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  last_opened_at TEXT,
  created_at TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE projects (
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

CREATE INDEX projects_desk_idx ON projects(desk_id);

CREATE TABLE papers (
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

CREATE INDEX papers_project_idx ON papers(project_id);

CREATE TABLE revisions (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  pdf_sha256 TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX revisions_paper_idx ON revisions(paper_id);

CREATE TABLE review_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  bundle_id TEXT NOT NULL,
  model TEXT,
  effort TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  applied_at TEXT
);

CREATE INDEX review_sessions_project_idx ON review_sessions(project_id);
CREATE INDEX review_sessions_paper_idx ON review_sessions(paper_id);

CREATE TABLE paper_edits (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
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

CREATE UNIQUE INDEX paper_edits_paper_ordinal_idx ON paper_edits(paper_id, ordinal);
CREATE INDEX paper_edits_parent_idx ON paper_edits(parent_edit_id);
CREATE INDEX paper_edits_paper_state_idx ON paper_edits(paper_id, state, created_at);
CREATE INDEX paper_edits_session_idx ON paper_edits(session_id);

CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  quote TEXT NOT NULL,
  context_before TEXT NOT NULL DEFAULT '',
  context_after TEXT NOT NULL DEFAULT '',
  anchor_json TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  thread_json TEXT NOT NULL DEFAULT '[]',
  group_id TEXT,
  created_at TEXT NOT NULL,
  resolved_in_edit_id TEXT REFERENCES paper_edits(id) ON DELETE SET NULL
);

CREATE INDEX annotations_revision_idx ON annotations(revision_id);
CREATE INDEX annotations_resolved_in_idx ON annotations(resolved_in_edit_id);

CREATE TABLE diff_hunks (
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

CREATE INDEX diff_hunks_session_idx ON diff_hunks(session_id);
CREATE INDEX diff_hunks_session_ordinal_idx ON diff_hunks(session_id, ordinal);

CREATE TABLE ask_threads (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  paper_id TEXT REFERENCES papers(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX ask_threads_project_paper_idx
  ON ask_threads(project_id, IFNULL(paper_id, ''));

CREATE TABLE ask_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES ask_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cancelled INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX ask_messages_thread_idx ON ask_messages(thread_id, created_at);

CREATE TABLE writeups (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  body_md TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, paper_id)
);

CREATE INDEX writeups_project_idx ON writeups(project_id);

CREATE TABLE file_pins (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rel_path   TEXT NOT NULL,
  pinned_at  TEXT NOT NULL,
  PRIMARY KEY (project_id, rel_path)
);

CREATE INDEX file_pins_project_idx ON file_pins(project_id, pinned_at DESC);

CREATE TABLE project_files (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN (
    'tex', 'md', 'typ', 'bib', 'cls', 'sty', 'bst', 'pdf', 'yml', 'json', 'txt', 'other'
  )),
  role TEXT CHECK (role IN ('main', 'include', 'bib', 'asset')),
  size INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  scanned_at TEXT NOT NULL,
  PRIMARY KEY (project_id, rel_path)
);

CREATE INDEX project_files_format_idx ON project_files(project_id, format);

CREATE TABLE paper_build (
  paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  format TEXT CHECK (format IN ('tex', 'md', 'typ')),
  main_rel_path TEXT,
  main_is_pinned INTEGER NOT NULL DEFAULT 0,
  compiler TEXT CHECK (compiler IN ('typst', 'latexmk', 'pandoc', 'xelatex', 'pdflatex')),
  compiler_args_json TEXT NOT NULL DEFAULT '[]',
  output_rel_dir TEXT,
  scanned_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
