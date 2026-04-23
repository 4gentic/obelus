import { BundleV1 } from "./schema.js";
import { BUNDLE_VERSION_V2, BundleV2 } from "./schema-v2.js";
import type { Category } from "./types.js";
import type { Bundle2 } from "./types-v2.js";

// v1 shipped a closed enum of categories; v2 replaces it with per-project
// `ProjectCategory` records. Every v1 enum value is a valid v2 slug, so the
// mapping is lossless. Labels here match what the review pane used to show.
const V1_CATEGORY_LABELS: Record<Category, string> = {
  unclear: "unclear",
  wrong: "wrong",
  "weak-argument": "weak argument",
  "citation-needed": "citation needed",
  rephrase: "rephrase",
  praise: "praise",
  enhancement: "enhancement",
  aside: "aside",
  flag: "flag",
};

/**
 * Migrate a v1 review bundle to a v2 review bundle.
 *
 * Parses `input` as `BundleV1` (so garbage in surfaces as a Zod validation
 * error, not undefined behaviour) and re-validates the transformed result as
 * `BundleV2` before returning.
 *
 * Translations:
 * - `bundleVersion` "1.0" -> "2.0".
 * - `pdf` + `paper` collapse into a single entry in `papers[]`, and the v1
 *   `pdf.filename` becomes v2 `papers[0].pdf.relPath`. If the v1 filename is
 *   not a valid relative POSIX path (absolute, backslash-separated, or with
 *   `..` segments), the final `BundleV2.parse()` rejects it with a
 *   path-scoped error.
 * - Each annotation's `page`/`bbox`/`textItemRange` fold into an
 *   `anchor: { kind: "pdf", ... }`. v1 never carried source or HTML anchors.
 * - Every annotation's `paperId` is set to the single migrated paper's id.
 * - `project.id` is set to the v1 paper's id. v1 is single-paper by
 *   construction, so the paper *is* the project; reusing the id makes the
 *   migration idempotent by construction — the same v1 bundle always yields
 *   the same project identity, without the caller having to invent one.
 * - `project.label` defaults to the v1 paper title.
 * - `project.categories` is synthesised from the closed v1 enum; only the
 *   categories that the bundle actually uses are emitted, so a consumer does
 *   not see slugs the reviewer never chose.
 */
export function migrateV1ToV2(input: unknown): Bundle2 {
  const v1 = BundleV1.parse(input);

  const usedCategories = new Set<Category>(v1.annotations.map((a) => a.category));
  const categories =
    usedCategories.size > 0
      ? [...usedCategories].map((slug) => ({ slug, label: V1_CATEGORY_LABELS[slug] }))
      : // v2 requires at least one category. An empty v1 bundle has no signal
        // about which categories were in scope, so fall back to "unclear" —
        // the most conservative reviewer verdict.
        [{ slug: "unclear", label: V1_CATEGORY_LABELS.unclear }];

  const candidate = {
    bundleVersion: BUNDLE_VERSION_V2,
    tool: v1.tool,
    project: {
      id: v1.paper.id,
      label: v1.paper.title,
      kind: "reviewer" as const,
      categories,
    },
    papers: [
      {
        id: v1.paper.id,
        title: v1.paper.title,
        revision: v1.paper.revision,
        createdAt: v1.paper.createdAt,
        pdf: {
          relPath: v1.pdf.filename,
          sha256: v1.pdf.sha256,
          pageCount: v1.pdf.pageCount,
        },
      },
    ],
    annotations: v1.annotations.map((a) => ({
      id: a.id,
      paperId: v1.paper.id,
      category: a.category,
      quote: a.quote,
      contextBefore: a.contextBefore,
      contextAfter: a.contextAfter,
      anchor: {
        kind: "pdf" as const,
        page: a.page,
        bbox: a.bbox,
        textItemRange: a.textItemRange,
      },
      note: a.note,
      thread: a.thread,
      createdAt: a.createdAt,
      ...(a.groupId === undefined ? {} : { groupId: a.groupId }),
    })),
  };

  return BundleV2.parse(candidate);
}
