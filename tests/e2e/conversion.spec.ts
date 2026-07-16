import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

import {
  makePng,
  SUPPORTED_FORMAT_FIXTURES,
  type ImageFixture,
} from "../fixtures/image-fixtures";

interface ObservedRequest {
  url: string;
  method: string;
  hasBody: boolean;
}

async function selectImages(page: Page, fixtures: readonly ImageFixture[]): Promise<void> {
  await page.locator("#file-input").setInputFiles(
    fixtures.map(({ name, mimeType, buffer }) => ({ name, mimeType, buffer })),
  );
}

async function savePdf(page: Page): Promise<Uint8Array> {
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#download-button").click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFile(path as string);
}

async function beginStateObservation(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = document.querySelector<HTMLElement>("#app");
    if (!app) throw new Error("#app is missing");
    const scope = window as typeof window & {
      __image2pdfStates?: string[];
      __image2pdfObserver?: MutationObserver;
    };
    scope.__image2pdfStates = [app.dataset.state ?? "missing"];
    scope.__image2pdfObserver = new MutationObserver(() => {
      scope.__image2pdfStates?.push(app.dataset.state ?? "missing");
    });
    scope.__image2pdfObserver.observe(app, {
      attributes: true,
      attributeFilter: ["data-state"],
    });
  });
}

async function observedStates(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const scope = window as typeof window & { __image2pdfStates?: string[] };
    return scope.__image2pdfStates ?? [];
  });
}

test("keeps conversion local and preserves selected page order and orientation", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-state", "empty");
  await beginStateObservation(page);

  const requests: ObservedRequest[] = [];
  page.on("request", (request) => {
    requests.push({
      url: request.url(),
      method: request.method(),
      hasBody: request.postDataBuffer() !== null,
    });
  });

  const selected: readonly ImageFixture[] = [
    {
      name: "z-first-portrait.png",
      mimeType: "image/png",
      buffer: makePng(18, 36, [220, 40, 40, 255]),
      orientation: "portrait",
    },
    {
      name: "a-second-landscape.png",
      mimeType: "image/png",
      buffer: makePng(40, 20, [40, 80, 220, 255]),
      orientation: "landscape",
    },
  ];
  await selectImages(page, selected);

  await expect(page.locator("#app")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#file-list .file-name")).toHaveText([
    "z-first-portrait.png",
    "a-second-landscape.png",
  ]);
  await page.locator("#filename").fill("ordered-pages");
  await page.locator("#convert-button").click();

  await expect(page.locator("#app")).toHaveAttribute("data-state", "complete");
  await expect(page.locator("#download-button")).toBeVisible();
  expect(await observedStates(page)).toEqual(
    expect.arrayContaining(["empty", "ready", "processing", "complete"]),
  );

  const pageOrigin = new URL(page.url()).origin;
  const unsafeRequests = requests.filter(
    (request) => !["GET", "HEAD"].includes(request.method) || request.hasBody,
  );
  const externalRequests = requests.filter((request) => {
    const url = new URL(request.url);
    return !["blob:", "data:"].includes(url.protocol) && url.origin !== pageOrigin;
  });
  expect(unsafeRequests, "conversion must not upload selected bytes").toEqual([]);
  expect(externalRequests, "conversion must not contact another origin").toEqual([]);

  const bytes = await savePdf(page);
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(2);
  const first = pdf.getPage(0).getSize();
  const second = pdf.getPage(1).getSize();
  expect(first.width).toBeLessThan(first.height);
  expect(second.width).toBeGreaterThan(second.height);
});

test("accepts every promised source format", async ({ page }) => {
  await page.goto("/");
  await selectImages(page, SUPPORTED_FORMAT_FIXTURES);
  await expect(page.locator("#file-count")).toHaveText("6 images");
  await page.locator("#convert-button").click();

  await expect(page.locator("#app")).toHaveAttribute("data-state", "complete");
  const pdf = await PDFDocument.load(await savePdf(page));
  expect(pdf.getPageCount()).toBe(SUPPORTED_FORMAT_FIXTURES.length);

  const actualOrientations = pdf.getPages().map((pdfPage) => {
    const { width, height } = pdfPage.getSize();
    return width > height ? "landscape" : "portrait";
  });
  expect(actualOrientations).toEqual(
    SUPPORTED_FORMAT_FIXTURES.map((fixture) => fixture.orientation),
  );
});

test("rejects bytes that only pretend to be an image", async ({ page }) => {
  await page.goto("/");
  await selectImages(page, [
    {
      name: "not-really-an-image.png",
      mimeType: "image/png",
      buffer: Buffer.from("This is private test text, not an image."),
      orientation: "portrait",
    },
  ]);
  await page.locator("#convert-button").click();

  await expect(page.locator("#app")).toHaveAttribute("data-state", "error");
  await expect(page.locator("#status")).toContainText("not-really-an-image.png");
  await expect(page.locator("#status")).toContainText(
    /unsupported|unreadable|decode|expected an image/i,
  );
  await expect(page.locator("#download-button")).toBeHidden();
});
