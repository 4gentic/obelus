import { type JSX, memo, useState } from "react";
import type {
  NoteBlock,
  StatusBlock,
  TextBlock,
  ThinkingBlock,
  ToolBlock,
  ToolGroupBlock,
} from "../../lib/transcript-reducer";

export const TextBlockView = memo(function TextBlockView({
  block,
}: {
  block: TextBlock;
}): JSX.Element | null {
  // A closed block whose text was entirely `[obelus:*]` markers strips to "";
  // render nothing rather than an empty paragraph.
  if (block.closed && block.text === "") return null;
  const cls = block.closed
    ? "jobs-dock__transcript-text"
    : "jobs-dock__transcript-text jobs-dock__transcript-text--streaming";
  return (
    <p className={cls}>
      {block.text}
      {block.closed ? null : <span className="jobs-dock__transcript-caret" aria-hidden="true" />}
    </p>
  );
});

export const NoteBlockView = memo(function NoteBlockView({
  block,
}: {
  block: NoteBlock;
}): JSX.Element {
  return (
    <p className="jobs-dock__transcript-note">
      <span className="jobs-dock__transcript-note-mark" aria-hidden="true">
        —
      </span>{" "}
      {block.text}
    </p>
  );
});

export const ThinkingBlockView = memo(function ThinkingBlockView({
  block,
}: {
  block: ThinkingBlock;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="jobs-dock__transcript-thinking">
      <button
        type="button"
        className="jobs-dock__transcript-thinking-head"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="jobs-dock__transcript-section-label">Thinking</span>
        {expanded ? null : (
          <span className="jobs-dock__transcript-thinking-preview">{block.preview}</span>
        )}
      </button>
      {expanded ? <p className="jobs-dock__transcript-thinking-body">{block.text}</p> : null}
    </div>
  );
});

export const ToolBlockView = memo(function ToolBlockView({
  block,
}: {
  block: ToolBlock;
}): JSX.Element {
  return (
    <div className="jobs-dock__transcript-tool">
      <p className="jobs-dock__transcript-tool-row">
        <span className="jobs-dock__transcript-tool-name">{block.name}</span>
        <span className="jobs-dock__transcript-tool-caption">
          {stripPrefix(block.caption, block.name)}
        </span>
        <ToolStatusDot status={block.resultStatus} />
      </p>
      {block.resultPreview ? (
        <p className="jobs-dock__transcript-tool-result">{block.resultPreview}</p>
      ) : null}
      {renderToolBody(block)}
    </div>
  );
});

export const ToolGroupBlockView = memo(function ToolGroupBlockView({
  block,
}: {
  block: ToolGroupBlock;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const count = block.members.length;
  const allClosed = block.closed;
  return (
    <div className="jobs-dock__transcript-tool-group">
      <button
        type="button"
        className="jobs-dock__transcript-tool-group-head"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="jobs-dock__transcript-tool-name">{block.name}</span>
        <span className="jobs-dock__transcript-tool-caption">{groupLabel(block.name, count)}</span>
        {allClosed ? null : <span className="jobs-dock__transcript-caret" aria-hidden="true" />}
      </button>
      {expanded ? (
        <ul className="jobs-dock__transcript-tool-group-members">
          {block.members.map((m) => (
            <li key={m.id}>
              <span className="jobs-dock__transcript-tool-caption">
                {stripPrefix(m.caption, m.name)}
              </span>
              <ToolStatusDot status={m.resultStatus} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});

export const StatusBlockView = memo(function StatusBlockView({
  block,
}: {
  block: StatusBlock;
}): JSX.Element {
  const cls =
    block.variant === "exit"
      ? "jobs-dock__transcript-status jobs-dock__transcript-status--exit"
      : "jobs-dock__transcript-status jobs-dock__transcript-status--overflow";
  return <p className={cls}>{block.label}</p>;
});

function ToolStatusDot({ status }: { status: ToolBlock["resultStatus"] }): JSX.Element | null {
  if (status === "ok") return null; // a clean run doesn't need an indicator
  const cls =
    status === "error"
      ? "jobs-dock__transcript-tool-status jobs-dock__transcript-tool-status--error"
      : "jobs-dock__transcript-tool-status jobs-dock__transcript-tool-status--pending";
  const label = status === "error" ? "error" : "running";
  return <span className={cls}>{label}</span>;
}

function renderToolBody(block: ToolBlock): JSX.Element | null {
  if (block.name === "Bash") {
    const cmd = readStringField(block.input, "command");
    if (!cmd) return null;
    const truncated = cmd.length > 600 ? cmd.slice(0, 600) : cmd;
    const overflow = cmd.length - truncated.length;
    return (
      <pre className="jobs-dock__transcript-tool-body">
        {truncated}
        {overflow > 0 ? (
          <span className="jobs-dock__transcript-tool-body-overflow">{` [+${overflow} B more]`}</span>
        ) : null}
      </pre>
    );
  }
  return null;
}

function readStringField(input: unknown, key: string): string | null {
  if (!input || typeof input !== "object") return null;
  const v = (input as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}

// `describePhase` returns captions like "Reading paper.tex" or "Bash: ..."; in
// a transcript row that already shows the tool name as a chip, the leading
// verb is redundant. Strip it when it matches the tool name's verb form.
function stripPrefix(caption: string, name: string): string {
  const verbs: Readonly<Record<string, RegExp>> = {
    Read: /^Reading\s+/,
    Glob: /^Listing\s+/,
    Grep: /^Searching(?:\s+\S+\s+for)?\s+/,
    Bash: /^Running\s+/,
    Edit: /^Editing\s+/,
    MultiEdit: /^Editing\s+/,
    Write: /^Writing\s+/,
    Task: /^Delegating(?::\s+|\s+to\s+)/,
    WebFetch: /^Fetching\s+/,
    WebSearch: /^Searching the web for\s+/,
    Skill: /^Loading skill\s+/,
    NotebookEdit: /^Editing\s+/,
  };
  const re = verbs[name];
  return re ? caption.replace(re, "") : caption;
}

function groupLabel(name: string, count: number): string {
  switch (name) {
    case "Read":
      return `${count} files`;
    case "Glob":
      return `${count} listings`;
    case "Grep":
      return `${count} searches`;
    case "Edit":
    case "MultiEdit":
      return `${count} edits`;
    case "Write":
      return `${count} writes`;
    case "Bash":
      return `${count} commands`;
    default:
      return `${count}×`;
  }
}
