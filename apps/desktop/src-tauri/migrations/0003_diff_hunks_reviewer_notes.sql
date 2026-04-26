-- Add reviewer_notes column to diff_hunks. The planner's PlanBlock carries a
-- `reviewerNotes` prose string explaining each block (especially relevant for
-- empty-patch blocks where there is no diff to read — praise, ambiguous,
-- impact). Until now the desktop ingested the plan and dropped this field on
-- the floor; the column lets the Diff tab surface it as a non-actionable
-- informational card.
--
-- Additive ALTER with a default; existing rows survive intact and read back
-- as ''. Pre-existing sessions show no informational content until they're
-- re-reviewed, which matches the pre-release reset posture.

ALTER TABLE diff_hunks ADD COLUMN reviewer_notes TEXT NOT NULL DEFAULT '';
