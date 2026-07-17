const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

export function bytesToBase64Url(bytes: Uint8Array<ArrayBufferLike>): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function base64UrlToBytes(value: string, path = "value"): Uint8Array<ArrayBuffer> {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
    throw new Error(`${path} must be unpadded base64url.`);
  }
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error(`${path} must be unpadded base64url.`);
  }
  const bytes: Uint8Array<ArrayBuffer> = Uint8Array.from(binary, (character) =>
    character.charCodeAt(0),
  );
  if (bytesToBase64Url(bytes) !== value) {
    throw new Error(`${path} must use canonical unpadded base64url.`);
  }
  return bytes;
}

export function utf8Bytes(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(value));
}

export function utf8Text(value: BufferSource): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(value);
}

export function randomBytes(
  length: number,
  cryptoProvider: Crypto = globalThis.crypto,
): Uint8Array<ArrayBuffer> {
  if (!Number.isSafeInteger(length) || length <= 0 || length > 65_536) {
    throw new Error("Random byte length is outside the supported range.");
  }
  return cryptoProvider.getRandomValues(new Uint8Array(new ArrayBuffer(length)));
}

export function randomBase64Url(
  length: number,
  cryptoProvider: Crypto = globalThis.crypto,
): string {
  return bytesToBase64Url(randomBytes(length, cryptoProvider));
}
