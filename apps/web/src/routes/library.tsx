import { MAX_PDF_BYTES, MAX_PDF_BYTES_LABEL } from "@obelus/pdf-view";
import type { PaperRow } from "@obelus/repo";
import { papers, revisions } from "@obelus/repo/web";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./library.css";

import type { JSX } from "react";

type Row = {
  paper: PaperRow;
  lastEditedAt: string;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  const y = d.getFullYear();
  const now = new Date().getFullYear();
  return y === now ? `${mm}/${dd}` : `${mm}/${dd}/${y.toString().slice(-2)}`;
}

function titleFromFilename(name: string): string {
  return (
    name
      .replace(/\.(pdf|md|markdown)$/i, "")
      .replace(/[_-]+/g, " ")
      .trim() || "Untitled"
  );
}

function detectFormat(file: File): "pdf" | "md" | null {
  const lower = file.name.toLowerCase();
  if (file.type.includes("pdf") || lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md";
  return null;
}

type RowItemProps = {
  row: Row;
  onRename: (id: string, title: string) => void;
  onRemove: (id: string) => void;
};

function RowItem({ row, onRename, onRemove }: RowItemProps): JSX.Element {
  const { paper, lastEditedAt } = row;
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [value, setValue] = useState(paper.title);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function commit(): void {
    const next = value.trim() || "Untitled";
    if (next !== paper.title) onRename(paper.id, next);
    setEditing(false);
  }

  function cancel(): void {
    setValue(paper.title);
    setEditing(false);
  }

  return (
    <li className="library__row">
      {editing ? (
        <input
          ref={inputRef}
          className="library__row-input"
          type="text"
          value={value}
          aria-label="Paper title"
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
        />
      ) : (
        <Link to={`/app/review/${paper.id}`} className="library__row-title">
          {paper.title}
        </Link>
      )}
      <span className="library__row-meta">
        {!editing && (
          <>
            <button
              type="button"
              className="library__row-action"
              onClick={() => {
                setValue(paper.title);
                setEditing(true);
              }}
              aria-label={`Rename ${paper.title}`}
            >
              Rename
            </button>
            {confirmingRemove ? (
              <button
                type="button"
                className="library__row-action library__row-action--danger"
                onClick={() => onRemove(paper.id)}
                onBlur={() => setConfirmingRemove(false)}
                aria-label={`Confirm removal of ${paper.title}`}
              >
                Click to confirm
              </button>
            ) : (
              <button
                type="button"
                className="library__row-action"
                onClick={() => setConfirmingRemove(true)}
                aria-label={`Remove ${paper.title}`}
              >
                Remove
              </button>
            )}
          </>
        )}
        <span className="library__row-date">Edited {formatDate(lastEditedAt)}</span>
      </span>
    </li>
  );
}

export default function Library(): JSX.Element {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await papers.list();
      const joined = await Promise.all(
        list.map(async (paper) => {
          const revs = await revisions.listForPaper(paper.id);
          const lastEditedAt = revs.at(-1)?.createdAt ?? paper.createdAt;
          return { paper, lastEditedAt } satisfies Row;
        }),
      );
      if (!cancelled) setRows(joined);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onFile(file: File): Promise<void> {
    const format = detectFormat(file);
    if (format === null) {
      setStatus("error");
      setError("Obelus supports .pdf and .md papers.");
      return;
    }
    if (format === "pdf" && file.size > MAX_PDF_BYTES) {
      setStatus("error");
      setError(`That PDF is larger than ${MAX_PDF_BYTES_LABEL}. Obelus cannot open it.`);
      return;
    }
    setStatus("working");
    setError(null);
    try {
      if (format === "md") {
        const text = await file.text();
        const { paper } = await papers.create({
          source: "md",
          title: titleFromFilename(file.name),
          mdText: text,
          file: file.name,
        });
        console.info("[ingest-paper]", {
          paperId: paper.id,
          format: paper.format,
          title: paper.title,
          byteLength: text.length,
          file: file.name,
        });
        navigate(`/app/review/${paper.id}`);
        return;
      }
      const bytes = await file.arrayBuffer();
      const { paper } = await papers.create({
        source: "bytes",
        title: titleFromFilename(file.name),
        pdfBytes: bytes,
      });
      console.info("[ingest-paper]", {
        paperId: paper.id,
        format: paper.format,
        title: paper.title,
        byteLength: bytes.byteLength,
      });
      navigate(`/app/review/${paper.id}`);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not open that paper.");
    }
  }

  function pickFile(): void {
    fileInputRef.current?.click();
  }

  async function onRename(id: string, title: string): Promise<void> {
    await papers.rename(id, title);
    setRows((prev) =>
      prev
        ? prev.map((r) => (r.paper.id === id ? { ...r, paper: { ...r.paper, title } } : r))
        : prev,
    );
  }

  async function onRemove(id: string): Promise<void> {
    await papers.remove(id);
    setRows((prev) => (prev ? prev.filter((r) => r.paper.id !== id) : prev));
  }

  return (
    <section className="library">
      <header className="library__header">
        <h1 className="library__title">Your library.</h1>
        <p className="library__sub">Papers you have opened live here. Nothing leaves the device.</p>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf,.md,.markdown,text/markdown"
        className="library__file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = "";
        }}
      />

      {rows && rows.length > 0 ? (
        <>
          <div className="library__actions">
            <button type="button" className="library__cta" onClick={pickFile}>
              Add paper <span aria-hidden="true">&rarr;</span>
            </button>
          </div>
          <ol className="library__list" aria-label="Papers">
            {rows.map((row) => (
              <RowItem
                key={row.paper.id}
                row={row}
                onRename={(id, title) => void onRename(id, title)}
                onRemove={(id) => void onRemove(id)}
              />
            ))}
          </ol>
        </>
      ) : (
        <section className="library__empty" aria-label="Empty library">
          <p className="library__empty-msg">No papers yet. Begin with a mark.</p>
          <button type="button" className="library__cta" onClick={pickFile}>
            Open a PDF <span aria-hidden="true">&rarr;</span>
          </button>
        </section>
      )}

      {status === "working" ? <output className="library__status">Reading the PDF.</output> : null}
      {status === "error" && error ? (
        <p className="library__status library__status--error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
