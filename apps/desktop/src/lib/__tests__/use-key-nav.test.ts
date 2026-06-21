// @vitest-environment happy-dom
import { act, createElement, type JSX } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type KeyMap, type UseKeyNavOptions, useKeyNav } from "../use-key-nav";

let activeRoot: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(map: KeyMap, options: UseKeyNavOptions): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  activeRoot = root;
  function Probe(): JSX.Element | null {
    useKeyNav(map, options);
    return null;
  }
  act(() => {
    root.render(createElement(Probe));
  });
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

function press(key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  });
}

describe("useKeyNav", () => {
  it("fires the handler for a plain mapped key", () => {
    const j = vi.fn();
    mount({ j }, { enabled: true });

    press("j");

    expect(j).toHaveBeenCalledTimes(1);
  });

  it("does nothing for an unmapped key", () => {
    const j = vi.fn();
    mount({ j }, { enabled: true });

    press("x");

    expect(j).not.toHaveBeenCalled();
  });

  it("fires a chord's nested handler only on the second key", () => {
    const top = vi.fn();
    mount({ g: { g: top } }, { enabled: true });

    press("g");
    expect(top).not.toHaveBeenCalled();

    press("g");
    expect(top).toHaveBeenCalledTimes(1);
  });

  it("ignores keys carrying a modifier", () => {
    const j = vi.fn();
    mount({ j }, { enabled: true });

    press("j", { metaKey: true });

    expect(j).not.toHaveBeenCalled();
  });

  it("binds nothing when disabled", () => {
    const j = vi.fn();
    mount({ j }, { enabled: false });

    press("j");

    expect(j).not.toHaveBeenCalled();
  });
});
