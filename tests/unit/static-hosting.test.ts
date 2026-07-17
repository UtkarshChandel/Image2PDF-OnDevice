import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface HeaderRule {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

interface VercelConfig {
  framework?: string;
  outputDirectory?: string;
  headers?: HeaderRule[];
  functions?: unknown;
  rewrites?: unknown;
  routes?: unknown;
}

const configPath = resolve(process.cwd(), "vercel.json");
const config = JSON.parse(readFileSync(configPath, "utf8")) as VercelConfig;

describe("static Vercel contract", () => {
  it("publishes only the Vite dist directory", () => {
    expect(config.framework).toBe("vite");
    expect(config.outputDirectory).toBe("dist");
    expect(config.functions).toBeUndefined();
    expect(config.rewrites).toBeUndefined();
    expect(config.routes).toBeUndefined();
  });

  it("keeps the production content policy local-only", () => {
    const catchAll = config.headers?.find((rule) => rule.source === "/(.*)");
    const csp = catchAll?.headers.find(
      (header) => header.key === "Content-Security-Policy",
    )?.value;

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/https?:\/\//);
  });
});
