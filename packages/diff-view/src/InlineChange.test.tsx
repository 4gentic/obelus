// @vitest-environment happy-dom
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InlineChange } from "./InlineChange";

function mount(el: ReactElement): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(el);
  return host;
}

function dels(host: HTMLElement): string[] {
  return [...host.querySelectorAll(".diffview-inline__del")].map((n) => n.textContent ?? "");
}

function inss(host: HTMLElement): string[] {
  return [...host.querySelectorAll(".diffview-inline__ins")].map((n) => n.textContent ?? "");
}

const LONG_BEFORE =
  "On each flagged category the detector keeps a running baseline of the amendment rate and the escalation rate, then raises a warning only when the observed value drifts far enough from that baseline to exceed a fixed threshold.";
const LONG_AFTER =
  "Whenever a category trips the guard, the monitor instead compares the live signal against an adaptive reference that it recalibrates continuously, and it escalates the moment the accumulated deviation crosses a learned boundary.";

describe("<InlineChange> routing", () => {
  it("renders a source change as the monospace code diff, not a redline", () => {
    const patch = "@@ -1,1 +1,1 @@\n-#set par(justify: true)\n+#set par(justify: false)\n";
    const host = mount(<InlineChange patch={patch} sourceText={null} />);
    expect(host.querySelector(".diffview-code")).not.toBeNull();
    expect(host.querySelector(".diffview-inline__del")).toBeNull();
  });

  it("marks a one-word prose edit as struck-old plus underlined-new", () => {
    const patch = "@@ -1,1 +1,1 @@\n-The quick brown fox.\n+The slow brown fox.\n";
    const host = mount(<InlineChange patch={patch} sourceText={null} />);
    expect(host.querySelector(".diffview-inline")).not.toBeNull();
    expect(dels(host)).toEqual(["quick"]);
    expect(inss(host)).toEqual(["slow"]);
    expect(host.querySelector(".diffview-final")).toBeNull();
  });

  it("keeps a reworded formula atomic inside the redline", () => {
    const patch =
      "@@ -1,1 +1,1 @@\n-detecting $z_k(t)=(r_k-mu_k)/sigma_k$ when\n+detecting $z_k(t)$ where\n";
    const host = mount(<InlineChange patch={patch} sourceText={null} />);
    expect(dels(host)).toContain("$z_k(t)=(r_k-mu_k)/sigma_k$");
    expect(inss(host)).toContain("$z_k(t)$");
  });

  it("repeats the clean result below the redline for a heavy rewrite", () => {
    const patch = `@@ -1,1 +1,1 @@\n-${LONG_BEFORE}\n+${LONG_AFTER}\n`;
    const host = mount(<InlineChange patch={patch} sourceText={null} />);
    expect(host.querySelector(".diffview-inline")).not.toBeNull();
    expect(host.querySelector(".diffview-final__label")?.textContent).toBe("Result");
    expect(host.querySelector(".diffview-final__text")?.textContent).toBe(LONG_AFTER);
  });

  it("shows the empty state when the patch is unparseable", () => {
    const host = mount(<InlineChange patch="not a patch" sourceText={null} />);
    expect(host.querySelector(".diffview-inline__empty")?.textContent).toBe("No change to show.");
  });

  it("renders a pure prose insertion as additions only", () => {
    const patch = "@@ -1,0 +2,1 @@\n+An added sentence here.\n";
    const host = mount(<InlineChange patch={patch} sourceText={"first line\nsecond line\n"} />);
    expect(dels(host)).toEqual([]);
    expect(inss(host).join("")).toContain("An added sentence here.");
  });

  it("renders a pure prose deletion as removals only", () => {
    const patch = "@@ -2,1 +1,0 @@\n-A removed sentence.\n";
    const source = "keep this\nA removed sentence.\nkeep that\n";
    const host = mount(<InlineChange patch={patch} sourceText={source} />);
    expect(inss(host)).toEqual([]);
    expect(dels(host).join("")).toContain("A removed sentence.");
  });

  it("renders the surrounding context around the redline", () => {
    const patch = "@@ -2,1 +2,1 @@\n-the middle line here\n+the centre line here\n";
    // No trailing newline, so the source's last line isn't a split sentinel that
    // would trail the context with a stray "\n".
    const source = "intro line\nthe middle line here\noutro line";
    const host = mount(<InlineChange patch={patch} sourceText={source} />);
    expect(host.querySelector(".diffview-inline__context--before")?.textContent).toBe("intro line");
    expect(host.querySelector(".diffview-inline__context--after")?.textContent).toBe("outro line");
  });
});
