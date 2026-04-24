-- Paper review-surface format.
--
-- Distinguishes how the reviewer sees the paper in the web app:
--   'pdf' — rendered PDF (pdfjs text layer + bbox anchoring)
--   'md'  — rendered markdown (DOM + source-line anchoring)
--
-- Distinct from `paper_build.format` (which tracks the source language of a
-- writer-project paper for compilation purposes). A writer-project paper can
-- be compiled from 'md' *and* reviewed as 'pdf' simultaneously.

ALTER TABLE papers
  ADD COLUMN format TEXT NOT NULL
    DEFAULT 'pdf'
    CHECK (format IN ('pdf', 'md'));
