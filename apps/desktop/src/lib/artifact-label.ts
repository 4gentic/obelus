// Recognises Obelus-minted artifact filenames (review bundles, plans,
// write-ups, rubrics) and returns a human label that preserves the kind of
// artifact and the time-of-day it was produced. Anything else falls through
// to the bare basename — those names already mean something to the reader.
//
// Filename contracts:
//   bundle-YYYYMMDD-HHMMSS.json                     (build-bundle.ts)
//   plan-YYYYMMDD-HHMMSS.json   |  plan.json        (claude-sidecar/plan.ts)
//   plan-YYYYMMDD-HHMMSS.md                         (apply-revision skill, human-readable companion)
//   writeup-<paperId>-YYYYMMDD-HHMMSS.md   |  writeup-<paperId>.md
//   rubric-YYYYMMDD-HHMMSS.json                     (defensive)

const STAMPED_RE = /^(bundle|plan|rubric)-\d{8}-(\d{2})(\d{2})\d{2}\.json$/;
const PLAN_MD_RE = /^plan-\d{8}-(\d{2})(\d{2})\d{2}\.md$/;
const WRITEUP_STAMPED_RE = /^writeup-.+-\d{8}-(\d{2})(\d{2})\d{2}\.md$/;
const WRITEUP_BARE_RE = /^writeup-.+\.md$/;

const KIND_LABELS = {
  bundle: "the review bundle",
  plan: "the plan",
  rubric: "the rubric",
} as const;

export function artifactLabel(pathOrName: string): string {
  const name = basename(pathOrName);

  const stamped = name.match(STAMPED_RE);
  if (stamped) {
    const kind = stamped[1] as keyof typeof KIND_LABELS;
    return `${KIND_LABELS[kind]} (${stamped[2]}:${stamped[3]})`;
  }

  if (name === "plan.json") return KIND_LABELS.plan;

  const planMd = name.match(PLAN_MD_RE);
  if (planMd) {
    return `${KIND_LABELS.plan} (${planMd[1]}:${planMd[2]})`;
  }

  const writeupStamped = name.match(WRITEUP_STAMPED_RE);
  if (writeupStamped) {
    return `the write-up (${writeupStamped[1]}:${writeupStamped[2]})`;
  }
  if (WRITEUP_BARE_RE.test(name)) return "the write-up";

  return name;
}

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}
