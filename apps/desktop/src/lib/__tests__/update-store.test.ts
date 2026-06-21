import { beforeEach, describe, expect, it } from "vitest";

import { useUpdateStore } from "../update-store";

beforeEach(() => {
  useUpdateStore.setState({
    consent: "loading",
    available: null,
    install: null,
    dismissedVersion: null,
    lastCheckedAt: null,
  });
});

describe("setAvailable", () => {
  it("drops a prior version's install state when a new version is offered", () => {
    const store = useUpdateStore.getState();
    store.setAvailable({ version: "1.0.0", notes: null });
    store.setInstall({ kind: "offline" });

    store.setAvailable({ version: "1.1.0", notes: null });

    expect(useUpdateStore.getState().install).toBeNull();
  });

  it("keeps an in-flight install when the same version is re-offered", () => {
    const store = useUpdateStore.getState();
    store.setAvailable({ version: "1.0.0", notes: null });
    store.setInstall({ kind: "downloading", downloaded: 10, total: 100 });

    store.setAvailable({ version: "1.0.0", notes: "refreshed" });

    expect(useUpdateStore.getState().install).toEqual({
      kind: "downloading",
      downloaded: 10,
      total: 100,
    });
  });
});
