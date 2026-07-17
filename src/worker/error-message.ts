const STALE_WASM_POLICY_MESSAGE =
  "This tab is using an outdated converter. Reload the page and try again.";

export function conversionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "The PDF could not be created.";

  if (message.includes("WebAssembly") && message.includes("Content Security Policy")) {
    return STALE_WASM_POLICY_MESSAGE;
  }

  return message;
}
