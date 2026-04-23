-- Adds a nullable JSON column that carries the reason a hunk failed to apply
-- cleanly, so the UI can surface per-hunk failures from a partial apply and
-- keep them visible across refreshes until the user discards or repasses.
--
-- Shape: `{ "reason": string, "attemptedAt": ISO-8601 string }`.

ALTER TABLE diff_hunks ADD COLUMN apply_failure_json TEXT;
