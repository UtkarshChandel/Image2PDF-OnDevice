import { describe, expect, it } from "vitest";

import { initialState, transition } from "../../src/state/machine";

describe("conversion state machine", () => {
  it("follows the successful empty -> ready -> converting -> complete flow", () => {
    const ready = transition(initialState, { type: "FILES_CHANGED", fileCount: 2 });
    expect(ready).toEqual({ status: "ready", fileCount: 2 });

    const converting = transition(ready, { type: "CONVERT_STARTED", fileCount: 2 });
    expect(converting).toEqual({
      status: "converting",
      fileCount: 2,
      current: 0,
      total: 2,
      stage: "preparing",
    });

    const progressing = transition(converting, {
      type: "PROGRESS",
      current: 1,
      total: 2,
      stage: "processing",
      fileName: "first.png",
    });
    expect(progressing).toMatchObject({
      status: "converting",
      current: 1,
      total: 2,
      stage: "processing",
      fileName: "first.png",
    });

    expect(
      transition(progressing, {
        type: "CONVERT_SUCCEEDED",
        fileCount: 2,
        message: "Your 2-page PDF is ready.",
      }),
    ).toEqual({
      status: "complete",
      fileCount: 2,
      message: "Your 2-page PDF is ready.",
    });
  });

  it("recovers from cancellation and errors without losing the selection", () => {
    const ready = transition(initialState, { type: "FILES_CHANGED", fileCount: 3 });
    const converting = transition(ready, { type: "CONVERT_STARTED", fileCount: 3 });

    expect(
      transition(converting, { type: "CONVERT_CANCELLED", fileCount: 3 }),
    ).toEqual({ status: "ready", fileCount: 3 });

    const failed = transition(converting, {
      type: "CONVERT_FAILED",
      fileCount: 3,
      message: "third.tiff is not readable.",
    });
    expect(failed).toEqual({
      status: "error",
      fileCount: 3,
      message: "third.tiff is not readable.",
    });
    expect(transition(failed, { type: "FILES_CHANGED", fileCount: 2 })).toEqual({
      status: "ready",
      fileCount: 2,
    });
  });

  it("ignores invalid starts and stale progress events", () => {
    expect(
      transition(initialState, { type: "CONVERT_STARTED", fileCount: 0 }),
    ).toBe(initialState);

    expect(
      transition(initialState, {
        type: "PROGRESS",
        current: 1,
        total: 1,
        stage: "processing",
      }),
    ).toBe(initialState);

    const converting = transition(
      transition(initialState, { type: "FILES_CHANGED", fileCount: 1 }),
      { type: "CONVERT_STARTED", fileCount: 1 },
    );
    expect(
      transition(converting, { type: "CONVERT_STARTED", fileCount: 1 }),
    ).toBe(converting);
  });

  it("returns to empty when the selection is cleared", () => {
    const ready = transition(initialState, { type: "FILES_CHANGED", fileCount: 1 });
    expect(transition(ready, { type: "FILES_CHANGED", fileCount: 0 })).toBe(
      initialState,
    );
    expect(transition(ready, { type: "RESET" })).toBe(initialState);
  });
});
