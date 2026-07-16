export type ViewState = "empty" | "ready" | "processing" | "complete" | "error";

export interface FileListItem {
  id: string;
  name: string;
  size: number;
  previewUrl: string;
}

export interface ViewProgress {
  current: number;
  total: number;
  label?: string;
}

export interface ViewModel {
  state: ViewState;
  selectedCount: number;
  message?: string;
  progress?: ViewProgress;
}

export interface AppViewElements {
  shell: HTMLElement;
  workspace: HTMLElement;
  dropZone: HTMLLabelElement;
  fileInput: HTMLInputElement;
  fileSection: HTMLElement;
  fileList: HTMLOListElement;
  fileCount: HTMLElement;
  clearButton: HTMLButtonElement;
  addMoreButton: HTMLButtonElement;
  filenameInput: HTMLInputElement;
  convertButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
  progressRegion: HTMLElement;
  progress: HTMLProgressElement;
  progressLabel: HTMLElement;
  status: HTMLElement;
  downloadButton: HTMLAnchorElement;
}

export interface AppView {
  elements: AppViewElements;
  renderFiles(items: readonly FileListItem[]): void;
  renderState(model: ViewModel): void;
  setDownload(url: string, filename: string): void;
  clearDownload(): void;
  setDropActive(active: boolean): void;
  destroy(): void;
}

const APP_MARKUP = `
  <a class="skip-link" href="#workspace">Skip to image converter</a>
  <main class="shell" data-state="empty">
    <header class="masthead">
      <a class="brand" href="/" aria-label="Image to PDF home">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" focusable="false">
            <path d="M8 4.5h11l5 5V27.5H8z" />
            <path d="M19 4.5v5h5M11.5 22l4-5 2.8 3 2.2-2.5 2 4.5" />
            <circle cx="13.5" cy="12.5" r="1.5" />
          </svg>
        </span>
        <span>Image to PDF</span>
      </a>
      <span class="privacy"><i aria-hidden="true"></i> Runs only on this device</span>
    </header>

    <section class="hero" aria-labelledby="page-title">
      <p class="eyebrow">Simple, private, local</p>
      <h1 id="page-title">Turn your images<br />into one clean PDF.</h1>
      <p class="lede">
        Drop in your images, put them in order, and save. Every image becomes a page.
        Nothing is uploaded to the internet.
      </p>
    </section>

    <section class="workspace" id="workspace" aria-labelledby="workspace-title">
      <div class="workspace-heading">
        <div>
          <p class="step-label">01 / Add images</p>
          <h2 id="workspace-title">Choose your pages</h2>
        </div>
        <button class="text-button" id="clear-button" type="button" hidden>Clear all</button>
      </div>

      <label class="drop-zone" id="drop-zone" for="file-input">
        <input
          id="file-input"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/tiff,image/bmp,image/gif"
          multiple
        />
        <span class="upload-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5" />
          </svg>
        </span>
        <strong>Drop images here</strong>
        <span>or click to browse</span>
        <small>JPG, PNG, WebP, TIFF, BMP or GIF</small>
      </label>

      <div class="file-section" id="file-section" hidden>
        <div class="file-meta">
          <span id="file-count">0 images</span>
          <span>Drag to reorder</span>
        </div>
        <ol class="file-list" id="file-list" aria-label="PDF page order" aria-live="polite"></ol>
        <button class="add-more" id="add-more" type="button">
          <span aria-hidden="true">+</span> Add more images
        </button>
      </div>

      <div class="finish-row">
        <label class="filename-field" for="filename">
          <span>PDF filename</span>
          <span class="filename-input-wrap">
            <input
              id="filename"
              type="text"
              value="my-images"
              maxlength="80"
              autocomplete="off"
              spellcheck="false"
            />
            <b aria-hidden="true">.pdf</b>
          </span>
        </label>
        <div class="convert-actions">
          <button class="primary-button" id="convert-button" type="button" disabled>
            <span class="button-label">Create PDF</span>
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M4 10h12m-5-5 5 5-5 5" />
            </svg>
          </button>
          <button class="cancel-button" id="cancel-button" type="button" hidden>Cancel</button>
        </div>
      </div>

      <div class="progress-region" id="progress-region" aria-live="polite" hidden>
        <div class="progress-copy">
          <span id="progress-label">Preparing your images…</span>
          <span id="progress-value" aria-hidden="true">0%</span>
        </div>
        <progress id="progress" max="1" value="0">0%</progress>
      </div>

      <div class="status" id="status" role="status" aria-live="polite" hidden></div>
      <a class="download-button" id="download-button" href="#" hidden>
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 16h12" />
        </svg>
        Save PDF
      </a>
    </section>

    <footer>
      <span>One image = one page</span>
      <span>A4, no cropping</span>
      <span>Processed in your browser</span>
    </footer>
  </main>
`;

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required app element: ${selector}`);
  return element;
}

function humanSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function normalizedFilename(filename: string): string {
  const base = filename.trim().replace(/\.pdf$/i, "") || "images";
  return `${base}.pdf`;
}

export function mountApp(root: HTMLElement): AppView {
  root.innerHTML = APP_MARKUP;

  const elements: AppViewElements = {
    shell: requiredElement(root, ".shell"),
    workspace: requiredElement(root, "#workspace"),
    dropZone: requiredElement(root, "#drop-zone"),
    fileInput: requiredElement(root, "#file-input"),
    fileSection: requiredElement(root, "#file-section"),
    fileList: requiredElement(root, "#file-list"),
    fileCount: requiredElement(root, "#file-count"),
    clearButton: requiredElement(root, "#clear-button"),
    addMoreButton: requiredElement(root, "#add-more"),
    filenameInput: requiredElement(root, "#filename"),
    convertButton: requiredElement(root, "#convert-button"),
    cancelButton: requiredElement(root, "#cancel-button"),
    progressRegion: requiredElement(root, "#progress-region"),
    progress: requiredElement(root, "#progress"),
    progressLabel: requiredElement(root, "#progress-label"),
    status: requiredElement(root, "#status"),
    downloadButton: requiredElement(root, "#download-button"),
  };

  let selectedCount = 0;

  function renderFiles(items: readonly FileListItem[]): void {
    const fragment = document.createDocumentFragment();

    items.forEach((file, index) => {
      const item = document.createElement("li");
      item.className = "file-item";
      item.draggable = true;
      item.dataset.fileId = file.id;
      item.dataset.index = String(index);
      item.setAttribute("aria-label", `Page ${index + 1}: ${file.name}`);

      const handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.setAttribute("aria-hidden", "true");
      handle.textContent = "⠿";

      const image = document.createElement("img");
      image.className = "thumbnail";
      image.src = file.previewUrl;
      image.alt = "";
      image.draggable = false;

      const copy = document.createElement("span");
      copy.className = "file-copy";
      const name = document.createElement("span");
      name.className = "file-name";
      name.textContent = file.name;
      const details = document.createElement("span");
      details.className = "file-size";
      details.textContent = `Page ${index + 1} · ${humanSize(file.size)}`;
      copy.append(name, details);

      const actions = document.createElement("span");
      actions.className = "file-actions";

      const moveUp = document.createElement("button");
      moveUp.className = "order-button";
      moveUp.type = "button";
      moveUp.dataset.action = "move-up";
      moveUp.dataset.fileId = file.id;
      moveUp.disabled = index === 0;
      moveUp.setAttribute("aria-label", `Move ${file.name} up`);
      moveUp.textContent = "↑";

      const moveDown = document.createElement("button");
      moveDown.className = "order-button";
      moveDown.type = "button";
      moveDown.dataset.action = "move-down";
      moveDown.dataset.fileId = file.id;
      moveDown.disabled = index === items.length - 1;
      moveDown.setAttribute("aria-label", `Move ${file.name} down`);
      moveDown.textContent = "↓";

      const remove = document.createElement("button");
      remove.className = "remove-button";
      remove.type = "button";
      remove.dataset.action = "remove";
      remove.dataset.fileId = file.id;
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      remove.textContent = "×";

      actions.append(moveUp, moveDown, remove);
      item.append(handle, image, copy, actions);
      fragment.append(item);
    });

    elements.fileList.replaceChildren(fragment);
    selectedCount = items.length;
    elements.fileCount.textContent = `${items.length} ${items.length === 1 ? "image" : "images"}`;
    elements.dropZone.hidden = items.length > 0;
    elements.fileSection.hidden = items.length === 0;
    elements.clearButton.hidden = items.length === 0;
  }

  function renderState(model: ViewModel): void {
    const processing = model.state === "processing";
    const hasFiles = model.selectedCount > 0;
    const progress = model.progress;
    const ratio = progress && progress.total > 0
      ? Math.min(1, Math.max(0, progress.current / progress.total))
      : 0;

    selectedCount = model.selectedCount;
    root.dataset.state = model.state;
    elements.shell.dataset.state = model.state;
    elements.workspace.setAttribute("aria-busy", String(processing));
    elements.convertButton.disabled = !hasFiles || processing;
    elements.convertButton.hidden = processing;
    elements.cancelButton.hidden = !processing;
    elements.clearButton.disabled = processing;
    elements.addMoreButton.disabled = processing;
    elements.fileInput.disabled = processing;
    elements.filenameInput.disabled = processing;

    elements.progressRegion.hidden = !processing;
    elements.progress.value = ratio;
    elements.progress.textContent = `${Math.round(ratio * 100)}%`;
    elements.progressLabel.textContent = progress?.label
      ?? (progress ? `Processing image ${Math.min(progress.current + 1, progress.total)} of ${progress.total}…` : "Preparing your images…");
    const progressValue = requiredElement<HTMLElement>(root, "#progress-value");
    progressValue.textContent = `${Math.round(ratio * 100)}%`;

    const hasMessage = Boolean(model.message);
    elements.status.hidden = !hasMessage;
    elements.status.textContent = model.message ?? "";
    elements.status.classList.toggle("error", model.state === "error");
    elements.status.setAttribute("role", model.state === "error" ? "alert" : "status");

    if (model.state !== "complete") elements.downloadButton.hidden = true;
  }

  function setDownload(url: string, filename: string): void {
    elements.downloadButton.href = url;
    elements.downloadButton.download = normalizedFilename(filename);
    elements.downloadButton.hidden = false;
  }

  function clearDownload(): void {
    elements.downloadButton.removeAttribute("href");
    elements.downloadButton.removeAttribute("download");
    elements.downloadButton.hidden = true;
  }

  function setDropActive(active: boolean): void {
    elements.dropZone.classList.toggle("dragging", active);
  }

  function destroy(): void {
    root.replaceChildren();
    delete root.dataset.state;
    selectedCount = 0;
  }

  renderFiles([]);
  renderState({ state: "empty", selectedCount });

  return {
    elements,
    renderFiles,
    renderState,
    setDownload,
    clearDownload,
    setDropActive,
    destroy,
  };
}
