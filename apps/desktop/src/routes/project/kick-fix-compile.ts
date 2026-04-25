import {
  COMPILE_ERROR_BUNDLE_VERSION,
  type CompileErrorBundle as CompileErrorBundleType,
} from "@obelus/bundle-schema";
import { claudeFixCompile } from "@obelus/claude-sidecar";
import type { Repository } from "@obelus/repo";
import { getVersion } from "@tauri-apps/api/app";
import { workspaceWriteText } from "../../ipc/commands";
import { useJobsStore } from "../../lib/jobs-store";
import { loadClaudeOverrides } from "../../lib/use-claude-defaults";

export type FixCompileTrigger = "apply" | "manual";

export interface KickFixCompileArgs {
  repo: Repository;
  rootId: string;
  projectId: string;
  projectLabel: string;
  paperId: string;
  // The review session in scope when apply kicked compile (auto flow) or
  // null (manual flow). Only used for logging correlation — the fix-compile
  // run creates its own review session so the resulting plan lands in its
  // own row and the DiffStore auto-swaps to it.
  originSessionId: string | null;
  compiler: string;
  mainRelPath: string;
  stderr: string;
  trigger: FixCompileTrigger;
}

function isoStampForFilename(now: Date = new Date()): string {
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

// Compiler -> the top-level format token in the bundle. `PaperBuildFormat` in
// bundle-schema is "tex" | "md" | "typ"; the desktop's paper_build stores the
// same values. Only these three are wired end-to-end; anything else is a
// config bug and we refuse to synthesise a bundle for it.
function inferFormat(compiler: string): "typ" | "tex" | "md" | null {
  if (compiler === "typst") return "typ";
  if (compiler === "latexmk" || compiler === "xelatex" || compiler === "pdflatex") return "tex";
  if (compiler === "pandoc") return "md";
  return null;
}

// Compiler -> the compile-error bundle's `compiler` enum value. The bundle
// schema accepts "typst" | "latexmk" | "pandoc" | "xelatex" | "pdflatex"; a
// compiler the desktop knows but the schema doesn't gets refused upstream,
// which is what we want — the plugin skill only handles Typst + LaTeX today.
function supportedCompiler(compiler: string): CompileErrorBundleType["compiler"] | null {
  switch (compiler) {
    case "typst":
      return "typst";
    case "latexmk":
      return "latexmk";
    case "xelatex":
      return "xelatex";
    case "pdflatex":
      return "pdflatex";
    default:
      return null;
  }
}

export async function kickFixCompile(args: KickFixCompileArgs): Promise<void> {
  const {
    repo,
    rootId,
    projectId,
    projectLabel,
    paperId,
    originSessionId,
    compiler,
    mainRelPath,
    stderr,
    trigger,
  } = args;

  const format = inferFormat(compiler);
  const bundleCompiler = supportedCompiler(compiler);
  if (format === null || bundleCompiler === null) {
    console.warn("[fix-compile-start]", {
      originSessionId,
      paperId,
      compiler,
      skipped: "unsupported-compiler",
    });
    return;
  }

  const paper = await repo.papers.get(paperId).catch(() => undefined);
  if (!paper) {
    console.warn("[fix-compile-start]", {
      originSessionId,
      paperId,
      compiler,
      skipped: "paper-missing",
    });
    return;
  }

  const toolVersion = await getVersion().catch(() => "0.0.0");
  const bundle: CompileErrorBundleType = {
    bundleVersion: COMPILE_ERROR_BUNDLE_VERSION,
    tool: { name: "obelus", version: toolVersion },
    project: { rootLabel: projectLabel, main: { relPath: mainRelPath, format } },
    paperId,
    compiler: bundleCompiler,
    stderr,
    exitCode: 1,
    trigger,
  };

  const stamp = isoStampForFilename();
  const nonce = crypto.randomUUID().slice(0, 8);
  const bundleWorkspaceRelPath = `compile-error-${stamp}-${nonce}.json`;
  await workspaceWriteText(
    projectId,
    bundleWorkspaceRelPath,
    `${JSON.stringify(bundle, null, 2)}\n`,
  );

  const overrides = await loadClaudeOverrides();

  // Register the fix-compile run as its own review session. `bundleId` is the
  // compile-error bundle filename so `ingestPlanFile`'s basename match fires
  // on the plan the skill produces. When hunks land, the paper's DiffStore
  // effect picks up the new session as the latest visible review and swaps
  // in — the user sees the fix blocks in DiffReview without any extra step.
  const fixSession = await repo.reviewSessions.create({
    projectId,
    paperId,
    bundleId: bundleWorkspaceRelPath,
    model: overrides.model,
    effort: overrides.effort,
  });

  const claudeSessionId = await claudeFixCompile({
    rootId,
    projectId,
    bundleWorkspaceRelPath,
    paperId,
    model: overrides.model,
    effort: overrides.effort,
  });
  await repo.reviewSessions.setClaudeSessionId(fixSession.id, claudeSessionId);

  useJobsStore.getState().register({
    claudeSessionId,
    projectId,
    projectLabel,
    rootId,
    kind: "compile-fix",
    startedAt: Date.now(),
    reviewSessionId: fixSession.id,
    paperId,
    ...(paper.title ? { paperTitle: paper.title } : {}),
    compiler,
    mainRelPath,
  });

  console.info("[fix-compile-start]", {
    originSessionId,
    fixSessionId: fixSession.id,
    claudeSessionId,
    paperId,
    compiler: bundleCompiler,
    mainRelPath,
    bundleWorkspaceRelPath,
    trigger,
    stderrBytes: stderr.length,
  });
}
