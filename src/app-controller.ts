import { initialState, transition, type AppEvent, type AppState } from "./state/machine";
import { mountApp, type FileListItem, type ViewModel } from "./ui";
import type { WorkerRequest, WorkerResponse } from "./worker/protocol";

const MAX_IMAGES = 100;
const MAX_SELECTED_BYTES = 200 * 1024 * 1024;
const SUPPORTED_EXTENSION = /\.(jpe?g|png|webp|tiff?|bmp|gif)$/i;

interface SelectedImage extends FileListItem {
  file: File;
}

export interface AppController {
  destroy(): void;
}

export interface ControllerOptions {
  workerFactory?: () => Worker;
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeDownloadName(value: string): string {
  return (value.trim() || "images").replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]+/g, "-");
}

function isSupported(file: File): boolean {
  return file.type.startsWith("image/") || SUPPORTED_EXTENSION.test(file.name);
}

function toViewModel(state: AppState): ViewModel {
  switch (state.status) {
    case "empty":
      return { state: "empty", selectedCount: 0 };
    case "ready":
      return { state: "ready", selectedCount: state.fileCount };
    case "converting": {
      const label = state.stage === "assembling"
        ? "Assembling your PDF…"
        : state.stage === "preparing"
          ? "Preparing your images…"
          : `Processing ${state.fileName ?? "image"} (${state.current} of ${state.total})…`;
      return {
        state: "processing",
        selectedCount: state.fileCount,
        progress: {
          current: state.current,
          total: state.total,
          label,
        },
      };
    }
    case "complete":
      return { state: "complete", selectedCount: state.fileCount, message: state.message };
    case "error":
      return { state: "error", selectedCount: state.fileCount, message: state.message };
  }
}

function defaultWorkerFactory(): Worker {
  return new Worker(new URL("./worker/conversion.worker.ts", import.meta.url), { type: "module" });
}

export function createAppController(root: HTMLElement, options: ControllerOptions = {}): AppController {
  const view = mountApp(root);
  const workerFactory = options.workerFactory ?? defaultWorkerFactory;
  let state: AppState = initialState;
  let images: SelectedImage[] = [];
  let worker: Worker | null = null;
  let activeJobId: string | null = null;
  let downloadUrl: string | null = null;
  let draggedFileId: string | null = null;

  function dispatch(event: AppEvent): void {
    state = transition(state, event);
    view.renderState(toViewModel(state));
  }

  function ensureWorker(): Worker {
    if (worker) return worker;
    worker = workerFactory();
    worker.addEventListener("message", onWorkerMessage as EventListener);
    worker.addEventListener("error", onWorkerError as EventListener);
    return worker;
  }

  function releaseDownload(): void {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
    view.clearDownload();
  }

  function renderImages(): void {
    view.renderFiles(images);
  }

  function filesChanged(): void {
    releaseDownload();
    renderImages();
    dispatch({ type: "FILES_CHANGED", fileCount: images.length });
  }

  function showError(message: string): void {
    releaseDownload();
    dispatch({ type: "CONVERT_FAILED", fileCount: images.length, message });
  }

  function addFiles(files: Iterable<File>): void {
    if (state.status === "converting") return;
    const incoming = [...files];
    const supported = incoming.filter(isSupported);
    const skippedFiles = supported.length !== incoming.length;
    if (!supported.length) {
      if (incoming.length) showError("Choose JPG, PNG, WebP, TIFF, BMP, or GIF images.");
      return;
    }
    if (images.length + supported.length > MAX_IMAGES) {
      showError("A PDF can contain at most 100 images.");
      return;
    }
    const totalBytes = images.reduce((total, item) => total + item.size, 0)
      + supported.reduce((total, file) => total + file.size, 0);
    if (totalBytes > MAX_SELECTED_BYTES) {
      showError("The selected images exceed the 200 MB browser safety limit.");
      return;
    }

    images.push(...supported.map((file) => ({
      id: randomId(),
      name: file.name,
      size: file.size,
      file,
      previewUrl: URL.createObjectURL(file),
    })));
    filesChanged();
    if (skippedFiles) {
      showError("Unsupported files were skipped. The supported images are still ready to convert.");
    }
  }

  function removeImage(id: string): void {
    if (state.status === "converting") return;
    const index = images.findIndex((image) => image.id === id);
    if (index < 0) return;
    const [removed] = images.splice(index, 1);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
    filesChanged();
  }

  function moveImage(id: string, direction: -1 | 1): void {
    if (state.status === "converting") return;
    const index = images.findIndex((image) => image.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= images.length) return;
    const [moved] = images.splice(index, 1);
    if (!moved) return;
    images.splice(nextIndex, 0, moved);
    filesChanged();
  }

  function reorderImage(sourceId: string, targetId: string): void {
    if (state.status === "converting" || sourceId === targetId) return;
    const sourceIndex = images.findIndex((image) => image.id === sourceId);
    const targetIndex = images.findIndex((image) => image.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = images.splice(sourceIndex, 1);
    if (!moved) return;
    images.splice(targetIndex, 0, moved);
    filesChanged();
  }

  function clearImages(): void {
    if (state.status === "converting") return;
    for (const image of images) URL.revokeObjectURL(image.previewUrl);
    images = [];
    view.elements.fileInput.value = "";
    filesChanged();
  }

  function startConversion(): void {
    if (!images.length || state.status === "converting") return;
    releaseDownload();
    const jobId = randomId();
    activeJobId = jobId;
    dispatch({ type: "CONVERT_STARTED", fileCount: images.length });

    const workerImages = images.map((image) => ({
      id: image.id,
      name: image.name,
      file: image.file,
    }));
    const request: WorkerRequest = { type: "CONVERT", jobId, images: workerImages };
    try {
      ensureWorker().postMessage(request);
    } catch (error) {
      activeJobId = null;
      const message = error instanceof Error ? error.message : "The conversion worker could not start.";
      showError(message);
    }
  }

  function cancelConversion(): void {
    if (!activeJobId) return;
    worker?.terminate();
    worker = null;
    activeJobId = null;
    dispatch({ type: "CONVERT_CANCELLED", fileCount: images.length });
  }

  function onWorkerMessage(event: MessageEvent<WorkerResponse>): void {
    const response = event.data;
    if (response.jobId !== activeJobId) return;

    if (response.type === "PROGRESS") {
      dispatch({
        type: "PROGRESS",
        current: response.current,
        total: response.total,
        stage: response.stage,
        ...(response.fileName ? { fileName: response.fileName } : {}),
      });
      return;
    }
    if (response.type === "CANCELLED") {
      activeJobId = null;
      dispatch({ type: "CONVERT_CANCELLED", fileCount: images.length });
      return;
    }
    if (response.type === "ERROR") {
      activeJobId = null;
      showError(response.message);
      return;
    }

    activeJobId = null;
    const blob = new Blob([response.pdf], { type: "application/pdf" });
    downloadUrl = URL.createObjectURL(blob);
    const filename = safeDownloadName(view.elements.filenameInput.value);
    view.setDownload(downloadUrl, filename);
    dispatch({
      type: "CONVERT_SUCCEEDED",
      fileCount: images.length,
      message: `Your ${images.length}-page PDF is ready.`,
    });
    view.setDownload(downloadUrl, filename);
  }

  function onWorkerError(): void {
    activeJobId = null;
    worker?.terminate();
    worker = null;
    showError("The browser conversion worker stopped unexpectedly. Please try again.");
  }

  const { elements } = view;
  const disposers: Array<() => void> = [];
  function listen<K extends keyof HTMLElementEventMap>(
    element: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ): void {
    element.addEventListener(type, listener as EventListener);
    disposers.push(() => element.removeEventListener(type, listener as EventListener));
  }

  const inputListener = () => {
    addFiles(elements.fileInput.files ?? []);
    elements.fileInput.value = "";
  };
  elements.fileInput.addEventListener("change", inputListener);
  disposers.push(() => elements.fileInput.removeEventListener("change", inputListener));

  listen(elements.addMoreButton, "click", () => elements.fileInput.click());
  listen(elements.clearButton, "click", clearImages);
  listen(elements.convertButton, "click", startConversion);
  listen(elements.cancelButton, "click", cancelConversion);

  listen(elements.fileList, "click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("button[data-action][data-file-id]")
      : null;
    if (!target?.dataset.fileId) return;
    if (target.dataset.action === "remove") removeImage(target.dataset.fileId);
    if (target.dataset.action === "move-up") moveImage(target.dataset.fileId, -1);
    if (target.dataset.action === "move-down") moveImage(target.dataset.fileId, 1);
  });

  listen(elements.fileList, "dragstart", (event) => {
    const item = event.target instanceof Element
      ? event.target.closest<HTMLElement>("li[data-file-id]")
      : null;
    draggedFileId = item?.dataset.fileId ?? null;
    item?.classList.add("dragging");
  });
  listen(elements.fileList, "dragover", (event) => {
    event.preventDefault();
    elements.fileList.querySelectorAll(".drag-target").forEach((item) => item.classList.remove("drag-target"));
    const item = event.target instanceof Element
      ? event.target.closest<HTMLElement>("li[data-file-id]")
      : null;
    if (item?.dataset.fileId !== draggedFileId) item?.classList.add("drag-target");
  });
  listen(elements.fileList, "drop", (event) => {
    event.preventDefault();
    const item = event.target instanceof Element
      ? event.target.closest<HTMLElement>("li[data-file-id]")
      : null;
    if (draggedFileId && item?.dataset.fileId) reorderImage(draggedFileId, item.dataset.fileId);
    draggedFileId = null;
  });
  listen(elements.fileList, "dragend", () => {
    draggedFileId = null;
    elements.fileList.querySelectorAll(".dragging, .drag-target").forEach((item) => {
      item.classList.remove("dragging", "drag-target");
    });
  });

  for (const eventName of ["dragenter", "dragover"] as const) {
    listen(elements.dropZone, eventName, (event) => {
      event.preventDefault();
      view.setDropActive(true);
    });
  }
  for (const eventName of ["dragleave", "drop"] as const) {
    listen(elements.dropZone, eventName, (event) => {
      event.preventDefault();
      view.setDropActive(false);
    });
  }
  listen(elements.dropZone, "drop", (event) => addFiles(event.dataTransfer?.files ?? []));

  function destroy(): void {
    for (const dispose of disposers) dispose();
    worker?.terminate();
    worker = null;
    for (const image of images) URL.revokeObjectURL(image.previewUrl);
    images = [];
    releaseDownload();
    view.destroy();
  }

  view.renderState(toViewModel(state));
  return { destroy };
}
