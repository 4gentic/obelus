import { invoke } from "@tauri-apps/api/core";

export type ClaudeState = "found" | "notFound" | "belowFloor" | "aboveCeiling" | "unreadable";

export interface ClaudeStatus {
  path: string | null;
  version: string | null;
  status: ClaudeState;
  floor: string;
  ceilExclusive: string;
}

export type DirEntryKind = "file" | "dir" | "other";

export interface DirEntry {
  name: string;
  kind: DirEntryKind;
}

export function detectClaude(): Promise<ClaudeStatus> {
  return invoke<ClaudeStatus>("detect_claude");
}

export interface ClaudeUserSettings {
  model: string | null;
  effortLevel: string | null;
}

export function readClaudeUserSettings(): Promise<ClaudeUserSettings> {
  return invoke<ClaudeUserSettings>("read_claude_user_settings");
}

export interface PickedRoot {
  path: string;
  rootId: string;
}

export interface PickedPdf {
  path: string;
  rootId: string;
  fileName: string;
}

export function openFolderPicker(): Promise<PickedRoot | null> {
  return invoke<PickedRoot | null>("open_folder_picker");
}

export function openPdfPicker(): Promise<PickedPdf | null> {
  return invoke<PickedPdf | null>("open_pdf_picker");
}

export interface PickedRubric {
  name: string;
  content: string;
}

export function openRubricPicker(): Promise<PickedRubric | null> {
  return invoke<PickedRubric | null>("open_rubric_picker");
}

// Re-vouches a path from the on-device projects table for this session.
// See the Rust-side doc comment in commands/project.rs for the threat model.
export function authorizeProjectRoot(path: string): Promise<string> {
  return invoke<string>("authorize_project_root", { path });
}

export function fsReadFile(rootId: string, relPath: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("fs_read_file", { rootId, relPath });
}

export function fsReadDir(rootId: string, relPath: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("fs_read_dir", { rootId, relPath });
}

export function fsWriteBytes(rootId: string, relPath: string, bytes: Uint8Array): Promise<void> {
  return invoke<void>("fs_write_bytes", { rootId, relPath, bytes: Array.from(bytes) });
}

export function fsWriteText(rootId: string, relPath: string, body: string): Promise<void> {
  return invoke<void>("fs_write_text", { rootId, relPath, body });
}

// Writes text to an absolute path the user picked via the native save dialog.
// Bypasses the project-root scope of `fs_write_text`; the dialog is the trust
// boundary. The Rust side rejects non-absolute paths.
export function fsWriteTextAbs(path: string, body: string): Promise<void> {
  return invoke<void>("fs_write_text_abs", { path, body });
}

export function fsListPdfs(rootId: string): Promise<string[]> {
  return invoke<string[]>("fs_list_pdfs", { rootId });
}

export interface FsStat {
  size: number;
  sha256: string;
}

export function fsStat(rootId: string, relPath: string): Promise<FsStat> {
  return invoke<FsStat>("fs_stat", { rootId, relPath });
}

export async function applyHunks(args: {
  rootId: string;
  sessionId: string;
  hunks: Array<{ file: string; patch: string }>;
}): Promise<{ filesWritten: number; hunksApplied: number }> {
  return invoke<{ filesWritten: number; hunksApplied: number }>("apply_hunks", args);
}

export interface TypstCompileReport {
  outputRelPath: string;
  stderr: string;
}

export function compileTypst(rootId: string, relPath: string): Promise<TypstCompileReport> {
  return invoke<TypstCompileReport>("compile_typst", { rootId, relPath });
}

export interface HistorySnapshotReport {
  manifestSha256: string;
  filesTotal: number;
  blobsWritten: number;
  bytesWritten: number;
  isNewManifest: boolean;
}

export function historySnapshot(args: {
  rootId: string;
  explicitRelPaths?: ReadonlyArray<string>;
  tombstonedRelPaths?: ReadonlyArray<string>;
}): Promise<HistorySnapshotReport> {
  return invoke<HistorySnapshotReport>("history_snapshot", {
    rootId: args.rootId,
    explicitRelPaths: args.explicitRelPaths ?? [],
    tombstonedRelPaths: args.tombstonedRelPaths ?? [],
  });
}

export interface HistoryDivergenceReport {
  modified: string[];
  added: string[];
  missing: string[];
}

export function historyDetectDivergence(
  rootId: string,
  targetManifestSha: string,
): Promise<HistoryDivergenceReport> {
  return invoke<HistoryDivergenceReport>("history_detect_divergence", {
    rootId,
    targetManifestSha,
  });
}

export interface HistoryCheckoutReport {
  filesWritten: number;
  filesDeleted: number;
}

export function historyCheckout(args: {
  rootId: string;
  targetManifestSha: string;
  expectedParentManifestSha?: string | null;
}): Promise<HistoryCheckoutReport> {
  return invoke<HistoryCheckoutReport>("history_checkout", {
    rootId: args.rootId,
    targetManifestSha: args.targetManifestSha,
    expectedParentManifestSha: args.expectedParentManifestSha ?? null,
  });
}

export interface HistoryGcReport {
  blobsDeleted: number;
  manifestsDeleted: number;
  bytesFreed: number;
}

export function historyGc(
  rootId: string,
  liveManifestShas: ReadonlyArray<string>,
): Promise<HistoryGcReport> {
  return invoke<HistoryGcReport>("history_gc", {
    rootId,
    liveManifestShas: Array.from(liveManifestShas),
  });
}

export function historyReadBlob(rootId: string, sha256: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("history_read_blob", { rootId, sha256 });
}

export type FileDiffStatus = "added" | "removed" | "modified" | "binary";

export interface FileDiff {
  rel: string;
  status: FileDiffStatus;
  unified: string;
}

export interface DiffManifestsReport {
  files: FileDiff[];
}

export function historyDiffManifests(args: {
  rootId: string;
  fromManifestSha: string;
  toManifestSha: string;
}): Promise<DiffManifestsReport> {
  return invoke<DiffManifestsReport>("history_diff_manifests", {
    rootId: args.rootId,
    fromManifestSha: args.fromManifestSha,
    toManifestSha: args.toManifestSha,
  });
}

export type ProjectScanFileFormat =
  | "tex"
  | "md"
  | "typ"
  | "bib"
  | "cls"
  | "sty"
  | "bst"
  | "pdf"
  | "yml"
  | "json"
  | "txt";

export type ProjectScanFileRole = "main" | "include" | "bib" | "asset";

export interface ProjectScanFile {
  relPath: string;
  format: ProjectScanFileFormat;
  role: ProjectScanFileRole | null;
  size: number;
  mtimeMs: number;
}

export interface ProjectScanReport {
  projectId: string;
  format: "tex" | "md" | "typ" | null;
  mainRelPath: string | null;
  mainIsPinned: boolean;
  compiler: "typst" | "latexmk" | "pandoc" | "xelatex" | "pdflatex" | null;
  files: ProjectScanFile[];
  scannedAt: string;
}

export function projectScan(args: {
  rootId: string;
  projectId: string;
  label: string;
  kind: "writer" | "reviewer";
  pinnedMainRelPath?: string | null;
  scannedAt: string;
}): Promise<ProjectScanReport> {
  return invoke<ProjectScanReport>("project_scan", {
    rootId: args.rootId,
    input: {
      projectId: args.projectId,
      label: args.label,
      kind: args.kind,
      pinnedMainRelPath: args.pinnedMainRelPath ?? null,
      scannedAt: args.scannedAt,
    },
  });
}
