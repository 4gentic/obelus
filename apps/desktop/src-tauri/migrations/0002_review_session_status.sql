-- Persist review lifecycle so writer-mode survives a refresh: status (one
-- of 'running' | 'ingesting' | 'completed' | 'failed' | 'discarded'),
-- last_error (why a failed/discarded run ended that way), apply_status_json
-- (the post-apply banner snapshot), and claude_session_id (so a mount-time
-- reattach can find the still-running subprocess by id).
--
-- No CHECK on status: the Zod schema in @obelus/repo guards the boundary,
-- and the table-recreate dance that would let us add a CHECK is blocked by
-- sqlx's migration transaction rewriting FKs from diff_hunks and paper_edits
-- to a transient `_old` name (see 0001_init.sql header).

ALTER TABLE review_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE review_sessions ADD COLUMN last_error TEXT;
ALTER TABLE review_sessions ADD COLUMN apply_status_json TEXT;
ALTER TABLE review_sessions ADD COLUMN claude_session_id TEXT;

-- Rows started before this migration that never reached completed_at are
-- orphaned (the app crashed mid-flight), not "completed". Mark them so the
-- writer-mode reattach surfaces a clean "previous run did not complete".
UPDATE review_sessions SET status = 'failed' WHERE completed_at IS NULL;

CREATE INDEX review_sessions_paper_status_idx ON review_sessions(paper_id, status);
