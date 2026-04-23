export const SENTINELS = [
  "<obelus:quote>",
  "</obelus:quote>",
  "<obelus:note>",
  "</obelus:note>",
  "<obelus:context-before>",
  "</obelus:context-before>",
  "<obelus:context-after>",
  "</obelus:context-after>",
  "<obelus:rubric>",
  "</obelus:rubric>",
] as const;

export function assertNoSentinel(field: string, value: string, annotationId: string): void {
  for (const s of SENTINELS) {
    if (value.includes(s)) {
      throw new Error(
        `annotation ${annotationId} field '${field}' contains reserved delimiter '${s}'`,
      );
    }
  }
}

export function assertNoSentinelInRubric(value: string): void {
  for (const s of SENTINELS) {
    if (value.includes(s)) {
      throw new Error(`rubric body contains reserved delimiter '${s}'`);
    }
  }
}
