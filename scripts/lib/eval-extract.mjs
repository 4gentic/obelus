// Extraction for the review-quality eval (scripts/eval-review-quality.mjs).
//
// Turns a plan-fix output (`plan-<iso>.json`) into the rows the LLM judge
// scores: one extracted record per substantive block, each joined to the
// bundle marks it claims to satisfy and to the source span its patch touches,
// plus the mechanical plan-level givens (coverage). This is a BOUNDARY — a
// plan the engine wrote becomes internal rows here — so it logs once,
// structured, before returning, and never `.filter()`s a row away silently:
// dropped ids are accumulated and surfaced, per CLAUDE.md's tracing rule.
//
// Pure and dependency-light (the plan is parsed via the reused PlanFileSchema
// by the caller; this module operates on the already-parsed `PlanFile`), so the
// dry self-test can exercise it without an engine or a judge.

// Synthesised-block id prefixes the planner emits on top of user marks. The
// first element of a block's `annotationIds` carries the synthesised id, which
// downstream code keys on by prefix (mirrors claude-sidecar/src/plan.ts).
const SYNTH_PREFIXES = ["cascade-", "impact-", "coherence-", "quality-", "directive-", "compile-"];

// Categories that demand an editorial answer — a substantive mark the planner
// is expected to cover with a block (`praise` and `note` do not demand edits;
// the plan-fix skill treats them as no-edit / optional). Used to compute the
// substantive-mark set for P1 coverage. Aligned with the plan-fix Edit-shape
// rules.
export const SUBSTANTIVE_CATEGORIES = [
  "remove",
  "elaborate",
  "rephrase",
  "improve",
  "wrong",
  "weak-argument",
];

// True iff the block is synthesised (cascade/impact/coherence/directive/
// compile) rather than a user-mark edit. Keys on the first annotation id.
export function blockKindOf(firstId) {
  for (const p of SYNTH_PREFIXES) {
    if (firstId.startsWith(p)) return p.slice(0, -1); // strip trailing dash
  }
  return "user-mark";
}

// A block is substantive-to-judge when it carries a real edit (non-empty
// patch) OR is a flag-note the judge should still read (impact/coherence carry
// patch:"" but matter for P2/P3 plan dims — those are judged at plan level, not
// per-block). For per-block B1–B6 scoring we judge only blocks with a patch the
// reviewer must stand behind: user-mark edits, cascades, and directives.
export function isScorableBlock(block) {
  if (block.ambiguous) return false;
  if (block.emptyReason !== null) return false;
  return block.patch !== "";
}

// Index a bundle's annotations by id for the join. Returns a Map id → mark
// (the raw annotation object).
export function indexMarks(bundle) {
  const byId = new Map();
  for (const a of bundle.annotations) byId.set(a.id, a);
  return byId;
}

// The substantive marks (by id) the plan is expected to cover: bundle marks
// whose category demands an edit. `praise` / `note` excluded. Returned as a
// Set so P1 coverage is a set-difference, not a recount.
export function substantiveMarkIds(bundle) {
  const ids = new Set();
  for (const a of bundle.annotations) {
    if (SUBSTANTIVE_CATEGORIES.includes(a.category)) ids.add(a.id);
  }
  return ids;
}

// Reconstruct the source span a patch touches by matching its context and
// `-`-before lines against the staged fixture source. The unified-diff hunk
// header (`@@ -L,N +L,N @@`) is advisory — the desktop recomputes it on apply —
// so we anchor on the literal content of the first context-or-deletion line.
// Returns { lineStart, lineEnd } (1-based, inclusive) or null when no anchor
// line matches the source (a hallucinated patch, or a file mismatch). We DO NOT
// throw on a miss: a null span is a fact the judge prompt surfaces.
export function reconstructSpan(patch, sourceText) {
  const sourceLines = sourceText.split("\n");
  const anchors = anchorLinesOf(patch);
  if (anchors.length === 0) return null;

  // Find the first source line index where the anchor run matches in order,
  // allowing intervening source lines to be skipped only between non-adjacent
  // anchors is overkill — patches are single-hunk and contiguous, so require a
  // contiguous match of the anchor run.
  for (let i = 0; i <= sourceLines.length - anchors.length; i += 1) {
    let ok = true;
    for (let j = 0; j < anchors.length; j += 1) {
      if ((sourceLines[i + j] ?? "") !== anchors[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return { lineStart: i + 1, lineEnd: i + anchors.length };
  }
  // Fall back to a single-line anchor: the longest anchor line, matched
  // anywhere (handles a patch whose context lines were lightly reflowed but
  // whose deletion line is verbatim — the plan-fix contract requires verbatim
  // `-` lines).
  const longest = [...anchors].sort((a, b) => b.length - a.length)[0] ?? "";
  if (longest.length > 0) {
    const idx = sourceLines.indexOf(longest);
    if (idx >= 0) return { lineStart: idx + 1, lineEnd: idx + 1 };
  }
  return null;
}

// The lines a patch expects to find in the current source: context lines
// (leading space) and deletion lines (leading `-`), in hunk order, with the
// diff marker stripped. Added lines (`+`) and the `@@` header are skipped — they
// are not present in the pre-edit source.
function anchorLinesOf(patch) {
  const out = [];
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) continue;
    if (raw.startsWith("+")) continue;
    if (raw.startsWith("-")) {
      out.push(raw.slice(1));
      continue;
    }
    if (raw.startsWith(" ")) {
      out.push(raw.slice(1));
    }
    // A bare empty string between hunk lines (final trailing newline split) —
    // drop it; it is not a source anchor.
  }
  // Trim a trailing empty anchor that the final `\n` split introduces.
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

// Build the full extraction for one plan against one bundle + staged source.
// Returns:
//   {
//     blocks: [{ annotationIds, category, blockKind, patch, reviewerNotes,
//                span, marks: [{id, category, quote, note}], spanResolved }],
//     coverage: { substantive: [ids], covered: [ids], dropped: [ids],
//                 coveredCount, substantiveCount },
//     planMeta: { format, entrypoint, blockCount, scorableCount },
//     droppedJoins: [ids]   // annotation ids referenced by a block but absent
//                           // from the bundle (a join miss — surfaced, not hidden)
//   }
// Logs one structured `[eval-extract]` line before returning.
export function extractPlan({ plan, bundle, sourceText, sourceByFile }) {
  const marksById = indexMarks(bundle);
  const substantive = substantiveMarkIds(bundle);
  const covered = new Set();
  const droppedJoins = [];

  const blocks = [];
  for (const block of plan.blocks) {
    const firstId = block.annotationIds[0] ?? "";
    const blockKind = blockKindOf(firstId);

    // Join annotationIds → bundle marks (user-mark blocks only carry real ids;
    // synthesised blocks carry a singleton synthetic id with no bundle mark).
    const marks = [];
    for (const id of block.annotationIds) {
      const mark = marksById.get(id);
      if (mark) {
        marks.push({
          id: mark.id,
          category: mark.category,
          quote: mark.quote,
          note: mark.note,
        });
        if (substantive.has(id)) covered.add(id);
      } else if (blockKind === "user-mark") {
        // A user-mark block referencing an id absent from the bundle is a join
        // miss — record it; do not silently drop.
        droppedJoins.push(id);
      }
    }

    // Reconstruct the span only for scorable (patched) blocks. The source to
    // match against is the block's own file when a per-file map is provided
    // (multi-file bundles), else the single staged entrypoint source.
    let span = null;
    let spanResolved = false;
    if (isScorableBlock(block)) {
      const text = (block.file && sourceByFile?.get(block.file)) || sourceText || "";
      span = reconstructSpan(block.patch, text);
      spanResolved = span !== null;
    }

    blocks.push({
      annotationIds: block.annotationIds,
      category: block.category,
      blockKind,
      file: block.file,
      patch: block.patch,
      reviewerNotes: block.reviewerNotes,
      ambiguous: block.ambiguous,
      emptyReason: block.emptyReason,
      span,
      spanResolved,
      marks,
    });
  }

  const dropped = [...substantive].filter((id) => !covered.has(id));
  const scorableCount = blocks.filter((b) => isScorableBlock(b)).length;

  const result = {
    blocks,
    coverage: {
      substantive: [...substantive],
      covered: [...covered],
      dropped,
      coveredCount: covered.size,
      substantiveCount: substantive.size,
    },
    planMeta: {
      format: plan.format,
      entrypoint: plan.entrypoint,
      blockCount: plan.blocks.length,
      scorableCount,
    },
    droppedJoins,
  };

  // Boundary log — once, structured, before returning. Dropped ids by name.
  console.info("[eval-extract]", {
    blockCount: plan.blocks.length,
    scorableCount,
    substantiveMarks: substantive.size,
    coveredMarks: covered.size,
    coverageDropped: dropped,
    droppedJoins,
    spanMisses: blocks.filter((b) => isScorableBlock(b) && !b.spanResolved).length,
  });

  return result;
}

// Map the mechanical coverage fraction to the P1 anchored level (0–3). Fed to
// the judge as a given so it does NOT recount — the judge only reads this
// number, per the brief. Rule: full coverage of substantive marks → 3; a
// single uncovered substantive mark → at most 2; half or more uncovered → 1;
// nothing covered when something was demanded → 0. When there are no
// substantive marks at all (praise-only bundle), coverage is vacuously perfect.
export function coverageLevel({ substantiveCount, coveredCount }) {
  if (substantiveCount === 0) return 3;
  const missed = substantiveCount - coveredCount;
  if (missed <= 0) return 3;
  const missFrac = missed / substantiveCount;
  if (coveredCount === 0) return 0;
  if (missFrac >= 0.5) return 1;
  return 2;
}
