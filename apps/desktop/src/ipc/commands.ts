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
