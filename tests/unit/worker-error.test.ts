import { describe, expect, it } from "vitest";

import { conversionErrorMessage } from "../../src/worker/error-message";

describe("conversion worker errors", () => {
  it("turns a stale WebAssembly CSP failure into a recovery instruction", () => {
    const error = new Error(
      "WebAssembly.instantiateStreaming(): Compiling the module violates the Content Security Policy",
    );

    expect(conversionErrorMessage(error)).toBe(
      "This tab is using an outdated converter. Reload the page and try again.",
    );
  });

  it("preserves actionable conversion errors", () => {
    expect(conversionErrorMessage(new Error("photo.tiff: image is too large"))).toBe(
      "photo.tiff: image is too large",
    );
  });
});
