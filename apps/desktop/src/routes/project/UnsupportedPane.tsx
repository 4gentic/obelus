import type { JSX } from "react";

interface Props {
  path: string | null;
}

export default function UnsupportedPane({ path }: Props): JSX.Element {
  if (!path) {
    return (
      <div className="pane pane--empty">
        <p>Select a file to begin.</p>
      </div>
    );
  }
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return (
    <div className="pane pane--empty">
      <p>
        <code>{path}</code>
      </p>
      <p className="pane__sub">
        Files with extension <code>.{ext || "(none)"}</code> are not opened in this phase.
      </p>
    </div>
  );
}
