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
  return kind === "writer" ? "Paper — writing" : "Paper — reviewing";
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

interface DesksAsideProps {
  desks: DeskRow[];
  currentDeskId: string;
  canDeleteCurrent: boolean;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

function DesksAside({
  desks,
  currentDeskId,
  canDeleteCurrent,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: DesksAsideProps): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [creating, setCreating] = useState(false);
  const [createValue, setCreateValue] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const editRef = useRef<HTMLInputElement | null>(null);
  const createRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingId) editRef.current?.select();
  }, [editingId]);

  useEffect(() => {
    if (creating) createRef.current?.focus();
  }, [creating]);

  function startRename(desk: DeskRow): void {
    setEditValue(desk.name);
    setEditingId(desk.id);
    setConfirmingDeleteId(null);
  }

  function commitRename(): void {
    if (!editingId) return;
    const next = editValue.trim();
    const desk = desks.find((d) => d.id === editingId);
    if (next && desk && next !== desk.name) onRename(editingId, next);
    setEditingId(null);
    setEditValue("");
  }

  function cancelRename(): void {
    setEditingId(null);
    setEditValue("");
  }

  function commitCreate(): void {
    const next = createValue.trim();
    if (next) onCreate(next);
    setCreating(false);
    setCreateValue("");
  }

  function cancelCreate(): void {
    setCreating(false);
    setCreateValue("");
  }

  return (
    <aside className="home__desks" aria-label="Desks">
      <div className="home__desks-head">
        <h2 className="home__desks-title">Desks</h2>
        <button
          type="button"
          className="home__desks-add"
          onClick={() => setCreating(true)}
          disabled={creating}
          aria-label="New desk"
        >
          + New
        </button>
      </div>
      <ul className="home__desks-list">
        {creating ? (
          <li className="home__desks-li">
            <input
              ref={createRef}
              className="home__desks-input"
              type="text"
              value={createValue}
              placeholder="Name the new desk"
              aria-label="New desk name"
              onChange={(e) => setCreateValue(e.target.value)}
              onBlur={cancelCreate}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitCreate();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelCreate();
                }
              }}
            />
          </li>
        ) : null}
        {desks.map((desk) => {
          const isCurrent = desk.id === currentDeskId;
          const isEditing = editingId === desk.id;
          const isConfirmingDelete = confirmingDeleteId === desk.id;
          const liClass = isCurrent ? "home__desks-li home__desks-li--active" : "home__desks-li";
          return (
            <li key={desk.id} className={liClass}>
              {isEditing ? (
                <input
                  ref={editRef}
                  className="home__desks-input"
                  type="text"
                  value={editValue}
                  aria-label={`Rename desk ${desk.name}`}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRename();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={
                    isCurrent ? "home__desks-item home__desks-item--active" : "home__desks-item"
                  }
                  aria-current={isCurrent ? "page" : undefined}
                  onClick={() => {
                    if (!isCurrent) onSwitch(desk.id);
                  }}
                >
                  {desk.name}
                </button>
              )}
              {isCurrent && !isEditing ? (
                <span className="home__desks-actions">
                  <button
                    type="button"
                    className="home__desks-action"
                    onClick={() => startRename(desk)}
                    aria-label={`Rename desk ${desk.name}`}
                  >
                    Rename
                  </button>
                  {isConfirmingDelete ? (
                    <button
                      type="button"
                      className="home__desks-action home__desks-action--danger"
                      onClick={() => {
                        setConfirmingDeleteId(null);
                        onDelete(desk.id);
                      }}
                      onBlur={() => setConfirmingDeleteId(null)}
                    >
                      Click to confirm
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="home__desks-action"
                      disabled={!canDeleteCurrent}
                      title={
                        canDeleteCurrent ? undefined : "Move or forget this desk's projects first."
                      }
                      onClick={() => setConfirmingDeleteId(desk.id)}
                    >
                      Delete
                    </button>
                  )}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

export default function Home(): JSX.Element {
  const navigate = useNavigate();
  const [desks, setDesks] = useState<DeskRow[] | null>(null);
  const [currentDeskId, setCurrentDeskId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);

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
  const canDeleteCurrent = rows.length === 0 && desks.length > 1;

  return (
    <section className="home">
      <DesksAside
        desks={desks}
        currentDeskId={currentDeskId}
        canDeleteCurrent={canDeleteCurrent}
        onSwitch={(id) => void onSwitchDesk(id)}
        onCreate={(name) => void onCreateDesk(name)}
        onRename={(id, name) => void onRenameDesk(id, name)}
        onDelete={(id) => void onDeleteDesk(id)}
      />
      <div className="home__main">
        <header className="home__header">
          <h1 className="home__title">{current.name}</h1>
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
          title="Recent Projects"
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
      </div>
    </section>
  );
}
