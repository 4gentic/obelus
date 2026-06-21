// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import ReviewFeed from "../ReviewFeed";
import type { TranscriptEntry } from "../review-progress-store";

// The store is unit-tested elsewhere; this exercises the *rendering* — the
// reviewer's-letter surface and the muted-thinking aside — which had never been
// observed in the running app. happy-dom + createRoot (the repo's existing
// interaction-test pattern, see use-key-nav.test.ts) lets us drive the real
// useState expand toggle with a click, not just snapshot static markup.

let activeRoot: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(entries: TranscriptEntry[]): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  activeRoot = root;
  act(() => {
    root.render(createElement(ReviewFeed, { entries }));
  });
  return host;
}

afterEach(() => {
  if (activeRoot) {
    const root = activeRoot;
    act(() => {
      root.unmount();
    });
    activeRoot = null;
  }
  host?.remove();
  host = null;
});

const ALL_KINDS: TranscriptEntry[] = [
  { kind: "phase", label: "Gathering context" },
  { kind: "note", text: "Flagged a missing citation." },
  { kind: "thinking", text: "Weighing whether the claim overreaches the evidence." },
  { kind: "tool", label: "Reading main.tex", result: "200 lines" },
  { kind: "tool", label: "Grepping for \\cite", error: true },
  { kind: "assistant", text: "Here is the reviewer's letter." },
];

describe("ReviewFeed — kinds", () => {
  it("renders the phase label", () => {
    const el = mount([{ kind: "phase", label: "Gathering context" }]);
    const phase = el.querySelector(".review-console__phase");
    expect(phase?.textContent).toBe("Gathering context");
  });

  it("renders a note with its em-dash mark and text", () => {
    const el = mount([{ kind: "note", text: "Flagged a missing citation." }]);
    const note = el.querySelector(".review-console__note");
    expect(note).not.toBeNull();
    const mark = note?.querySelector(".review-console__note-mark");
    expect(mark?.textContent).toBe("—");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(note?.textContent).toContain("Flagged a missing citation.");
  });

  it("renders the assistant text", () => {
    const el = mount([{ kind: "assistant", text: "Here is the reviewer's letter." }]);
    const assistant = el.querySelector(".review-console__assistant");
    expect(assistant?.textContent).toBe("Here is the reviewer's letter.");
  });

  it("renders a tool entry with its label and the · result suffix", () => {
    const el = mount([{ kind: "tool", label: "Reading main.tex", result: "200 lines" }]);
    const tool = el.querySelector(".review-console__tool");
    expect(tool).not.toBeNull();
    expect(tool?.textContent).toContain("Reading main.tex");
    const res = tool?.querySelector(".review-console__tool-res");
    expect(res?.textContent).toBe(" · 200 lines");
    // No error => no data-error marker.
    expect(tool?.hasAttribute("data-error")).toBe(false);
  });

  it("marks an errored tool entry with data-error", () => {
    const el = mount([{ kind: "tool", label: "Grepping for \\cite", error: true }]);
    const tool = el.querySelector(".review-console__tool");
    expect(tool?.getAttribute("data-error")).toBe("");
  });

  it("renders a tool entry without a result suffix when result is absent", () => {
    const el = mount([{ kind: "tool", label: "Reading main.tex" }]);
    expect(el.querySelector(".review-console__tool-res")).toBeNull();
  });

  it("renders one list item per entry across all kinds", () => {
    const el = mount(ALL_KINDS);
    expect(el.querySelectorAll(".review-console__list > li")).toHaveLength(ALL_KINDS.length);
  });
});

describe("ReviewFeed — thinking aside", () => {
  it("clamps the thinking body by default and offers an expand toggle", () => {
    const el = mount([
      { kind: "thinking", text: "Weighing whether the claim overreaches the evidence." },
    ]);
    const body = el.querySelector<HTMLElement>(".review-console__thinking-body");
    expect(body?.textContent).toBe("Weighing whether the claim overreaches the evidence.");
    // data-clamp="" present in the collapsed state.
    expect(body?.getAttribute("data-clamp")).toBe("");
    const toggle = el.querySelector(".review-console__thinking-toggle");
    expect(toggle?.textContent).toBe("⌄ show reasoning");
  });

  it("expands the thinking body when the toggle is clicked", () => {
    const el = mount([
      { kind: "thinking", text: "Weighing whether the claim overreaches the evidence." },
    ]);
    const toggle = el.querySelector<HTMLButtonElement>(".review-console__thinking-toggle");
    expect(toggle).not.toBeNull();

    act(() => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const body = el.querySelector<HTMLElement>(".review-console__thinking-body");
    // Clamp removed once expanded; the label flips to hide.
    expect(body?.hasAttribute("data-clamp")).toBe(false);
    expect(el.querySelector(".review-console__thinking-toggle")?.textContent).toBe(
      "⌃ hide reasoning",
    );
  });
});
