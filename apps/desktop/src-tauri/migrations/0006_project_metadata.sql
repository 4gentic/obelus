CREATE TABLE IF NOT EXISTS project_files (
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

CREATE INDEX IF NOT EXISTS project_files_format_idx
  ON project_files(project_id, format);

CREATE TABLE IF NOT EXISTS project_build (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  format TEXT CHECK (format IN ('tex', 'md', 'typ')),
  main_rel_path TEXT,
  main_is_pinned INTEGER NOT NULL DEFAULT 0,
  compiler TEXT CHECK (compiler IN ('typst', 'latexmk', 'pandoc', 'xelatex', 'pdflatex')),
  compiler_args_json TEXT NOT NULL DEFAULT '[]',
  output_rel_dir TEXT,
  scanned_at TEXT,
  updated_at TEXT NOT NULL
);
