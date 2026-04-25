-- Annotation anchor-drift state.
--
-- Populated by the writer-mode re-verify-on-save path and the external-change
-- watcher. Unset means "never verified" — the UI treats that the same as
-- 'ok' until the first verification lands. Loose CHECK so additional reasons
-- (e.g. 'file-missing' for the HTML surface in Phase 2) can ship without a
-- table rebuild.

ALTER TABLE annotations
  ADD COLUMN staleness TEXT
    CHECK (staleness IS NULL OR staleness IN ('ok', 'line-out-of-range', 'quote-mismatch'));
