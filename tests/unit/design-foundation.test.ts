import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { brandMetadata, statusPresentations } from "../../packages/ui/src/index";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const readText = (path: string) => readFileSync(resolve(repositoryRoot, path), "utf8");

const hexToRgb = (hex: string) => {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
};

const linearChannel = (channel: number) => {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
};

const contrastRatio = (first: string, second: string) => {
  const luminance = (color: string) => {
    const [red = 0, green = 0, blue = 0] = hexToRgb(color).map(linearChannel);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const light = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (light + 0.05) / (dark + 0.05);
};

const parseTokens = () => {
  const entries = [
    ...readText("packages/ui/src/tokens.css").matchAll(/(--sui-[\w-]+):\s*(#[0-9a-f]{6});/gi),
  ];
  return Object.fromEntries(entries.map(([, name, value]) => [name, value])) as Record<
    string,
    string
  >;
};

describe("SubmittedIt identity foundation", () => {
  it("locks the approved product identity and exact status labels", () => {
    expect(brandMetadata).toEqual({
      name: "SubmittedIt",
      tagline: "Know when it's really submitted.",
      coreQuestion: "Submitted it—or only thought you did?",
      markAlternativeText: "SubmittedIt receipt trail mark",
    });

    expect(Object.values(statusPresentations).map(({ label }) => label)).toEqual([
      "Prepared",
      "Attempted",
      "Site confirmed",
      "Pending acceptance",
      "Accepted",
      "Rejected",
      "Verification failed",
    ]);

    for (const presentation of Object.values(statusPresentations)) {
      expect(presentation.symbol).not.toBe("");
      expect(presentation.iconTreatment).not.toBe("");
      expect(presentation.accessibilityLabel).toContain(presentation.label);
    }
  });

  it("keeps normal text and every semantic status pair at WCAG AA contrast", () => {
    const tokens = parseTokens();
    const pair = (foreground: string, background: string) =>
      contrastRatio(tokens[foreground] ?? "", tokens[background] ?? "");

    expect(pair("--sui-color-ink", "--sui-color-canvas")).toBeGreaterThanOrEqual(4.5);
    expect(pair("--sui-color-ink-soft", "--sui-color-canvas")).toBeGreaterThanOrEqual(4.5);
    expect(pair("--sui-color-link", "--sui-color-surface")).toBeGreaterThanOrEqual(4.5);
    expect(pair("--sui-color-focus", "--sui-color-canvas")).toBeGreaterThanOrEqual(3);

    for (const status of [
      "prepared",
      "attempted",
      "site-confirmed",
      "pending-acceptance",
      "accepted",
      "rejected",
      "verification-failed",
    ]) {
      expect(
        pair(`--sui-status-${status}-fg`, `--sui-status-${status}-bg`),
        `${status} foreground/background contrast`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the source mark accessible, self-contained, and generator-compatible", () => {
    const mark = readText("packages/ui/assets/brand/submittedit-mark.svg");
    const wordmark = readText("packages/ui/assets/brand/submittedit-wordmark.svg");

    expect(mark).toMatch(/viewBox="0 0 128 128"/);
    expect(mark).toMatch(/role="img"/);
    expect(mark).toMatch(/<title id="title">SubmittedIt receipt trail<\/title>/);
    expect(mark).toMatch(/<desc id="description">/);
    expect(mark.match(/<rect\b/g)).toHaveLength(11);
    expect(mark).not.toMatch(/<(?:script|image|use|foreignObject)\b/i);
    expect(mark).not.toMatch(/(?:href|url\()/i);

    expect(wordmark).toMatch(/viewBox="0 0 540 128"/);
    expect(wordmark).toContain("SubmittedIt");
    expect(wordmark).toContain("Know when it's really submitted.");
    expect(wordmark).not.toMatch(/<(?:script|image|use|foreignObject)\b/i);
  });

  it("commits valid PNG extension icons at every required size", () => {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    for (const size of [16, 32, 48, 128]) {
      const png = readFileSync(resolve(repositoryRoot, `apps/extension/public/icon-${size}.png`));
      expect(png.subarray(0, 8)).toEqual(signature);
      expect(png.toString("ascii", 12, 16)).toBe("IHDR");
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
      expect(png[24]).toBe(8);
      expect(png[25]).toBe(6);
    }
  });

  it("documents every required reviewed UX surface and viewport", () => {
    const wireframes = readText("docs/WIREFRAMES.md");

    for (const requiredHeading of [
      "Landing — first viewport",
      "Extension — first run",
      "Extension — site permission request",
      "Extension — unsupported or no form found",
      "Extension — supported form detected",
      "Extension — capture review",
      "Receipt — Attempted",
      "Receipt — Site confirmed, Pending acceptance",
      "Receipt — acceptance-missing warning",
      "Receipt — Accepted",
      "Receipt — Rejected",
      "Receipt — Verification failed",
      "Web — verifier",
      "Web — extension installation",
      "Web — demo filing portal",
      "Loading",
      "Empty",
      "Offline",
      "RPC error",
      "Retry",
    ]) {
      expect(wireframes).toContain(requiredHeading);
    }

    for (const viewport of ["1440 × 900", "1280 × 720", "390 × 844", "Extension side panel"]) {
      expect(wireframes).toContain(viewport);
    }
  });

  it("keeps the product contract aligned with the seven-state language", () => {
    const contract = readText("docs/PRODUCT_CONTRACT.md");

    for (const label of Object.values(statusPresentations).map(({ label }) => label)) {
      expect(contract).toContain(`**${label}**`);
    }

    expect(contract).not.toMatch(/\*\*Pending\*\*/);
    expect(contract).toContain("site-confirmed receipt does not prove");
    expect(contract).toContain("Only an authoritative acknowledgment");
  });
});
