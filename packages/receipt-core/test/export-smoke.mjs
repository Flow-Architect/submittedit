import {
  HASH_DOMAINS,
  ZERO_HASH,
  canonicalize,
  hashCanonical,
  normalizeTimestamp,
} from "@submittedit/receipt-core";

const canonical = canonicalize({ zeroHash: ZERO_HASH, status: "synthetic" });
const hash = hashCanonical(HASH_DOMAINS.event, { zeroHash: ZERO_HASH, status: "synthetic" });

if (!canonical.includes(ZERO_HASH) || !/^0x[0-9a-f]{64}$/.test(hash)) {
  throw new Error("The built @submittedit/receipt-core export surface is not usable.");
}

if (normalizeTimestamp("2026-07-14T12:00:00-05:00", "$.time") !== "2026-07-14T17:00:00.000Z") {
  throw new Error("The built receipt-core normalization export returned an unexpected result.");
}

console.log("receipt-core package exports loaded successfully");
