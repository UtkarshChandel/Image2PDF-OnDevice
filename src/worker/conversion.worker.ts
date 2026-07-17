/// <reference lib="webworker" />

import { PDFDocument, rgb } from "pdf-lib";

import { conversionErrorMessage } from "./error-message";
import type { WorkerRequest, WorkerResponse } from "./protocol";

const A4_PORTRAIT = { width: 595.276, height: 841.89 } as const;
const PAGE_MARGIN = 18;
const JPEG_QUALITY = 90;

let activeJobId: string | null = null;
let cancelledJobId: string | null = null;
let wasmReady: Promise<typeof import("../wasm/pkg/image2pdf_wasm.js")> | null = null;

function send(message: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

async function loadWasm(): Promise<typeof import("../wasm/pkg/image2pdf_wasm.js")> {
  if (!wasmReady) {
    wasmReady = import("../wasm/pkg/image2pdf_wasm.js").then(async (module) => {
      await module.default();
      return module;
    });
  }
  return wasmReady;
}

function isCancelled(jobId: string): boolean {
  return cancelledJobId === jobId;
}

async function convert(request: Extract<WorkerRequest, { type: "CONVERT" }>): Promise<void> {
  if (activeJobId) {
    send({ type: "ERROR", jobId: request.jobId, message: "Another PDF is already being created." });
    return;
  }

  activeJobId = request.jobId;
  cancelledJobId = null;

  try {
    const wasm = await loadWasm();
    const pdf = await PDFDocument.create();
    pdf.setTitle("Images");
    pdf.setAuthor("Image to PDF Web");
    pdf.setCreator("Image to PDF Web");

    for (let index = 0; index < request.images.length; index += 1) {
      if (isCancelled(request.jobId)) {
        send({ type: "CANCELLED", jobId: request.jobId });
        return;
      }

      const item = request.images[index];
      if (!item) continue;
      send({
        type: "PROGRESS",
        jobId: request.jobId,
        current: index + 1,
        total: request.images.length,
        stage: "processing",
        fileName: item.name,
      });

      let normalized: ReturnType<typeof wasm.normalize_image> | null = null;
      try {
        const input = new Uint8Array(await item.file.arrayBuffer());
        normalized = wasm.normalize_image(input, JPEG_QUALITY);
        const imageBytes = normalized.bytes;
        const embedded = normalized.mime === "image/png"
          ? await pdf.embedPng(imageBytes)
          : await pdf.embedJpg(imageBytes);

        const landscape = normalized.width > normalized.height;
        const pageWidth = landscape ? A4_PORTRAIT.height : A4_PORTRAIT.width;
        const pageHeight = landscape ? A4_PORTRAIT.width : A4_PORTRAIT.height;
        const page = pdf.addPage([pageWidth, pageHeight]);
        page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: rgb(1, 1, 1) });

        const availableWidth = pageWidth - PAGE_MARGIN * 2;
        const availableHeight = pageHeight - PAGE_MARGIN * 2;
        const scale = Math.min(
          availableWidth / normalized.width,
          availableHeight / normalized.height,
        );
        const width = normalized.width * scale;
        const height = normalized.height * scale;
        page.drawImage(embedded, {
          x: (pageWidth - width) / 2,
          y: (pageHeight - height) / 2,
          width,
          height,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unsupported or unreadable image.";
        throw new Error(`${item.name}: ${detail}`);
      } finally {
        normalized?.free();
      }
    }

    if (isCancelled(request.jobId)) {
      send({ type: "CANCELLED", jobId: request.jobId });
      return;
    }

    send({
      type: "PROGRESS",
      jobId: request.jobId,
      current: request.images.length,
      total: request.images.length,
      stage: "assembling",
    });
    const pdfBytes = await pdf.save({ useObjectStreams: true });
    const output = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength,
    ) as ArrayBuffer;
    send({ type: "COMPLETE", jobId: request.jobId, pdf: output }, [output]);
  } catch (error) {
    send({ type: "ERROR", jobId: request.jobId, message: conversionErrorMessage(error) });
  } finally {
    activeJobId = null;
    cancelledJobId = null;
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === "CANCEL") {
    if (activeJobId === request.jobId) cancelledJobId = request.jobId;
    return;
  }
  void convert(request);
};

export {};
