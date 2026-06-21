import type { JSX } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReviewFeed from "./ReviewFeed";
import { useReviewProgress } from "./review-runner-context";

function elapsedLabel(startedAt: number | null, now: number): string {
  if (startedAt === null) return "";
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// The reviewer's live narration. The progress store already parses the engine
// stream; this renders what it now keeps — streamed prose, tool-call atoms, and
// a thinking pulse — instead of throwing it away as a phase label and a count.
export default function ReviewConsole({ running }: { running: boolean }): JSX.Element {
  const progress = useReviewProgress();
  const entries = progress((s) => s.entries);
  const trimmed = progress((s) => s.trimmed);
  const phase = progress((s) => s.phase);
  const startedAt = progress((s) => s.startedAt);
  const lastThinkingAt = progress((s) => s.lastThinkingAt);
  const [now, setNow] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [running]);

  // Stick to the tail as new lines stream in. `entries` is the trigger, not a
  // value the body reads — re-run on every transcript change to follow output.
  // biome-ignore lint/correctness/useExhaustiveDependencies: entries drives the scroll, it is intentionally the only dependency.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const thinking = running && lastThinkingAt !== null && now - lastThinkingAt < 2_500;
  const elapsed = elapsedLabel(startedAt, now);

  return (
    <section className="review-console" aria-label="Reviewer activity">
      <header className="review-console__head">
        <span className="review-console__eyebrow">Reviewer</span>
        {running && (
          <span className="review-console__status" aria-live="polite">
            {phase || "reading"}
            {thinking ? <span className="review-console__pulse" aria-hidden /> : null}
            {elapsed ? <span className="review-console__elapsed"> · {elapsed}</span> : null}
          </span>
        )}
      </header>
      <div className="review-console__scroll" ref={scrollRef}>
        {trimmed && <p className="review-console__trimmed">earlier output trimmed</p>}
        {entries.length === 0 ? (
          <p className="review-console__waiting">
            {running
              ? "Reading your paper…"
              : "The reviewer's narration appears here while a review runs."}
          </p>
        ) : (
          <ReviewFeed entries={entries} />
        )}
      </div>
    </section>
  );
}
