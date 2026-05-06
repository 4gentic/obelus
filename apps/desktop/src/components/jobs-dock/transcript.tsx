import { type JSX, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { JobRecord } from "../../lib/jobs-store";
import type { TranscriptBlock } from "../../lib/transcript-reducer";
import { useTranscriptBlocks, useTranscriptStats } from "../../lib/transcript-store";
import {
  StatusBlockView,
  TextBlockView,
  ThinkingBlockView,
  ToolBlockView,
  ToolGroupBlockView,
} from "./transcript-blocks";

const RENDER_TAIL = 80;
const NEAR_BOTTOM_PX = 24;

export function JobTranscript({ job }: { job: JobRecord }): JSX.Element {
  const blocks = useTranscriptBlocks(job.claudeSessionId);
  const stats = useTranscriptStats(job.claudeSessionId);
  const [showAll, setShowAll] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  // Track whether the user is near the bottom; new content auto-scrolls only
  // when they are. If they scrolled up to read earlier content, leave them.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = (): void => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distance <= NEAR_BOTTOM_PX;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Re-pin the scroll on every block-list change. The early return on
  // `blockCount === 0` is the body reference Biome needs; the value also
  // short-circuits the layout work for an empty transcript.
  const blockCount = blocks.length;
  useLayoutEffect(() => {
    if (blockCount === 0) return;
    if (!stickToBottomRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [blockCount]);

  if (blocks.length === 0) {
    return (
      <p className="jobs-dock__panel-empty">
        {isLive(job) ? "Waiting for the first event…" : "No transcript was recorded."}
      </p>
    );
  }

  const visibleStart = !showAll && blocks.length > RENDER_TAIL ? blocks.length - RENDER_TAIL : 0;
  const visible = visibleStart === 0 ? blocks : blocks.slice(visibleStart);
  const hidden = visibleStart;

  return (
    <div className="jobs-dock__transcript">
      <div className="jobs-dock__transcript-scroller" ref={scrollerRef}>
        {hidden > 0 ? (
          <button
            type="button"
            className="jobs-dock__transcript-show-earlier"
            onClick={() => setShowAll(true)}
          >
            Show {hidden} earlier{hidden === 1 ? " event" : " events"}
          </button>
        ) : null}
        {visible.map((b) => renderBlock(b))}
      </div>
      {hasFooterContent(stats) ? (
        <p className="jobs-dock__transcript-footer">{formatFooter(stats)}</p>
      ) : null}
    </div>
  );
}

function renderBlock(b: TranscriptBlock): JSX.Element {
  switch (b.kind) {
    case "text":
      return <TextBlockView key={b.id} block={b} />;
    case "thinking":
      return <ThinkingBlockView key={b.id} block={b} />;
    case "tool":
      return <ToolBlockView key={b.id} block={b} />;
    case "tool-group":
      return <ToolGroupBlockView key={b.id} block={b} />;
    case "status":
      return <StatusBlockView key={b.id} block={b} />;
  }
}

function isLive(job: JobRecord): boolean {
  return job.status === "running" || job.status === "ingesting";
}

function hasFooterContent(stats: {
  toolCount: number;
  inputTokens: number;
  outputTokens: number;
}): boolean {
  return stats.toolCount > 0 || stats.inputTokens + stats.outputTokens > 0;
}

function formatFooter(stats: {
  toolCount: number;
  inputTokens: number;
  outputTokens: number;
}): string {
  const parts: string[] = [];
  if (stats.toolCount > 0) {
    parts.push(`${stats.toolCount} ${stats.toolCount === 1 ? "tool" : "tools"}`);
  }
  const tokens = stats.inputTokens + stats.outputTokens;
  if (tokens > 0) parts.push(`${formatTokens(tokens)} tok`);
  return parts.join(" · ");
}

function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  const v = n / 1000;
  return v >= 100 ? `${Math.round(v)}k` : `${v.toFixed(1).replace(/\.0$/, "")}k`;
}
