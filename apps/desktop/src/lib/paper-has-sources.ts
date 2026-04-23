import type { PaperBuildRow } from "@obelus/repo";

export function paperHasSources(build: PaperBuildRow | null | undefined): boolean {
  return typeof build?.mainRelPath === "string" && build.mainRelPath !== "";
}
