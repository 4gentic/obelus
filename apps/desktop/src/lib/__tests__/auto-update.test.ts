import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../updater", () => ({
  checkForUpdate: vi.fn(),
}));
vi.mock("../../store/app-state", () => ({
  getAutoUpdateCheck: vi.fn(),
  getDismissedUpdateVersion: vi.fn(),
  getLastUpdateCheckAt: vi.fn(),
  setAutoUpdateCheck: vi.fn(),
  setLastUpdateCheckAt: vi.fn(),
}));

import { setAutoUpdateCheck, setLastUpdateCheckAt } from "../../store/app-state";
import {
  recordUpdateCheck,
  runAutoUpdateCheck,
  setAutoUpdateConsent,
  shouldCheck,
} from "../auto-update";
import { useUpdateStore } from "../update-store";
import { checkForUpdate } from "../updater";

const checkForUpdateMock = vi.mocked(checkForUpdate);
const setLastUpdateCheckAtMock = vi.mocked(setLastUpdateCheckAt);
const setAutoUpdateCheckMock = vi.mocked(setAutoUpdateCheck);

beforeEach(() => {
  vi.clearAllMocks();
  checkForUpdateMock.mockResolvedValue({ kind: "current" });
  useUpdateStore.setState({
    consent: "loading",
    available: null,
    install: null,
    dismissedVersion: null,
    lastCheckedAt: null,
  });
});

describe("shouldCheck", () => {
  const FLOOR = 5000;

  it("refuses while the user is undecided (consent undefined)", () => {
    expect(shouldCheck(undefined, undefined, 1000, FLOOR)).toBe(false);
  });

  it("refuses after the user declined (consent false)", () => {
    expect(shouldCheck(false, undefined, 1000, FLOOR)).toBe(false);
  });

  it("allows the first check once opted in", () => {
    expect(shouldCheck(true, undefined, 1000, FLOOR)).toBe(true);
  });

  it("refuses a second check inside the floor window", () => {
    expect(shouldCheck(true, 1000, 1000 + FLOOR - 1, FLOOR)).toBe(false);
  });

  it("allows again once the floor has elapsed", () => {
    expect(shouldCheck(true, 1000, 1000 + FLOOR, FLOOR)).toBe(true);
  });
});

describe("runAutoUpdateCheck", () => {
  it("stores an available update and records the check", async () => {
    checkForUpdateMock.mockResolvedValue({ kind: "available", version: "1.2.0", notes: "notes" });
    await runAutoUpdateCheck();
    expect(useUpdateStore.getState().available).toEqual({ version: "1.2.0", notes: "notes" });
    expect(useUpdateStore.getState().lastCheckedAt).not.toBeNull();
    expect(setLastUpdateCheckAtMock).toHaveBeenCalledTimes(1);
  });

  it("clears a stale available update when none is offered", async () => {
    useUpdateStore.getState().setAvailable({ version: "1.0.0", notes: null });
    checkForUpdateMock.mockResolvedValue({ kind: "current" });
    await runAutoUpdateCheck();
    expect(useUpdateStore.getState().available).toBeNull();
  });

  it("does not start a second check while one is in flight", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    checkForUpdateMock.mockImplementation(async () => {
      await gate;
      return { kind: "current" };
    });

    const first = runAutoUpdateCheck();
    const second = runAutoUpdateCheck();
    release();
    await Promise.all([first, second]);

    expect(checkForUpdateMock).toHaveBeenCalledTimes(1);
  });
});

describe("recordUpdateCheck", () => {
  it("persists the timestamp and mirrors it into the store", async () => {
    await recordUpdateCheck();
    expect(setLastUpdateCheckAtMock).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().lastCheckedAt).not.toBeNull();
  });
});

describe("setAutoUpdateConsent", () => {
  it("persists the choice and mirrors it into the store", async () => {
    await setAutoUpdateConsent(true);
    expect(setAutoUpdateCheckMock).toHaveBeenCalledWith(true);
    expect(useUpdateStore.getState().consent).toBe(true);
  });
});
