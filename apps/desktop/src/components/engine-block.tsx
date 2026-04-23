import { listen } from "@tauri-apps/api/event";
import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type EngineName,
  type EngineProgressEvent,
  type EngineStatus,
  engineInstall,
  engineStatus,
  engineUninstall,
} from "../ipc/commands";
import "./engine-block.css";

type InstallState =
  | { kind: "idle" }
  | {
      kind: "installing";
      stage: EngineProgressEvent["stage"];
      bytesDone: number | null;
      bytesTotal: number | null;
    }
  | { kind: "error"; message: string };

interface Labels {
  title: string;
  description: string;
  installNote: string;
}

const LABELS: Record<EngineName, Labels> = {
  typst: {
    title: "Typst",
    description:
      "Compiles Typst (.typ) sources to PDF. Self-contained; no TeX distribution needed.",
    installNote: "Downloads the official Typst release from GitHub (~35 MB).",
  },
  tectonic: {
    title: "Tectonic (LaTeX)",
    description:
      "A managed LaTeX engine. Used as a fallback when latexmk / MacTeX / TeX Live isn't installed. Always runs XeTeX — papers written strictly for pdflatex may not compile cleanly.",
    installNote:
      "Downloads ~15 MB from GitHub. On the first .tex compile, Tectonic fetches a one-time ~300 MB CTAN bundle from relay.fullyjustified.net.",
  },
};

export interface EngineBlockProps {
  engine: EngineName;
  compact?: boolean;
}

export default function EngineBlock(props: EngineBlockProps): JSX.Element {
  const { engine, compact = false } = props;
  const labels = LABELS[engine];
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [install, setInstall] = useState<InstallState>({ kind: "idle" });
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await engineStatus(engine);
      if (mounted.current) setStatus(next);
    } catch (err) {
      if (mounted.current) {
        setInstall({
          kind: "error",
          message: err instanceof Error ? err.message : "status probe failed",
        });
      }
    }
  }, [engine]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    const unlisten = listen<EngineProgressEvent>("engine:progress", (evt) => {
      const payload = evt.payload;
      if (payload.engine !== engine) return;
      if (payload.stage === "done") {
        setInstall({ kind: "idle" });
        void refresh();
        return;
      }
      if (payload.stage === "error") {
        setInstall({ kind: "error", message: payload.message ?? "Install failed." });
        return;
      }
      setInstall({
        kind: "installing",
        stage: payload.stage,
        bytesDone: payload.bytesDone,
        bytesTotal: payload.bytesTotal,
      });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [engine, refresh]);

  const handleInstall = async (): Promise<void> => {
    setInstall({ kind: "installing", stage: "downloading", bytesDone: 0, bytesTotal: null });
    try {
      await engineInstall(engine);
      await refresh();
      setInstall({ kind: "idle" });
    } catch (err) {
      setInstall({
        kind: "error",
        message: err instanceof Error ? err.message : "Install failed.",
      });
    }
  };

  const handleUninstall = async (): Promise<void> => {
    try {
      await engineUninstall(engine);
      await refresh();
    } catch (err) {
      setInstall({
        kind: "error",
        message: err instanceof Error ? err.message : "Uninstall failed.",
      });
    }
  };

  const isInstalling = install.kind === "installing";
  const statusLine = renderStatusLine(status);
  const progressLabel = isInstalling ? renderProgressLabel(install) : null;
  const progressRatio = isInstalling ? computeRatio(install) : null;

  return (
    <section className={`engine-block${compact ? " engine-block--compact" : ""}`}>
      <header className="engine-block__header">
        <h3 className="engine-block__title">{labels.title}</h3>
        {status && (
          <span
            className={`engine-block__chip engine-block__chip--${status.kind}`}
            title={statusLine ?? undefined}
          >
            {status.kind === "managed"
              ? `Managed · v${status.version ?? status.availableVersion}`
              : status.kind === "system"
                ? `System · ${status.version ? `v${status.version}` : "detected"}`
                : "Not installed"}
          </span>
        )}
      </header>

      <p className="engine-block__desc">{labels.description}</p>

      {status && statusLine && <p className="engine-block__status">{statusLine}</p>}

      {!status?.platformSupported && status && (
        <p className="engine-block__unsupported">
          Managed install isn't available on this platform yet. Install from a system package
          manager if you need this engine.
        </p>
      )}

      {isInstalling && (
        <div
          className="engine-block__progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressRatio !== null ? Math.round(progressRatio * 100) : undefined}
        >
          <div
            className="engine-block__progress-fill"
            style={{
              width: progressRatio !== null ? `${(progressRatio * 100).toFixed(1)}%` : "25%",
            }}
          />
          <span className="engine-block__progress-label">{progressLabel}</span>
        </div>
      )}

      {install.kind === "error" && <p className="engine-block__error">{install.message}</p>}

      <div className="engine-block__actions">
        {status?.kind === "managed" && !isInstalling && (
          <>
            <button
              type="button"
              className="engine-block__btn"
              onClick={() => void handleInstall()}
            >
              Reinstall
            </button>
            <button
              type="button"
              className="engine-block__btn engine-block__btn--quiet"
              onClick={() => void handleUninstall()}
            >
              Uninstall
            </button>
          </>
        )}
        {status?.kind !== "managed" && status?.platformSupported && !isInstalling && (
          <button type="button" className="engine-block__btn" onClick={() => void handleInstall()}>
            {status?.kind === "system" ? "Install managed copy" : "Install"}
          </button>
        )}
      </div>

      {!isInstalling && (status?.kind ?? "none") !== "managed" && status?.platformSupported && (
        <p className="engine-block__note">{labels.installNote}</p>
      )}
    </section>
  );
}

function renderStatusLine(status: EngineStatus | null): string | null {
  if (!status) return null;
  if (status.kind === "managed") {
    return `Managed install at ${status.path ?? "(unknown path)"}${
      status.version ? ` — v${status.version}` : ""
    }`;
  }
  if (status.kind === "system") {
    return `System binary at ${status.path ?? "(unknown path)"}${
      status.version ? ` — v${status.version}` : ""
    }`;
  }
  return `Pinned version available: v${status.availableVersion}`;
}

function renderProgressLabel(s: Extract<InstallState, { kind: "installing" }>): string {
  if (s.stage === "verifying") return "Verifying…";
  if (s.stage === "extracting") return "Extracting…";
  const done = s.bytesDone ?? 0;
  const total = s.bytesTotal;
  if (total !== null && total > 0) {
    return `${formatBytes(done)} / ${formatBytes(total)}`;
  }
  return `${formatBytes(done)} downloaded`;
}

function computeRatio(s: Extract<InstallState, { kind: "installing" }>): number | null {
  if (s.stage !== "downloading") return null;
  const done = s.bytesDone ?? 0;
  const total = s.bytesTotal;
  if (total === null || total <= 0) return null;
  return Math.min(1, done / total);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
