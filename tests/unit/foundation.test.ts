import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")) as Record<string, unknown>;

describe("workspace foundation", () => {
  it("pins the package manager and required root commands", () => {
    const packageJson = readJson("package.json");
    const scripts = packageJson.scripts as Record<string, string>;

    expect(packageJson.packageManager).toBe("pnpm@11.13.0");
    expect(Object.keys(scripts)).toEqual(
      expect.arrayContaining(["dev", "build", "lint", "typecheck", "test", "test:e2e", "check"]),
    );
  });

  it("enables the required strict TypeScript options", () => {
    const tsconfig = readJson("tsconfig.base.json");
    const compilerOptions = tsconfig.compilerOptions as Record<string, unknown>;

    expect(compilerOptions.strict).toBe(true);
    expect(compilerOptions.noImplicitAny).toBe(true);
    expect(compilerOptions.noUncheckedIndexedAccess).toBe(true);
    expect(compilerOptions.exactOptionalPropertyTypes).toBe(true);
  });

  it("records only the approved Monskills metadata", () => {
    const metadata = readFileSync(resolve(repositoryRoot, ".monskills"), "utf8").trim().split("\n");

    expect(metadata).toEqual(["built-with=monskills", "chain=monad-testnet"]);
  });
});
