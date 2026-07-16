/* tslint:disable */
/* eslint-disable */
/**
 * Decode and normalize one browser-selected image.
 *
 * Errors are stable strings of the form `ERROR_CODE: human-readable detail`.
 * Keeping the code before the first colon lets the UI map failures onto its
 * state machine without parsing implementation-specific prose.
 */
export function normalize_image(bytes: Uint8Array, jpeg_quality?: number | null): NormalizedImage;
/**
 * A normalized image returned to JavaScript.
 *
 * `bytes` is always a complete JPEG file, already oriented and flattened on
 * white, so the PDF layer can pass it directly to `pdfDoc.embedJpg(...)`.
 */
export class NormalizedImage {
  private constructor();
  free(): void;
  readonly width: number;
  readonly height: number;
  readonly sourceFormat: string;
  readonly mime: string;
  /**
   * Returns a JavaScript-owned copy. Call `free()` on this object after
   * embedding the returned bytes in the PDF.
   */
  readonly bytes: Uint8Array;
  readonly byteLength: number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_normalizedimage_free: (a: number, b: number) => void;
  readonly normalizedimage_width: (a: number) => number;
  readonly normalizedimage_height: (a: number) => number;
  readonly normalizedimage_sourceFormat: (a: number, b: number) => void;
  readonly normalizedimage_mime: (a: number, b: number) => void;
  readonly normalizedimage_bytes: (a: number) => number;
  readonly normalizedimage_byteLength: (a: number) => number;
  readonly normalize_image: (a: number, b: number, c: number, d: number) => void;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
  readonly __wbindgen_export_0: (a: number, b: number, c: number) => void;
  readonly __wbindgen_export_1: (a: number, b: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
