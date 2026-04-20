import type { DeskRow, ProjectKind, ProjectRow } from "@obelus/repo";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authorizeProjectRoot, fsReadDir } from "../ipc/commands";
import { getRepository } from "../lib/repo";
import { getAppState, setAppState } from "../store/app-state";
import "./home.css";

import type { JSX } from "react";

interface Row {
  project: ProjectRow;
  rootId: string | null;
  missing: boolean;
}

function kindLabel(kind: ProjectKind): string {
  if (kind === "folder") return "Paper — writing";
  if (kind === "single-pdf") return "Paper — reviewing";
  return "Stack — reviewing";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  const y = d.getFullYear();
  const now = new Date().getFullYear();
  return y === now ? `${mm}/${dd}` : `${mm}/${dd}/${y.toString().slice(-2)}`;
}

async function hydrate(project: ProjectRow): Promise<Row> {
  try {
    const rootId = await authorizeProjectRoot(project.root);
    await fsReadDir(rootId, ".");
    return { project, rootId, missing: false };
  } catch {
    return { project, rootId: null, missing: true };
  }
}

interface RowItemProps {
  row: Row;
  otherDesks: DeskRow[];
  onRename: (id: string, label: string) => void;
  onForget: (id: string) => void;
  onRepoint: (id: string) => void;
  onMove: (id: string, deskId: string) => void;
}

function RowItem({
  row,
  otherDesks,
  onRename,
  onForget,
  onRepoint,
  onMove,
}: RowItemProps): JSX.Element {
  const { project, missing } = row;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(project.label);
  const [moveOpen, setMoveOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function commit(): void {
    const next = value.trim() || "Untitled";
    if (next !== project.label) onRename(project.id, next);
    setEditing(false);
  }

  function cancel(): void {
    setValue(project.label);
    setEditing(false);
  }

  return (
    <li className={missing ? "home__row home__row--missing" : "home__row"}>
      {editing ? (
        <input
          ref={inputRef}
          className="home__row-input"
          type="text"
          value={value}
          aria-label="Project label"
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
        <Link to={`/project/${project.id}`} className="home__row-title">
          {project.label}
        </Link>
      )}
      <span className="home__row-meta">
        <span className="home__row-kind">{kindLabel(project.kind)}</span>
        {missing ? (
          <>
            <button
              type="button"
              className="home__row-action"
              onClick={() => onRepoint(project.id)}
            >
              repoint
            </button>
            <button type="button" className="home__row-action" onClick={() => onForget(project.id)}>
              forget
            </button>
          </>
        ) : editing ? null : (
          <>
            {otherDesks.length > 0 ? (
              <span className="home__row-move">
                <button
                  type="button"
                  className="home__row-action"
                  aria-haspopup="menu"
                  aria-expanded={moveOpen}
                  onClick={() => setMoveOpen((v) => !v)}
                >
                  Move
                </button>
                {moveOpen ? (
                  <div className="home__move-menu" role="menu">
                    {otherDesks.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        role="menuitem"
                        className="home__move-item"
                        onClick={() => {
                          setMoveOpen(false);
                          onMove(project.id, d.id);
                        }}
                      >
                        {d.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </span>
            ) : null}
            <button
              type="button"
              className="home__row-rename"
              onClick={() => {
                setValue(project.label);
                setEditing(true);
              }}
              aria-label={`Rename ${project.label}`}
            >
              Rename
            </button>
          </>
        )}
        <span className="home__row-date">
          {missing ? "missing" : `Opened ${formatDate(project.lastOpenedAt)}`}
        </span>
      </span>
    </li>
  );
}

interface SectionProps {
  title: string;
  rows: Row[];
  otherDesks: DeskRow[];
  onRename: (id: string, label: string) => void;
  onForget: (id: string) => void;
  onRepoint: (id: string) => void;
  onMove: (id: string, deskId: string) => void;
}

function Section({
  title,
  rows,
  otherDesks,
  onRename,
  onForget,
  onRepoint,
  onMove,
}: SectionProps): JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <div className="home__section">
      <h2 className="home__section-title">{title}</h2>
      <ul className="home__list" aria-label={title}>
        {rows.map((row) => (
          <RowItem
            key={row.project.id}
            row={row}
            otherDesks={otherDesks}
            onRename={onRename}
            onForget={onForget}
            onRepoint={onRepoint}
            onMove={onMove}
          />
        ))}
      </ul>
    </div>
  );
}

interface DeskMenuProps {
  desks: DeskRow[];
  current: DeskRow;
  canDelete: boolean;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

function DeskMenu({
  desks,
  current,
  canDelete,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
  onClose,
}: DeskMenuProps): JSX.Element {
  const [mode, setMode] = useState<"list" | "new" | "rename">("list");
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (mode !== "list") inputRef.current?.focus();
  }, [mode]);

  function submitCreate(): void {
    const name = value.trim();
    if (name) onCreate(name);
    setValue("");
    setMode("list");
  }

  function submitRename(): void {
    const name = value.trim();
    if (name && name !== current.name) onRename(current.id, name);
    setValue("");
    setMode("list");
  }

  if (mode === "new") {
    return (
      <div className="home__desk-menu" role="menu">
        <input
          ref={inputRef}
          className="home__desk-input"
          type="text"
          placeholder="Name the new desk"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitCreate();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setValue("");
              setMode("list");
            }
          }}
        />
      </div>
    );
  }

  if (mode === "rename") {
    return (
      <div className="home__desk-menu" role="menu">
        <input
          ref={inputRef}
          className="home__desk-input"
          type="text"
          placeholder={current.name}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitRename();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setValue("");
              setMode("list");
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="home__desk-menu" role="menu">
      <ul className="home__desk-list">
        {desks.map((d) => (
          <li key={d.id} role="none">
            <button
              type="button"
              role="menuitem"
              className={
                d.id === current.id ? "home__desk-item home__desk-item--active" : "home__desk-item"
              }
              onClick={() => {
                onSwitch(d.id);
                onClose();
              }}
            >
              {d.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="home__desk-actions">
        <button
          type="button"
          className="home__desk-action"
          onClick={() => {
            setValue(current.name);
            setMode("rename");
          }}
        >
          Rename desk
        </button>
        <button
          type="button"
          className="home__desk-action"
          disabled={!canDelete}
          title={canDelete ? undefined : "Move or forget this desk's projects first."}
          onClick={() => onDelete(current.id)}
        >
          Delete desk
        </button>
        <button
          type="button"
          className="home__desk-action"
          onClick={() => {
            setValue("");
            setMode("new");
          }}
        >
          + New desk
        </button>
      </div>
    </div>
  );
}

export default function Home(): JSX.Element {
  const navigate = useNavigate();
  const [desks, setDesks] = useState<DeskRow[] | null>(null);
  const [currentDeskId, setCurrentDeskId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(event: MouseEvent): void {
      if (!menuRef.current) return;
      if (!(event.target instanceof Node)) return;
      if (!menuRef.current.contains(event.target)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const repo = await getRepository();
      const deskList = await repo.desks.list();
      if (cancelled) return;
      if (deskList.length === 0) {
        navigate("/wizard", { replace: true });
        return;
      }
      const saved = await getAppState("currentDeskId");
      const picked = deskList.find((d) => d.id === saved) ?? deskList[0];
      if (!picked) {
        navigate("/wizard", { replace: true });
        return;
      }
      if (picked.id !== saved) await setAppState("currentDeskId", picked.id);
      if (cancelled) return;
      setDesks(deskList);
      setCurrentDeskId(picked.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    if (!currentDeskId) return;
    let cancelled = false;
    void (async () => {
      const repo = await getRepository();
      const projects = await repo.projects.list(currentDeskId);
      const hydrated = await Promise.all(projects.map(hydrate));
      if (!cancelled) setRows(hydrated);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentDeskId]);

  async function onRename(id: string, label: string): Promise<void> {
    const repo = await getRepository();
    await repo.projects.rename(id, label);
    setRows((prev) =>
      prev
        ? prev.map((r) => (r.project.id === id ? { ...r, project: { ...r.project, label } } : r))
        : prev,
    );
  }

  async function onForget(id: string): Promise<void> {
    const repo = await getRepository();
    await repo.projects.forget(id);
    setRows((prev) => (prev ? prev.filter((r) => r.project.id !== id) : prev));
  }

  async function onRepoint(_id: string): Promise<void> {
    navigate("/wizard");
  }

  async function onMove(id: string, deskId: string): Promise<void> {
    const repo = await getRepository();
    await repo.projects.moveToDesk(id, deskId);
    setRows((prev) => (prev ? prev.filter((r) => r.project.id !== id) : prev));
  }

  async function onSwitchDesk(id: string): Promise<void> {
    if (id === currentDeskId) return;
    const repo = await getRepository();
    await repo.desks.touchLastOpened(id);
    await setAppState("currentDeskId", id);
    setCurrentDeskId(id);
    setRows(null);
  }

  async function onCreateDesk(name: string): Promise<void> {
    const repo = await getRepository();
    const desk = await repo.desks.create({ name });
    await setAppState("currentDeskId", desk.id);
    setDesks((prev) => (prev ? [...prev, desk] : [desk]));
    setCurrentDeskId(desk.id);
    setRows(null);
    setMenuOpen(false);
  }

  async function onRenameDesk(id: string, name: string): Promise<void> {
    const repo = await getRepository();
    await repo.desks.rename(id, name);
    setDesks((prev) => (prev ? prev.map((d) => (d.id === id ? { ...d, name } : d)) : prev));
  }

  async function onDeleteDesk(id: string): Promise<void> {
    const repo = await getRepository();
    await repo.desks.remove(id);
    const remaining = (desks ?? []).filter((d) => d.id !== id);
    setDesks(remaining);
    const next = remaining[0];
    if (next) {
      await setAppState("currentDeskId", next.id);
      setCurrentDeskId(next.id);
      setRows(null);
    } else {
      navigate("/wizard", { replace: true });
    }
    setMenuOpen(false);
  }

  if (desks === null || currentDeskId === null || rows === null) {
    return <div className="home__loading" aria-hidden="true" />;
  }

  const current = desks.find((d) => d.id === currentDeskId);
  if (!current) {
    return <div className="home__loading" aria-hidden="true" />;
  }

  const otherDesks = desks.filter((d) => d.id !== currentDeskId);
  const pinned = rows.filter((r) => r.project.pinned && !r.project.archived);
  const recent = rows.filter((r) => !r.project.pinned && !r.project.archived);
  const archive = rows.filter((r) => r.project.archived);

  return (
    <section className="home">
      <header className="home__header">
        <div className="home__desk" ref={menuRef}>
          <button
            type="button"
            className="home__desk-button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {current.name} <span aria-hidden="true">▾</span>
          </button>
          {menuOpen ? (
            <DeskMenu
              desks={desks}
              current={current}
              canDelete={rows.length === 0 && desks.length > 1}
              onSwitch={(id) => void onSwitchDesk(id)}
              onCreate={(name) => void onCreateDesk(name)}
              onRename={(id, name) => void onRenameDesk(id, name)}
              onDelete={(id) => void onDeleteDesk(id)}
              onClose={() => setMenuOpen(false)}
            />
          ) : null}
        </div>
        <Link to="/wizard?add=1" className="home__add">
          + New project
        </Link>
      </header>
      {rows.length === 0 ? (
        <p className="home__empty-body">No projects on {current.name} yet.</p>
      ) : null}
      <Section
        title="Pinned"
        rows={pinned}
        otherDesks={otherDesks}
        onRename={(id, l) => void onRename(id, l)}
        onForget={(id) => void onForget(id)}
        onRepoint={(id) => void onRepoint(id)}
        onMove={(id, deskId) => void onMove(id, deskId)}
      />
      <Section
        title="Recent"
        rows={recent}
        otherDesks={otherDesks}
        onRename={(id, l) => void onRename(id, l)}
        onForget={(id) => void onForget(id)}
        onRepoint={(id) => void onRepoint(id)}
        onMove={(id, deskId) => void onMove(id, deskId)}
      />
      <Section
        title="Archive"
        rows={archive}
        otherDesks={otherDesks}
        onRename={(id, l) => void onRename(id, l)}
        onForget={(id) => void onForget(id)}
        onRepoint={(id) => void onRepoint(id)}
        onMove={(id, deskId) => void onMove(id, deskId)}
      />
    </section>
  );
}
