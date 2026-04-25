-- Widen papers.format CHECK to include 'html'.
--
-- Phase 2 of the multi-format review surface: HTML papers are reviewed in a
-- shadow-DOM pane (sanitized with DOMPurify), with anchors emitted as either
-- SourceAnchor (when the HTML carries data-src-* markers from a paired source)
-- or HtmlAnchor (XPath + char offsets, for hand-authored HTML).
--
-- The papers table is referenced by FK-bearing tables (revisions,
-- review_sessions, paper_edits, ask_threads, writeups). The init migration
-- (0001_init.sql) warns that the ALTER TABLE RENAME → recreate → drop pattern
-- breaks those FKs inside sqlx's migration transaction. CLAUDE.md sanctions
-- PRAGMA writable_schema for in-place CHECK changes; widening is safe because
-- every pre-existing 'pdf'/'md' row still satisfies the new constraint.
--
-- The replace() target matches 0004_paper_format.sql verbatim. Shipped
-- migrations are never edited (CLAUDE.md), so the substring is stable.

PRAGMA writable_schema = ON;

UPDATE sqlite_master
SET sql = replace(
  sql,
  'CHECK (format IN (''pdf'', ''md''))',
  'CHECK (format IN (''pdf'', ''md'', ''html''))'
)
WHERE type = 'table' AND name = 'papers';

PRAGMA writable_schema = OFF;
