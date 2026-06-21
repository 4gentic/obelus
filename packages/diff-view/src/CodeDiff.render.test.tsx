// @vitest-environment happy-dom
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CodeDiff } from "./CodeDiff";

function mount(el: ReactElement): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(el);
  return host;
}

describe("<CodeDiff>", () => {
  it("wraps the rows in a diffview-code container", () => {
    const host = mount(<CodeDiff before="a" after="a" contextBefore={[]} contextAfter={[]} />);
    expect(host.querySelector(".diffview-code")).not.toBeNull();
  });

  it("classes each row by kind, context → removed → added → context, in order", () => {
    const host = mount(
      <CodeDiff before="x" after="X" contextBefore={["ctxA"]} contextAfter={["ctxB"]} />,
    );
    const rows = [...host.querySelectorAll(".diffview-code__row")];
    expect(rows.map((r) => r.className)).toEqual([
      "diffview-code__row diffview-code__row--context",
      "diffview-code__row diffview-code__row--removed",
      "diffview-code__row diffview-code__row--added",
      "diffview-code__row diffview-code__row--context",
    ]);
    expect(rows.map((r) => r.textContent)).toEqual(["ctxA", "x", "X", "ctxB"]);
  });

  it("renders an empty line as a zero-width space so the row keeps its height", () => {
    const host = mount(<CodeDiff before="a" after="a" contextBefore={[""]} contextAfter={[]} />);
    const rows = [...host.querySelectorAll(".diffview-code__row")];
    expect(rows[0]?.textContent).toBe("​");
    expect(rows[1]?.textContent).toBe("a");
  });
});
