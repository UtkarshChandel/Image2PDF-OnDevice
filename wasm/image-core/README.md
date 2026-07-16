# Image2PDF image core

This crate is the browser-only image normalization boundary. It accepts the
bytes of one selected image and returns a PDF-ready JPEG. It performs no
network I/O.

## JavaScript contract

Build with `wasm-pack build --target web --release`, then initialize the
generated module inside the conversion Web Worker.

```ts
import init, { normalize_image } from "../wasm-pkg/image2pdf_image_core";

await init();

const normalized = normalize_image(new Uint8Array(inputBuffer), 90);
try {
  const jpeg = normalized.bytes; // Uint8Array; safe for pdf-lib embedJpg
  const width = normalized.width;
  const height = normalized.height;
  const sourceFormat = normalized.sourceFormat;
  const mime = normalized.mime; // always image/jpeg
} finally {
  normalized.free();
}
```
The accepted formats are JPEG, PNG, WebP, TIFF, BMP, and the first frame of a
GIF. EXIF orientation is applied when valid orientation metadata is present.
Transparency is flattened on white. Images above 50,000,000 pixels are
rejected from their header dimensions before a full decode.

Failures are thrown as strings beginning with one of these stable codes:

- `EMPTY_INPUT`
- `UNSUPPORTED_FORMAT`
- `IMAGE_TOO_LARGE`
- `DECODE_FAILED`
- `ENCODE_FAILED`
- `INVALID_QUALITY`

The caller should process one image at a time and transfer/release its buffers
before starting the next image. The quality argument is optional (default 90)
and accepts integers from 40 through 100.

## Development

```sh
cargo test
wasm-pack build --target web --release
```
