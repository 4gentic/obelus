import type { CSSProperties, JSX } from "react";
import type { RenderError } from "./types.js";

type Props = {
  file: string;
  error: RenderError;
};

const styles: {
  root: CSSProperties;
  title: CSSProperties;
  body: CSSProperties;
  tried: CSSProperties;
} = {
  root: {
    padding: "var(--space-6)",
    background: "var(--panel)",
    color: "var(--ink)",
    fontFamily: "var(--font-body)",
    fontSize: "var(--step-0)",
    border: "var(--rule-soft)",
    borderRadius: "var(--radius-1)",
    maxWidth: "60ch",
  },
  title: {
    fontFamily: "var(--font-display)",
    fontSize: "var(--step-2)",
    color: "var(--rubric)",
    margin: 0,
    marginBottom: "var(--space-3)",
  },
  body: {
    margin: 0,
    color: "var(--ink-soft)",
  },
  tried: {
    marginTop: "var(--space-4)",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--step--1)",
    color: "var(--ink-soft)",
  },
};

export function RenderFailedPane({ file, error }: Props): JSX.Element {
  return (
    <section style={styles.root} role="alert">
      <h2 style={styles.title}>{titleFor(error)}</h2>
      <p style={styles.body}>{bodyFor(file, error)}</p>
      {error.kind === "binary-missing" ? (
        <p style={styles.tried}>tried: {error.tried.join(", ")}</p>
      ) : null}
    </section>
  );
}

function titleFor(error: RenderError): string {
  switch (error.kind) {
    case "binary-missing":
      return "Source preview unavailable.";
    case "render-failed":
      return "The renderer refused this file.";
    case "parse-failed":
      return "This source did not parse.";
    case "unsupported":
      return "This format is not yet supported.";
  }
}

function bodyFor(file: string, error: RenderError): string {
  switch (error.kind) {
    case "binary-missing":
      return `${file} needs a LaTeX-to-HTML tool installed on this machine.`;
    case "render-failed":
      return `The renderer exited with code ${error.exitCode}. ${shorten(error.stderr)}`;
    case "parse-failed":
      return `${file} could not be parsed: ${shorten(error.message)}`;
    case "unsupported":
      return `${file} cannot be previewed yet. ${shorten(error.message)}`;
  }
}

function shorten(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 240) return trimmed;
  return `${trimmed.slice(0, 240)}…`;
}
