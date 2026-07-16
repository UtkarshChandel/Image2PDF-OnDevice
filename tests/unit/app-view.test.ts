import { afterEach, describe, expect, it } from "vitest";

import { mountApp } from "../../src/ui";

afterEach(() => {
  document.body.replaceChildren();
});

describe("app view state contract", () => {
  it("renders the externally observable application states", () => {
    const root = document.createElement("div");
    root.id = "app";
    document.body.append(root);

    const view = mountApp(root);
    expect(root.dataset.state).toBe("empty");
    expect(view.elements.convertButton.disabled).toBe(true);

    view.renderFiles([
      {
        id: "one",
        name: "first.png",
        size: 2048,
        previewUrl: "blob:first",
      },
    ]);
    view.renderState({ state: "ready", selectedCount: 1 });
    expect(root.dataset.state).toBe("ready");
    expect(view.elements.fileCount.textContent).toBe("1 image");
    expect(view.elements.convertButton.disabled).toBe(false);

    view.renderState({
      state: "processing",
      selectedCount: 1,
      progress: { current: 1, total: 2, label: "Processing first.png…" },
    });
    expect(root.dataset.state).toBe("processing");
    expect(view.elements.workspace.getAttribute("aria-busy")).toBe("true");
    expect(view.elements.cancelButton.hidden).toBe(false);
    expect(view.elements.progress.value).toBe(0.5);

    view.renderState({
      state: "complete",
      selectedCount: 1,
      message: "Your 1-page PDF is ready.",
    });
    view.setDownload("blob:pdf", "ordered-pages");
    expect(root.dataset.state).toBe("complete");
    expect(view.elements.downloadButton.download).toBe("ordered-pages.pdf");
    expect(view.elements.status.getAttribute("role")).toBe("status");

    view.renderState({
      state: "error",
      selectedCount: 1,
      message: "The selected file is not readable.",
    });
    expect(root.dataset.state).toBe("error");
    expect(view.elements.status.getAttribute("role")).toBe("alert");
    expect(view.elements.downloadButton.hidden).toBe(true);

    view.destroy();
    expect(root.dataset.state).toBeUndefined();
    expect(root.childElementCount).toBe(0);
  });
});
