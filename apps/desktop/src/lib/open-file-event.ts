export const OPEN_FILE_EVENT = "obelus:open-file";

export interface OpenFileEventDetail {
  projectId: string;
  relPath: string;
}

export function emitOpenFile(detail: OpenFileEventDetail): void {
  window.dispatchEvent(new CustomEvent<OpenFileEventDetail>(OPEN_FILE_EVENT, { detail }));
}
