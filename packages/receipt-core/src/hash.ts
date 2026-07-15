import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { canonicalize } from "./canonicalize.js";
import type { HashHex } from "./types.js";

export const HASH_DOMAINS = {
  authoritySignature: "SUBMITTEDIT/AUTHORITY-SIGNATURE/1",
  chainAnchor: "SUBMITTEDIT/CHAIN-ANCHOR/1",
  event: "SUBMITTEDIT/RECEIPT-EVENT/1",
  extensionSignature: "SUBMITTEDIT/EXTENSION-SIGNATURE/1",
} as const;

export const createDomainSeparatedPreimage = (domain: string, value: unknown): string =>
  `${domain}\u0000${canonicalize(value)}`;

export const hashCanonical = (domain: string, value: unknown): HashHex => {
  const preimage = new TextEncoder().encode(createDomainSeparatedPreimage(domain, value));
  return `0x${bytesToHex(keccak_256(preimage))}` as HashHex;
};
