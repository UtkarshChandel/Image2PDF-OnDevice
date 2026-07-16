# Image to PDF Web

A browser-only version of Local Image to PDF. It keeps the existing visual
language and conversion contract, but replaces the Python server with a Vite
application, a Web Worker, and a small Rust/WebAssembly image core.

No selected image or generated PDF is sent to a server. Vercel serves only the
versioned HTML, JavaScript, CSS, and WebAssembly application files; conversion
runs on the visitor's device.

## Conversion contract

- One selected image becomes one A4 PDF page, in the visible list order.
- Pages are portrait unless the orientation-corrected image is wider than it is
  tall, in which case the page is landscape.
- Images are centered within an 18-point margin without cropping or distortion.
- JPEG, PNG, WebP, TIFF, BMP, and the first frame of GIF files are supported.
- Camera EXIF orientation is applied before page orientation is selected.
- Transparent pixels are flattened onto white.
- Files are checked by their bytes rather than trusting their extension or MIME
  type.
- A conversion is limited to 100 images and each decoded image is limited to 50
  megapixels. The browser may need a lower practical workload on memory-limited
  phones.

## Simple states

The application exposes a deliberately small state machine on
`#app[data-state]`:

```text
empty -> ready -> processing -> complete
           ^          |
           |          +-> error -> ready
           +--- cancel ---+
```

Adding, removing, clearing, or reordering files invalidates the previous PDF and
returns the app to `ready` (or `empty` when nothing remains). Only one conversion
may be active. Cancellation returns control without producing a partial PDF.

## Architecture

```text
Browser UI
  | ordered File objects (kept in browser memory)
  v
Dedicated Web Worker
  | reads one selected File into an ArrayBuffer at a time
  v
Rust/WASM image core
  | oriented, alpha-flattened JPEG + dimensions
  v
pdf-lib assembler
  | A4 pages in the requested order
  v
Blob URL -> Save PDF
```

Images are normalized sequentially so that decoded pixel buffers can be freed
before the next image is processed. The worker owns conversion work, progress,
and cancellation; the main thread owns the file list, previews, and download
URL.

## Develop

Requirements:

- Node.js 20 or newer
- pnpm
- Rust with the `wasm32-unknown-unknown` target
- `wasm-pack`

From this directory:

```bash
pnpm install
pnpm dev
```

The development server prints its local URL. Selected files still stay in the
browser; Vite requests seen in development are source modules and hot-reload
traffic, not image uploads.

Build the exact static artifact Vercel will serve:

```bash
pnpm build
pnpm preview
```

The build output is `dist/`. A valid production artifact contains only static
files and has no API routes, server functions, database client, or storage SDK.

## Test

Run fast unit/contract tests:

```bash
pnpm test
```

Install Playwright's browser engines once, then run browser feasibility tests:

```bash
pnpm exec playwright install
pnpm test:e2e
```

The Playwright configuration exercises Chromium, Firefox, WebKit, a mobile
Chromium profile, and a mobile WebKit profile. These are useful compatibility
signals; a release should still be smoke-tested on physical iOS Safari and
Android Chrome because browser memory limits vary by device.

The browser tests verify:

- the `empty -> ready -> processing -> complete/error` state flow;
- PDF page count, selection order, and portrait/landscape choice;
- JPEG, PNG, WebP, TIFF, BMP, and GIF fixture acceptance;
- a byte-invalid image fails without producing a download; and
- conversion emits no upload request or cross-origin request.

## Privacy contract

The privacy promise is a testable application property, not an assumption about
WebAssembly:

1. Do not add conversion endpoints, Vercel Functions, server actions, remote
   storage, third-party analytics, error replay, ads, or remote fonts.
2. Do not place filenames, image bytes, PDF bytes, object URLs, or conversion
   metadata into URLs, logs, telemetry, local storage, or IndexedDB.
3. Network activity during conversion may only fetch same-origin, immutable
   application assets such as a lazily loaded worker or `.wasm` file. Conversion
   must not issue `POST`, `PUT`, `PATCH`, or `DELETE` requests.
4. Revoke preview and download Blob URLs when they are replaced or the page is
   closed.
5. Keep the Vercel Content Security Policy in `vercel.json` restrictive and
   review any proposed relaxation as a privacy-sensitive change.

For a deployed preview, verify the contract in browser DevTools: load the app,
clear the Network panel, select private test images, convert them, and confirm
that there are no upload requests. The repository's Playwright privacy test
automates the same check for local production builds.

## Feasibility and release gates

A release is a **go** only when all gates pass:

| Gate | Passing evidence |
| --- | --- |
| Static hosting | `pnpm build` produces `dist/`; a Vercel preview has no Functions or API routes. |
| Privacy | Network inspection and the Playwright privacy test show no upload, cross-origin, analytics, or telemetry request during selection and conversion. |
| Format support | Golden fixtures pass for JPEG, PNG, WebP, TIFF, BMP, GIF first-frame behavior, EXIF orientation, and transparent PNG flattening. |
| PDF parity | Every input produces one A4 page in visible order, with correct orientation, white background, even margins, and no cropping. |
| Responsiveness | Conversion remains in the worker; progress updates, cancellation, and the rest of the UI remain responsive. |
| Memory | Representative phone and desktop batches complete sequentially; oversized inputs fail with a useful error rather than crashing the tab. |
| Browsers | Current Chromium, Firefox, WebKit, iOS Safari, and Android Chrome pass the smoke flow. |
| Visual parity | Desktop and mobile screenshots match the original local app's design tokens and interaction hierarchy. |

Record device, browser version, image count, total compressed size, largest
decoded dimensions, duration, and outcome for memory tests. Avoid publishing a
single compressed-size guarantee: decoded dimensions and device/browser memory
are the meaningful constraints.

## Deploy to Vercel

Import this repository into Vercel and keep the Root Directory at the repository
root (`.`). Vercel detects Vite, runs the package build, and publishes `dist/`;
`vercel.json` adds immutable asset caching and privacy/security headers. Do not
enable a server function or add an API rewrite.

Before promoting a preview to production:

```bash
pnpm build
pnpm test
pnpm test:e2e
```

Then repeat the Network-panel privacy check against the actual preview URL and
perform one conversion on a physical iPhone and Android phone.
